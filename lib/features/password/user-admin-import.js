import { promises as fs } from "node:fs";
import path from "node:path";
import { USERNAME_RE } from "../../shared/index.js";
import { hashPassword } from "./password.js";
import { readJsonOrRespond, requireAdmin, sendCode, sendJson, viewOf, writeUsersOr503, } from "./user-admin-common.js";
/** 批量导入端点路径（exact；`/auth` 白名单内，端点自做会话+admin 校验）。 */
export const USERS_IMPORT_PATH = "/auth/users/import";
/** 导入请求体 / 服务端文件上限（批量场景较 M10 放宽，仍硬封顶）。 */
export const IMPORT_BODY_LIMIT = 256 * 1024;
/** 单次导入条目上限：scrypt 成本随条目线性（libuv 线程池并行，100 条 ≈ 秒级）。 */
export const IMPORT_MAX_ENTRIES = 100;
/** 响应里最多带回的失败明细条数。 */
const MAX_FAILURES_REPORTED = 50;
/**
 * 注册 exact `/auth/users/import`（D14：txt 批量导入；D15 改任意绝对路径）。
 * 仅 POST，二选一：`{text}`（本地文件原文）、`{path}`（服务器上 `.txt` 的
 * 绝对路径），全量校验后原子写入（all-or-nothing）。
 * 仅 admin；非 admin → 403 forbidden。
 */
export function registerUserImportEndpoints(deps) {
    return deps.register({
        kind: "exact",
        path: USERS_IMPORT_PATH,
        handler: (req, res) => dispatch(deps, req, res),
    });
}
function dispatch(deps, req, res) {
    if (req.method === "POST")
        return handleImport(deps, req, res);
    res.setHeader("cache-control", "no-store");
    res.writeHead(405, { allow: "POST", "content-type": "text/plain" });
    res.end("method not allowed");
}
/** POST /auth/users/import {text} | {path}：解析 → 全量校验 → 原子写入。 */
async function handleImport(deps, req, res) {
    const admin = await requireAdmin(deps, req, res);
    if (admin === undefined)
        return;
    const body = await readJsonOrRespond(req, res, IMPORT_BODY_LIMIT);
    if (body === undefined)
        return;
    const source = await resolveImportContent(deps, res, body);
    if (source === undefined)
        return;
    const { entries, failures } = collectEntries(source.content, admin.snapshot);
    if (entries.length > IMPORT_MAX_ENTRIES)
        return sendCode(res, 400, "too_many_entries");
    if (failures.length > 0) {
        sendJson(res, 400, {
            error: "invalid_entry",
            failures: failures.slice(0, MAX_FAILURES_REPORTED),
        });
        return;
    }
    if (entries.length === 0)
        return sendCode(res, 400, "no_entries");
    const hashes = await Promise.all(entries.map((entry) => hashPassword(entry.password)));
    entries.forEach((entry, index) => {
        admin.snapshot.users.set(entry.username, {
            passwordHash: hashes[index] ?? "",
            disabled: false,
        });
    });
    if (!(await writeUsersOr503(deps, res, admin.snapshot)))
        return;
    deps.logger.info(`imported ${entries.length} users via /auth/users/import (${source.label})`);
    sendJson(res, 201, {
        created: entries.length,
        users: entries.map((entry) => viewOf(entry.username, { passwordHash: "", disabled: false }, admin.subject)),
    });
}
/**
 * 从请求体取唯一来源（text/path 二选一，否则 400 invalid_field）并读到原文；
 * 失败已写响应（400/404/413/503）并返回 undefined。
 */
async function resolveImportContent(deps, res, body) {
    const text = typeof body["text"] === "string" ? body["text"] : undefined;
    const serverPath = typeof body["path"] === "string" ? body["path"] : undefined;
    if ((text === undefined) === (serverPath === undefined)) {
        sendCode(res, 400, "invalid_field");
        return undefined;
    }
    if (text !== undefined)
        return { content: text, label: "inline text" };
    const content = await readServerImportPath(deps, res, serverPath ?? "");
    return content === undefined ? undefined : { content, label: `server path ${serverPath ?? ""}` };
}
/**
 * 读取服务器上任意绝对路径的 txt（D15）：非绝对路径、含 NUL、非 `.txt` 后缀
 * 一律 404（不提供「哪种路径合法」的探测面）。
 */
async function readServerImportPath(deps, res, rawPath) {
    const trimmed = rawPath.trim();
    const invalid = trimmed === "" ||
        trimmed.includes("\0") ||
        !path.isAbsolute(trimmed) ||
        !trimmed.endsWith(".txt");
    if (invalid) {
        sendCode(res, 404, "import_file_not_found");
        return undefined;
    }
    return readImportFile(deps, res, trimmed);
}
/** stat + 读全文（服务端文件来源共用）；失败已写响应（404/413/503）。 */
async function readImportFile(deps, res, filePath) {
    try {
        const stat = await fs.stat(filePath);
        if (!stat.isFile()) {
            sendCode(res, 404, "import_file_not_found");
            return undefined;
        }
        if (stat.size > IMPORT_BODY_LIMIT) {
            sendCode(res, 413, "import_file_too_large");
            return undefined;
        }
        return await fs.readFile(filePath, "utf8");
    }
    catch (error) {
        if (isEnoent(error)) {
            sendCode(res, 404, "import_file_not_found");
            return undefined;
        }
        deps.logger.error(`import file unreadable (${filePath}): ${errorMessage(error)}`);
        sendCode(res, 503, "user_store_unavailable");
        return undefined;
    }
}
/** 解析 + 逐行校验 + 去重（批次内与既有用户）；entries 与 failures 都按行号顺序。 */
function collectEntries(text, snapshot) {
    const { entries, failures } = parseImportText(text);
    const seen = new Set();
    const kept = [];
    for (const entry of entries) {
        if (seen.has(entry.username) || snapshot.users.has(entry.username)) {
            failures.push({ line: entry.line, username: entry.username, code: "duplicate" });
            continue;
        }
        seen.add(entry.username);
        kept.push(entry);
    }
    return { entries: kept, failures };
}
/**
 * 逐行解析 `用户名,密码`：跳过空行与 `#` 注释；首个逗号前为用户名
 * （用户名本身不含逗号），其余为密码（两端空白裁剪）。
 */
export function parseImportText(text) {
    const entries = [];
    const failures = [];
    text.split(/\r?\n/).forEach((raw, index) => {
        const line = index + 1;
        const trimmed = raw.trim();
        if (trimmed === "" || trimmed.startsWith("#"))
            return;
        const comma = trimmed.indexOf(",");
        const username = (comma === -1 ? trimmed : trimmed.slice(0, comma)).trim();
        const password = comma === -1 ? "" : trimmed.slice(comma + 1).trim();
        if (!USERNAME_RE.test(username)) {
            failures.push({ line, username, code: "invalid_username" });
            return;
        }
        if (password === "") {
            failures.push({ line, username, code: "empty_password" });
            return;
        }
        entries.push({ line, username, password });
    });
    return { entries, failures };
}
function isEnoent(error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=user-admin-import.js.map