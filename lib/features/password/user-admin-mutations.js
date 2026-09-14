import { USERNAME_RE } from "../../shared/index.js";
import { hashPassword } from "./password.js";
import { enabledCount, loadUsersOr503, readJsonOrRespond, requireSubject, sendCode, sendJson, viewOf, writeUsersOr503, } from "./user-admin-common.js";
/** PATCH /auth/users {username, password?, disabled?, totp?}：改密/启停/TOTP 启停。 */
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
    if (body["disabled"] !== undefined) {
        if (typeof body["disabled"] !== "boolean")
            return { status: 400, code: "invalid_field" };
        if (body["disabled"] && !record.disabled) {
            if (username === subject)
                return { status: 409, code: "self_target" };
            if (enabledCount(snapshot) <= 1)
                return { status: 409, code: "last_enabled" };
        }
        next = { ...next, disabled: body["disabled"] };
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
    if (!touched)
        return { status: 400, code: "nothing_to_update" };
    return secret === undefined ? { record: next } : { record: next, secret };
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
        return { record: { passwordHash: record.passwordHash, disabled: record.disabled } };
    }
    return { status: 400, code: "invalid_field" };
}
/** DELETE /auth/users {username}：删除用户；自我删除/最后一个启用用户保护。 */
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