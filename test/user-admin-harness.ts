import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpHandler } from "../src/gate/index.js";
import { SessionStore, type Session } from "../src/session/index.js";
import {
  loadSettingsFile,
  loadUsersFile,
  writeSettingsFile,
  writeUsersFile,
  type UserRecord,
  type UsersSnapshot,
} from "../src/shared/index.js";
import { hashPassword } from "../src/features/password/password.js";
import {
  registerSessionSettingsEndpoints,
  SETTINGS_PATH,
  type SessionSettingsDeps,
} from "../src/features/password/session-settings-endpoints.js";
import {
  registerUserAdminEndpoints,
  USERS_PATH,
  type UserAdminDeps,
} from "../src/features/password/user-admin-endpoints.js";
import {
  registerUserImportEndpoints,
  USERS_IMPORT_PATH,
} from "../src/features/password/user-admin-import.js";

/** 共享内存 KvTable（SessionStore 测试基座；与 src 内各测试的 MemTable 同构）。 */
export class MemTable implements KvTable<string, Session> {
  private readonly map = new Map<string, Session>();

  get size(): number {
    return this.map.size;
  }

  get(key: string): Session | undefined {
    return this.map.get(key);
  }

  entries(): IterableIterator<[string, Session]> {
    return this.map.entries();
  }

  keys(): IterableIterator<string> {
    return this.map.keys();
  }

  put(key: string, value: Session): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<boolean> {
    return Promise.resolve(this.map.delete(key));
  }

  update(key: string, fn: (current: Session) => Session): Promise<Session> {
    const current = this.map.get(key);
    if (current === undefined) throw new Error("missing-key");
    const next = fn(current);
    this.map.set(key, next);
    return Promise.resolve(next);
  }
}

export interface FakeRes {
  res: ServerResponse;
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
}

export function makeRes(): FakeRes {
  const state = {
    status: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: "",
  };
  const res = {
    setHeader: (name: string, value: string): void => {
      state.headers[name.toLowerCase()] = String(value);
    },
    writeHead: (status: number, extra?: Record<string, string | number>): void => {
      state.status = status;
      for (const [name, value] of Object.entries(extra ?? {})) {
        state.headers[name.toLowerCase()] = String(value);
      }
    },
    end: (body?: string): void => {
      state.body = body ?? "";
    },
  } as unknown as ServerResponse;
  return Object.assign(state, { res });
}

export function makeReq(options: {
  method?: string;
  cookie?: string;
  authorization?: string;
  contentType?: string;
  body?: unknown;
}): IncomingMessage {
  return {
    method: options.method ?? "GET",
    url: USERS_PATH,
    headers: {
      cookie: options.cookie,
      authorization: options.authorization,
      "content-type": options.contentType,
    },
    socket: { remoteAddress: "127.0.0.1" },
    *[Symbol.asyncIterator](): Generator<Buffer> {
      if (options.body !== undefined) yield Buffer.from(JSON.stringify(options.body));
    },
  } as unknown as IncomingMessage;
}

export interface UserAdminHarness {
  deps: UserAdminDeps;
  settingsDeps: SessionSettingsDeps;
  handler: HttpHandler;
  importHandler: HttpHandler;
  settingsHandler: HttpHandler;
  store: SessionStore;
  usersFile: string;
  settingsFile: string;
  /** 临时目录根（users.yaml/settings.yaml 所在，也是导入测试放置 txt 的位置）。 */
  dir: string;
  logs: { level: string; message: unknown }[];
  /** 以指定用户身份建会话（默认 alice），返回 Cookie 头值。 */
  cookieFor(username?: string): Promise<string>;
  call(req: IncomingMessage): Promise<FakeRes>;
  callImport(req: IncomingMessage): Promise<FakeRes>;
  callSettings(req: IncomingMessage): Promise<FakeRes>;
  snapshot(): Promise<UsersSnapshot>;
  cleanup(): void;
}

interface Route {
  kind: "exact" | "prefix";
  path: string;
  handler: HttpHandler;
}

