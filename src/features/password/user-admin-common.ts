import type { IncomingMessage, ServerResponse } from "node:http";
import {
  parseCookieHeader,
  type UserRecord,
  type UsersLoadResult,
  type UsersSnapshot,
} from "../../shared/index.js";
import type { HttpHandler } from "../../gate/index.js";
import type { Session, SessionStore } from "../../session/index.js";

/** 管理 API 的 JSON 请求体上限（与 M10 urlencoded 同量级）。 */
const JSON_BODY_LIMIT = 16 * 1024;

/** 管理 API 的稳定错误码（client 按码本地化，不依赖英文文案）。 */
export type UserAdminErrorCode =
  | "unauthorized"
  | "forbidden"
  | "store_unavailable"
  | "user_store_unavailable"
  | "bad_json"
  | "unsupported_media_type"
  | "body_too_large"
  | "invalid_username"
  | "empty_password"
  | "invalid_field"
  | "nothing_to_update"
  | "duplicate"
  | "not_found"
  | "self_target"
  | "last_enabled"
  | "totp_exists"
  | "invalid_entry"
  | "no_entries"
  | "too_many_entries"
  | "import_file_not_found"
  | "import_file_too_large";

export interface UserAdminDeps {
  /** 注册路由（index.ts 传入包装后的 server.register；/auth 白名单放行，端点自校验会话）。 */
  register(route: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }): () => void;
  sessions: () => SessionStore | undefined;
  cookieName: string;
  /** 仅用于错误日志（用户文件读写失败时定位）。 */
  usersPath: string;
  loadUsers: () => Promise<UsersLoadResult>;
  writeUsers: (snapshot: UsersSnapshot) => Promise<void>;
  /** 注入的 TOTP secret 生成（index.ts 从 features/totp 装配；同层互禁，D9 模式）。 */
  generateTotpSecret: () => string;
  /** 注入的 otpauth URI 拼装（同上）。 */
  totpUri: (name: string, secret: string) => string;
  logger: {
    error(message: unknown): void;
    info(message: unknown): void;
  };
}

/** 列表/变更响应里的用户视图（永不包含 hash/secret）。 */
export interface UserView {
  username: string;
  disabled: boolean;
  totp: boolean;
  admin: boolean;
  current: boolean;
}

export function viewOf(username: string, record: UserRecord, subject: string): UserView {
  return {
    username,
    disabled: record.disabled,
    totp: record.totpSecret !== undefined,
    admin: record.role === "admin",
    current: username === subject,
  };
}

/** subject 是否为管理员（D13）：users.yaml 里 `role: admin`；缺省/无记录均非管理员。 */
export function isAdmin(snapshot: UsersSnapshot, subject: string): boolean {
  return snapshot.users.get(subject)?.role === "admin";
}

/**
 * 会话门 + 管理员门（D13/D14）：store 缺失 503、无会话 401、非 admin 403；
 * 通过返回 subject 与已加载快照（调用方继续用同一快照做写操作）。
 */
export async function requireAdmin(
  deps: UserAdminDeps,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ subject: string; snapshot: UsersSnapshot } | undefined> {
  const subject = requireSubject(deps, req, res);
  if (subject === undefined) return undefined;
  const loaded = await loadUsersOr503(deps, res);
  if (loaded === undefined) return undefined;
  if (!isAdmin(loaded.snapshot, subject)) {
    sendCode(res, 403, "forbidden");
    return undefined;
  }
  return { subject, snapshot: loaded.snapshot };
}

export function enabledCount(snapshot: UsersSnapshot): number {
  let count = 0;
  for (const record of snapshot.users.values()) {
    if (!record.disabled) count += 1;
  }
  return count;
}

/** 会话门：store 缺失 503、无有效会话 401（JSON）；通过返回会话 subject。 */
export function requireSubject(
  deps: UserAdminDeps,
  req: IncomingMessage,
  res: ServerResponse,
): string | undefined {
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
function sessionOf(
  deps: UserAdminDeps,
  store: SessionStore,
  req: IncomingMessage,
): Session | undefined {
  const cookie = parseCookieHeader(req.headers.cookie, deps.cookieName);
  if (cookie !== undefined && cookie !== "") {
    const session = store.getByToken(cookie);
    if (session !== undefined) return session;
  }
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  const bearer = match?.[1];
  return bearer === undefined ? undefined : store.getByToken(bearer);
}

/** 读取 JSON 对象请求体；失败已写响应（415/413/400）并返回 undefined。 */
export async function readJsonOrRespond(
  req: IncomingMessage,
  res: ServerResponse,
  limit = JSON_BODY_LIMIT,
): Promise<Record<string, unknown> | undefined> {
  try {
    return await readJsonBody(req, limit);
  } catch (error) {
    const failed = error as { status?: number; code?: string };
    if (typeof failed.status !== "number" || failed.code === undefined) throw error;
    if (failed.status === 413) res.setHeader("connection", "close");
    sendCode(res, failed.status, failed.code as UserAdminErrorCode);
    return undefined;
  }
}

/** 与 parseFormBody 同纪律：415/413 带 status 抛出；流异常（abort 等）不捕获。 */
async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const rawType = req.headers["content-type"];
  const mediaType =
    typeof rawType === "string" ? rawType.split(";")[0]?.trim().toLowerCase() : undefined;
  if (mediaType !== "application/json") {
    throw Object.assign(new Error("unsupported media type"), {
      status: 415,
      code: "unsupported_media_type",
    });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > limit) {
      throw Object.assign(new Error("request body too large"), {
        status: 413,
        code: "body_too_large",
      });
    }
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("invalid json"), { status: 400, code: "bad_json" });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw Object.assign(new Error("invalid json"), { status: 400, code: "bad_json" });
  }
  return parsed as Record<string, unknown>;
}

export async function loadUsersOr503(
  deps: UserAdminDeps,
  res: ServerResponse,
): Promise<UsersLoadResult | undefined> {
  try {
    return await deps.loadUsers();
  } catch (error) {
    deps.logger.error(`user store unavailable (${deps.usersPath}): ${errorMessage(error)}`);
    sendCode(res, 503, "user_store_unavailable");
    return undefined;
  }
}

export async function writeUsersOr503(
  deps: UserAdminDeps,
  res: ServerResponse,
  snapshot: UsersSnapshot,
): Promise<boolean> {
  try {
    await deps.writeUsers(snapshot);
    return true;
  } catch (error) {
    deps.logger.error(`user store write failed (${deps.usersPath}): ${errorMessage(error)}`);
    sendCode(res, 503, "user_store_unavailable");
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.setHeader("cache-control", "no-store");
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function sendCode(res: ServerResponse, status: number, code: UserAdminErrorCode): void {
  sendJson(res, status, { error: code });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
