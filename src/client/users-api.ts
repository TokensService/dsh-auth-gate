/**
 * `/auth/users` 管理 API 的浏览器封装（host 端 user-admin-endpoints 的契约镜像）。
 * 全部经同源 fetch，会话 cookie 自动携带；错误以稳定 code 返回（UI 按码本地化）。
 */

export interface AdminUser {
  username: string;
  disabled: boolean;
  totp: boolean;
  admin: boolean;
  current: boolean;
}

export type ListResult =
  { ok: true; users: AdminUser[] } | { ok: false; status: number; code: string };

export interface MutationResult {
  ok: boolean;
  status: number;
  /** 稳定错误码（host UserAdminErrorCode）；成功或无法归类时为 ""。 */
  code: string;
  totpSecret?: string;
  totpUri?: string;
}

export interface UserUpdate {
  username: string;
  password?: string;
  disabled?: boolean;
  totp?: "enable" | "disable";
}

/** GET /auth/users；404 = token 模式（端点未注册，落 /auth 兜底）。 */
export async function listUsers(): Promise<ListResult> {
  try {
    const res = await fetch("/auth/users");
    if (!res.ok) return { ok: false, status: res.status, code: await readErrorCode(res) };
    const body = (await res.json()) as { users?: unknown };
    const users = Array.isArray(body.users) ? (body.users as AdminUser[]) : [];
    return { ok: true, users };
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
}

export function createUser(username: string, password: string): Promise<MutationResult> {
  return mutate("POST", { username, password });
}

export function updateUser(update: UserUpdate): Promise<MutationResult> {
  const payload: Record<string, unknown> = { username: update.username };
  if (update.password !== undefined) payload["password"] = update.password;
  if (update.disabled !== undefined) payload["disabled"] = update.disabled;
  if (update.totp !== undefined) payload["totp"] = update.totp;
  return mutate("PATCH", payload);
}

export function deleteUser(username: string): Promise<MutationResult> {
  return mutate("DELETE", { username });
}

async function mutate(
  method: "POST" | "PATCH" | "DELETE",
  payload: Record<string, unknown>,
): Promise<MutationResult> {
  try {
    const res = await fetch("/auth/users", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: unknown;
      totpSecret?: unknown;
      totpUri?: unknown;
    };
    const result: MutationResult = {
      ok: res.ok,
      status: res.status,
      code: typeof body.error === "string" ? body.error : "",
    };
    if (typeof body.totpSecret === "string") result.totpSecret = body.totpSecret;
    if (typeof body.totpUri === "string") result.totpUri = body.totpUri;
    return result;
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
}

async function readErrorCode(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === "string" ? body.error : "";
}

/** 服务端导入目录里的候选文件（`imports/*.txt`）。 */
export interface ServerImportFile {
  name: string;
  size: number;
}

/** 批量导入的单行失败明细（host ImportFailure 镜像）。 */
export interface ImportFailure {
  line: number;
  username: string;
  code: string;
}

export interface ImportResult {
  ok: boolean;
  status: number;
  code: string;
  created?: number;
  failures?: ImportFailure[];
}

export type ServerFilesResult =
  { ok: true; files: ServerImportFile[] } | { ok: false; status: number; code: string };

/** GET /auth/users/import：服务端导入目录（imports/）里的 txt 列表。 */
export async function listServerImportFiles(): Promise<ServerFilesResult> {
  try {
    const res = await fetch("/auth/users/import");
    if (!res.ok) return { ok: false, status: res.status, code: await readErrorCode(res) };
    const body = (await res.json()) as { files?: unknown };
    const files = Array.isArray(body.files) ? (body.files as ServerImportFile[]) : [];
    return { ok: true, files };
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
}

/** POST 导入：本地文件原文（{text}）。 */
export function importUsersText(text: string): Promise<ImportResult> {
  return importMutate({ text });
}

/** POST 导入：服务端 imports/ 目录内文件（{file}）。 */
export function importUsersServerFile(name: string): Promise<ImportResult> {
  return importMutate({ file: name });
}

async function importMutate(payload: Record<string, unknown>): Promise<ImportResult> {
  try {
    const res = await fetch("/auth/users/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: unknown;
      created?: unknown;
      failures?: unknown;
    };
    const result: ImportResult = {
      ok: res.ok,
      status: res.status,
      code: typeof body.error === "string" ? body.error : "",
    };
    if (typeof body.created === "number") result.created = body.created;
    if (Array.isArray(body.failures)) result.failures = body.failures as ImportFailure[];
    return result;
  } catch {
    return { ok: false, status: 0, code: "network" };
  }
}
