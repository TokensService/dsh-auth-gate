import { USERNAME_RE } from "../../shared/index.js";
import { hashPassword } from "./password.js";
import { enabledCount, isAdmin, loadUsersOr503, readJsonOrRespond, requireSubject, sendCode, sendJson, viewOf, writeUsersOr503, } from "./user-admin-common.js";
/** PATCH /auth/users {username, password?, disabled?, totp?, admin?}：改密/启停/TOTP 启停/角色授予回收。 */
export async function handleUserUpdate(deps, req, res) {
    const subject = requireSubject(deps, req, res);
    if (subject === undefined)
        return;
    const body = await readJsonOrRespond(req, res);
    if (body === undefined)
        return;
    const username = typeof body["username"] === "string" ? body["username"] : "";
    if (!USERNAME_RE.test(username))
        return sendCode(res, 400, "invalid_username");
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    if (!isAdmin(loaded.snapshot, subject) && !selfPasswordOnly(body, username, subject)) {
        return sendCode(res, 403, "forbidden");
    }
    const record = loaded.snapshot.users.get(username);
    if (record === undefined)
        return sendCode(res, 404, "not_found");
    const plan = await planUpdate(deps, body, record, username, subject, loaded.snapshot);
    if ("code" in plan)
        return sendCode(res, plan.status, plan.code);
    loaded.snapshot.users.set(username, plan.record);
    if (!(await writeUsersOr503(deps, res, loaded.snapshot)))
        return;
    deps.logger.info(`user ${username} updated via /auth/users`);
    sendJson(res, 200, {
        user: viewOf(username, plan.record, subject),
        ...(plan.secret === undefined
            ? {}
            : { totpSecret: plan.secret, totpUri: deps.totpUri(username, plan.secret) }),
    });
}
/** 非 admin 的 PATCH 许可（D13）：只允许改自己的密码（目标非己或带其他字段 → 403）。 */
function selfPasswordOnly(body, username, subject) {
    return (username === subject &&
        body["disabled"] === undefined &&
        body["totp"] === undefined &&
        body["admin"] === undefined);
}
/** 变更规划：逐字段校验并合成下一条记录；任一字段非法即拒绝（不写盘）。 */
async function planUpdate(deps, body, record, username, subject, snapshot) {
    let next = { ...record };
    let touched = false;
    let secret;
    if (body["password"] !== undefined) {
        if (typeof body["password"] !== "string" || body["password"] === "") {
            return { status: 400, code: "empty_password" };
        }
        next = { ...next, passwordHash: await hashPassword(body["password"]) };
        touched = true;
    }
    const disabledPlan = planDisabled(body["disabled"], next, record, username, subject, snapshot);
    if (disabledPlan !== undefined) {
        if ("code" in disabledPlan)
            return disabledPlan;
        next = disabledPlan.record;
        touched = true;
    }
    const totpPlan = planTotp(deps, body["totp"], record);
    if (totpPlan !== undefined) {
        if ("code" in totpPlan)
            return totpPlan;
        next = totpPlan.record;
        secret = totpPlan.secret;
        touched = true;
    }
    const adminPlan = planAdmin(body["admin"], next, username, subject);
    if (adminPlan !== undefined) {
        if ("code" in adminPlan)
            return adminPlan;
        next = adminPlan.record;
        touched = true;
    }
    if (!touched)
        return { status: 400, code: "nothing_to_update" };
    return secret === undefined ? { record: next } : { record: next, secret };
}
/**
 * admin 角色字段规划（D18）：仅 admin 可达（非 admin 已被 selfPasswordOnly 拦截）。
 * boolean 校验；收回自己的角色 → 409 self_target（与禁用/删除同款护栏，CLI 仍是
 * 逃生通道）；enable 写入 role，disable 逐字段重建（与 planTotp disable 同纪律）。
 */
function planAdmin(action, next, username, subject) {
    if (action === undefined)
        return undefined;
    if (typeof action !== "boolean")
        return { status: 400, code: "invalid_field" };
    if (!action && username === subject)
        return { status: 409, code: "self_target" };
    return { record: action ? { ...next, role: "admin" } : stripRole(next) };
}
/** 移除 role 字段（逐字段重建，与 planTotp disable / CLI setUserAdmin 同纪律）。 */
function stripRole(record) {
    return {
        passwordHash: record.passwordHash,
        disabled: record.disabled,
        ...(record.totpSecret === undefined ? {} : { totpSecret: record.totpSecret }),
    };
}
/** disabled 字段规划：boolean 校验 + 自我禁用/最后启用护栏（D-UM-3）。 */
function planDisabled(action, next, record, username, subject, snapshot) {
    if (action === undefined)
        return undefined;
    if (typeof action !== "boolean")
        return { status: 400, code: "invalid_field" };
    if (action && !record.disabled) {
        if (username === subject)
            return { status: 409, code: "self_target" };
        if (enabledCount(snapshot) <= 1)
            return { status: 409, code: "last_enabled" };
    }
    return { record: { ...next, disabled: action } };
}
/** TOTP 字段规划：enable 生成新 secret（已有则 409）；disable 移除（幂等）。 */
function planTotp(deps, action, record) {
    if (action === undefined)
        return undefined;
    if (action === "enable") {
        if (record.totpSecret !== undefined)
            return { status: 409, code: "totp_exists" };
        const secret = deps.generateTotpSecret();
        return { record: { ...record, totpSecret: secret }, secret };
    }
    if (action === "disable") {
        return {
            record: {
                passwordHash: record.passwordHash,
                disabled: record.disabled,
                ...(record.role === undefined ? {} : { role: record.role }),
            },
        };
    }
    return { status: 400, code: "invalid_field" };
}
/** DELETE /auth/users {username}：删除用户（仅 admin）；自我删除/最后一个启用用户保护。 */
export async function handleUserDelete(deps, req, res) {
    const subject = requireSubject(deps, req, res);
    if (subject === undefined)
        return;
    const body = await readJsonOrRespond(req, res);
    if (body === undefined)
        return;
    const username = typeof body["username"] === "string" ? body["username"] : "";
    if (!USERNAME_RE.test(username))
        return sendCode(res, 400, "invalid_username");
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    if (!isAdmin(loaded.snapshot, subject))
        return sendCode(res, 403, "forbidden");
    const record = loaded.snapshot.users.get(username);
    if (record === undefined)
        return sendCode(res, 404, "not_found");
    if (username === subject)
        return sendCode(res, 409, "self_target");
    if (!record.disabled && enabledCount(loaded.snapshot) <= 1) {
        return sendCode(res, 409, "last_enabled");
    }
    loaded.snapshot.users.delete(username);
    if (!(await writeUsersOr503(deps, res, loaded.snapshot)))
        return;
    deps.logger.info(`user ${username} deleted via /auth/users`);
    sendJson(res, 200, { deleted: username });
}
//# sourceMappingURL=user-admin-mutations.js.map