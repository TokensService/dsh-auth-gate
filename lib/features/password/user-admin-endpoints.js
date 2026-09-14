import { compareNames, USERNAME_RE } from "../../shared/index.js";
import { hashPassword } from "./password.js";
import { loadUsersOr503, readJsonOrRespond, requireSubject, sendCode, sendJson, viewOf, writeUsersOr503, } from "./user-admin-common.js";
import { handleUserDelete, handleUserUpdate } from "./user-admin-mutations.js";
/** 用户管理端点路径（exact；`/auth` 白名单内，端点自做会话校验）。 */
export const USERS_PATH = "/auth/users";
/**
 * 注册 exact `/auth/users`（password 模式专属的用户管理 API）。method 内部分发：
 * GET 列表 / POST 新增 / PATCH 变更（密码、disabled、totp）/ DELETE 删除。
 * 全部要求有效会话（cookie 或 Bearer 会话 token，与门的会话模型一致）；写操作只收
 * `application/json`（表单无法伪造 JSON content-type，SameSite=Lax 之上再挡 CSRF）。
 */
export function registerUserAdminEndpoints(deps) {
    return deps.register({
        kind: "exact",
        path: USERS_PATH,
        handler: (req, res) => dispatch(deps, req, res),
    });
}
function dispatch(deps, req, res) {
    if (req.method === "GET")
        return handleList(deps, req, res);
    if (req.method === "POST")
        return handleCreate(deps, req, res);
    if (req.method === "PATCH")
        return handleUserUpdate(deps, req, res);
    if (req.method === "DELETE")
        return handleUserDelete(deps, req, res);
    res.setHeader("cache-control", "no-store");
    res.writeHead(405, { allow: "GET, POST, PATCH, DELETE", "content-type": "text/plain" });
    res.end("method not allowed");
}
/** GET /auth/users：按用户名字典序列出全部用户（含当前登录标记）。 */
async function handleList(deps, req, res) {
    const subject = requireSubject(deps, req, res);
    if (subject === undefined)
        return;
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    const users = [...loaded.snapshot.users.entries()]
        .sort(([a], [b]) => compareNames(a, b))
        .map(([username, record]) => viewOf(username, record, subject));
    sendJson(res, 200, { users });
}
/** POST /auth/users {username, password, disabled?}：新增用户（201）。 */
async function handleCreate(deps, req, res) {
    const subject = requireSubject(deps, req, res);
    if (subject === undefined)
        return;
    const body = await readJsonOrRespond(req, res);
    if (body === undefined)
        return;
    const username = typeof body["username"] === "string" ? body["username"] : "";
    if (!USERNAME_RE.test(username))
        return sendCode(res, 400, "invalid_username");
    const password = typeof body["password"] === "string" ? body["password"] : "";
    if (password === "")
        return sendCode(res, 400, "empty_password");
    const disabled = body["disabled"] === true;
    const loaded = await loadUsersOr503(deps, res);
    if (loaded === undefined)
        return;
    if (loaded.snapshot.users.has(username))
        return sendCode(res, 409, "duplicate");
    loaded.snapshot.users.set(username, { passwordHash: await hashPassword(password), disabled });
    if (!(await writeUsersOr503(deps, res, loaded.snapshot)))
        return;
    deps.logger.info(`user ${username} added via /auth/users`);
    sendJson(res, 201, { user: viewOf(username, { passwordHash: "", disabled }, subject) });
}
//# sourceMappingURL=user-admin-endpoints.js.map