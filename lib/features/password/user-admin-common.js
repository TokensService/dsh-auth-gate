import { parseCookieHeader, } from "../../shared/index.js";
/** 管理 API 的 JSON 请求体上限（与 M10 urlencoded 同量级）。 */
const JSON_BODY_LIMIT = 16 * 1024;
export function viewOf(username, record, subject) {
    return {
        username,
        disabled: record.disabled,
        totp: record.totpSecret !== undefined,
        current: username === subject,
    };
}
export function enabledCount(snapshot) {
    let count = 0;
    for (const record of snapshot.users.values()) {
        if (!record.disabled)
            count += 1;
    }
    return count;
}
/** 会话门：store 缺失 503、无有效会话 401（JSON）；通过返回会话 subject。 */
export function requireSubject(deps, req, res) {
    const store = deps.sessions();
    if (store === undefined) {
        sendCode(res, 503, "store_unavailable");
        return undefined;
    }
    const session = sessionOf(deps, store, req);
    if (session === undefined) {
        sendCode(res, 401, "unauthorized");
        return undefined;
    }
    return session.subject;
}
/** cookie 优先、Bearer 会话 token 兜底（与 PasswordGate 的会话判定同形）。 */
function sessionOf(deps, store, req) {
    const cookie = parseCookieHeader(req.headers.cookie, deps.cookieName);
    if (cookie !== undefined && cookie !== "") {
        const session = store.getByToken(cookie);
        if (session !== undefined)
            return session;
    }
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
    const bearer = match?.[1];
    return bearer === undefined ? undefined : store.getByToken(bearer);
}
/** 读取 JSON 对象请求体；失败已写响应（415/413/400）并返回 undefined。 */
export async function readJsonOrRespond(req, res) {
    try {
        return await readJsonBody(req);
    }
    catch (error) {
        const failed = error;
        if (typeof failed.status !== "number" || failed.code === undefined)
            throw error;
        if (failed.status === 413)
            res.setHeader("connection", "close");
        sendCode(res, failed.status, failed.code);
        return undefined;
    }
}
/** 与 parseFormBody 同纪律：415/413 带 status 抛出；流异常（abort 等）不捕获。 */
async function readJsonBody(req) {
    const rawType = req.headers["content-type"];
    const mediaType = typeof rawType === "string" ? rawType.split(";")[0]?.trim().toLowerCase() : undefined;
    if (mediaType !== "application/json") {
        throw Object.assign(new Error("unsupported media type"), {
            status: 415,
            code: "unsupported_media_type",
        });
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > JSON_BODY_LIMIT) {
            throw Object.assign(new Error("request body too large"), {
                status: 413,
                code: "body_too_large",
            });
        }
        chunks.push(buffer);
    }
    let parsed;
    try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    }
    catch {
        throw Object.assign(new Error("invalid json"), { status: 400, code: "bad_json" });
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw Object.assign(new Error("invalid json"), { status: 400, code: "bad_json" });
    }
    return parsed;
}
export async function loadUsersOr503(deps, res) {
    try {
        return await deps.loadUsers();
    }
    catch (error) {
        deps.logger.error(`user store unavailable (${deps.usersPath}): ${errorMessage(error)}`);
        sendCode(res, 503, "user_store_unavailable");
        return undefined;
    }
}
export async function writeUsersOr503(deps, res, snapshot) {
    try {
        await deps.writeUsers(snapshot);
        return true;
    }
    catch (error) {
        deps.logger.error(`user store write failed (${deps.usersPath}): ${errorMessage(error)}`);
        sendCode(res, 503, "user_store_unavailable");
        return false;
    }
}
export function sendJson(res, status, body) {
    res.setHeader("cache-control", "no-store");
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}
export function sendCode(res, status, code) {
    sendJson(res, status, { error: code });
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=user-admin-common.js.map