/** 按 exact path 取已注册 handler（缺失即测试装配错误，直接抛）。 */
function mustRoute(routes: Route[], path: string, label: string): HttpHandler {
  const route = routes.find((r) => r.kind === "exact" && r.path === path);
  if (route === undefined) throw new Error(`${label} route not registered`);
  return route.handler;
}

/** settings 端点子装配：与 users.yaml 同 tempdir 的 settings.yaml + defaultTtl 604800。 */
function registerSettings(
  deps: UserAdminDeps,
  dir: string,
): { settingsDeps: SessionSettingsDeps; settingsFile: string } {
  const settingsFile = join(dir, "settings.yaml");
  const settingsDeps: SessionSettingsDeps = {
    ...deps,
    settingsPath: settingsFile,
    loadSettings: () => loadSettingsFile(settingsFile),
    writeSettings: (settings) => writeSettingsFile(settingsFile, settings),
    defaultTtl: 604800,
  };
  registerSessionSettingsEndpoints(settingsDeps);
  return { settingsDeps, settingsFile };
}

/**
 * /auth/users 测试基座：临时目录里的真实 users.yaml + settings.yaml（load/write 走
 * 真实文件往返）+ 内存会话表。初始用户 alice（admin，enabled）+ bob（非 admin，
 * enabled；可换）。TOTP 注入固定假值（确定性断言）；settings 端点 defaultTtl 604800。
 */
export async function makeUserAdminHarness(options?: {
  alice?: Partial<UserRecord> & { passwordHash?: string };
  bob?: Partial<UserRecord> & { passwordHash?: string };
}): Promise<UserAdminHarness> {
  const dir = mkdtempSync(join(tmpdir(), "dsh-auth-users-"));
  const usersFile = join(dir, "users.yaml");
  const alice: UserRecord = {
    passwordHash: await hashPassword("alice-pw"),
    disabled: false,
    role: "admin",
    ...options?.alice,
  };
  const bob: UserRecord = {
    passwordHash: await hashPassword("bob-pw"),
    disabled: false,
    ...options?.bob,
  };
  await writeUsersFile(usersFile, {
    users: new Map([
      ["alice", alice],
      ["bob", bob],
    ]),
  });
  const store = new SessionStore(new MemTable());
  const logs: UserAdminHarness["logs"] = [];
  const routes: Route[] = [];
  const deps: UserAdminDeps = {
    register: (route) => {
      routes.push(route);
      return () => undefined;
    },
    sessions: () => store,
    cookieName: "dsh_auth",
    usersPath: usersFile,
    loadUsers: () => loadUsersFile(usersFile),
    writeUsers: (snapshot) => writeUsersFile(usersFile, snapshot),
    generateTotpSecret: () => "NEWSECRETB32",
    totpUri: (name, secret) => `otpauth://totp/dsh-auth:${name}?secret=${secret}`,
    logger: {
      error: (message) => logs.push({ level: "error", message }),
      info: (message) => logs.push({ level: "info", message }),
    },
  };
  registerUserAdminEndpoints(deps);
  registerUserImportEndpoints(deps);
  const { settingsDeps, settingsFile } = registerSettings(deps, dir);
  const handler = mustRoute(routes, USERS_PATH, "users");
  const importHandler = mustRoute(routes, USERS_IMPORT_PATH, "users import");
  const settingsHandler = mustRoute(routes, SETTINGS_PATH, "settings");
  const callWith =
    (target: HttpHandler) =>
    async (req: IncomingMessage): Promise<FakeRes> => {
      const res = makeRes();
      await target(req, res.res);
      return res;
    };
  return {
    deps,
    settingsDeps,
    handler,
    importHandler,
    settingsHandler,
    store,
    usersFile,
    settingsFile,
    dir,
    logs,
    cookieFor: async (username = "alice") =>
      `dsh_auth=${(await store.create(username, 60_000)).token}`,
    call: callWith(handler),
    callImport: callWith(importHandler),
    callSettings: callWith(settingsHandler),
    snapshot: async () => (await loadUsersFile(usersFile)).snapshot,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
