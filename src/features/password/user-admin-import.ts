import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { compareNames, USERNAME_RE } from "../../shared/index.js";
import { hashPassword } from "./password.js";
import {
  readJsonOrRespond,
  requireAdmin,
  sendCode,
  sendJson,
  viewOf,
  writeUsersOr503,
  type UserAdminDeps,
  type UserAdminErrorCode,
} from "./user-admin-common.js";

/** 批量导入端点路径（exact；`/auth` 白名单内，端点自做会话+admin 校验）。 */
export const USERS_IMPORT_PATH = "/auth/users/import";

/** 导入请求体 / 服务端文件上限（批量场景较 M10 放宽，仍硬封顶）。 */
export const IMPORT_BODY_LIMIT = 256 * 1024;

/** 单次导入条目上限：scrypt 成本随条目线性（libuv 线程池并行，100 条 ≈ 秒级）。 */
export const IMPORT_MAX_ENTRIES = 100;

/** 响应里最多带回的失败明细条数。 */
const MAX_FAILURES_REPORTED = 50;

/** 服务端导入文件名白名单：basename 形态 + `.txt`（无路径分隔符 → 不可目录遍历）。 */
const SERVER_FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,125}\.txt$/;

/** 单行校验失败明细（line 为 1 起始行号，client 按 code 本地化）。 */
export interface ImportFailure {
  line: number;
  username: string;
  code: UserAdminErrorCode;
}

interface ImportEntry {
  line: number;
  username: string;
  password: string;
}

/**
 * 注册 exact `/auth/users/import`（D14：txt 批量导入）。GET 列出服务端导入目录
 * （`<usersDir>/imports/`）里的 `.txt` 文件；POST `{text}`（本地文件原文）或
 * `{file}`（服务端目录内文件名）二选一，全量校验后原子写入（all-or-nothing）。
 * 仅 admin；非 admin → 403 forbidden。
 */
export function registerUserImportEndpoints(deps: UserAdminDeps): () => void {
  return deps.register({
    kind: "exact",
    path: USERS_IMPORT_PATH,
    handler: (req, res) => dispatch(deps, req, res),
  });
}

function dispatch(
  deps: UserAdminDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> | void {
  if (req.method === "GET") return handleListFiles(deps, req, res);
  if (req.method === "POST") return handleImport(deps, req, res);
  res.setHeader("cache-control", "no-store");
  res.writeHead(405, { allow: "GET, POST", "content-type": "text/plain" });
  res.end("method not allowed");
}

/** GET /auth/users/import：列出服务端导入目录的候选 txt（name+size，字典序）。 */
async function handleListFiles(
  deps: UserAdminDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const admin = await requireAdmin(deps, req, res);
  if (admin === undefined) return;
  const dir = importsDirOf(deps.usersPath);
  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      sendJson(res, 200, { files: [] });
      return;
    }
    deps.logger.error(`imports dir unreadable (${dir}): ${errorMessage(error)}`);
    sendCode(res, 503, "user_store_unavailable");
    return;
  }
  const files: { name: string; size: number }[] = [];
  for (const dirent of dirents) {
    if (!dirent.isFile() || !SERVER_FILE_RE.test(dirent.name)) continue;
    try {
      files.push({ name: dirent.name, size: (await fs.stat(path.join(dir, dirent.name))).size });
    } catch {
      // 列出与 stat 之间的删除竞争：跳过该文件即可。
    }
  }
  files.sort((a, b) => compareNames(a.name, b.name));
  sendJson(res, 200, { files });
}

/** POST /auth/users/import {text} | {file}：解析 → 全量校验 → 原子写入。 */
async function handleImport(
  deps: UserAdminDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const admin = await requireAdmin(deps, req, res);
  if (admin === undefined) return;
  const body = await readJsonOrRespond(req, res, IMPORT_BODY_LIMIT);
  if (body === undefined) return;
  const text = typeof body["text"] === "string" ? body["text"] : undefined;
  const file = typeof body["file"] === "string" ? body["file"] : undefined;
  if ((text === undefined) === (file === undefined)) return sendCode(res, 400, "invalid_field");
  let content: string | undefined;
  if (text !== undefined) {
    content = text;
  } else {
    content = await readServerImportFile(deps, res, file ?? "");
  }
  if (content === undefined) return;
  const { entries, failures } = collectEntries(content, admin.snapshot);
  if (entries.length > IMPORT_MAX_ENTRIES) return sendCode(res, 400, "too_many_entries");
  if (failures.length > 0) {
    sendJson(res, 400, {
      error: "invalid_entry",
      failures: failures.slice(0, MAX_FAILURES_REPORTED),
    });
    return;
  }
  if (entries.length === 0) return sendCode(res, 400, "no_entries");
  const hashes = await Promise.all(entries.map((entry) => hashPassword(entry.password)));
  entries.forEach((entry, index) => {
    admin.snapshot.users.set(entry.username, {
      passwordHash: hashes[index] ?? "",
      disabled: false,
    });
  });
  if (!(await writeUsersOr503(deps, res, admin.snapshot))) return;
  deps.logger.info(
    `imported ${entries.length} users via /auth/users/import (${text === undefined ? `server file ${file}` : "inline text"})`,
  );
  sendJson(res, 201, {
    created: entries.length,
    users: entries.map((entry) =>
      viewOf(entry.username, { passwordHash: "", disabled: false }, admin.subject),
    ),
  });
}

/** 读取服务端导入目录内的 txt；失败已写响应（404/413/503）并返回 undefined。 */
async function readServerImportFile(
  deps: UserAdminDeps,
  res: ServerResponse,
  name: string,
): Promise<string | undefined> {
  if (!SERVER_FILE_RE.test(name)) {
    sendCode(res, 404, "import_file_not_found");
    return undefined;
  }
  const filePath = path.join(importsDirOf(deps.usersPath), name);
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
  } catch (error) {
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
function collectEntries(
  text: string,
  snapshot: { users: Map<string, unknown> },
): { entries: ImportEntry[]; failures: ImportFailure[] } {
  const { entries, failures } = parseImportText(text);
  const seen = new Set<string>();
  const kept: ImportEntry[] = [];
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
export function parseImportText(text: string): {
  entries: ImportEntry[];
  failures: ImportFailure[];
} {
  const entries: ImportEntry[] = [];
  const failures: ImportFailure[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
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

/** 服务端导入目录：与 users.yaml 同级的 `imports/`（固定沙箱，D14）。 */
function importsDirOf(usersPath: string): string {
  return path.join(path.dirname(usersPath), "imports");
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
