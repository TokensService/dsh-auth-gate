import type { KvTable } from "@deepseek-ai/dsh-storage-domain";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HttpHandler } from "../src/gate/index.js";
import { SessionStore, type Session } from "../src/session/index.js";
import {
  loadUsersFile,
  writeUsersFile,
  type UserRecord,
  type UsersSnapshot,
} from "../src/shared/index.js";
import { hashPassword } from "../src/features/password/password.js";
import {
  registerUserAdminEndpoints,
  USERS_PATH,
  type UserAdminDeps,
} from "../src/features/password/user-admin-endpoints.js";

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
  handler: HttpHandler;
  store: SessionStore;
  usersFile: string;
  logs: { level: string; message: unknown }[];
  /** 以指定用户身份建会话（默认 alice），返回 Cookie 头值。 */
  cookieFor(username?: string): Promise<string>;
  call(req: IncomingMessage): Promise<FakeRes>;
  snapshot(): Promise<UsersSnapshot>;
  cleanup(): void;
}

/**
 * /auth/users 测试基座：临时目录里的真实 users.yaml（load/write 走真实
 * loadUsersFile/writeUsersFile 往返）+ 内存会话表。初始用户 alice（admin，enabled）+
 * bob（非 admin，enabled；可换）。TOTP 注入固定假值（确定性断言）。
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
  const routes: { kind: "exact" | "prefix"; path: string; handler: HttpHandler }[] = [];
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
  const route = routes.find((r) => r.kind === "exact" && r.path === USERS_PATH);
  if (route === undefined) throw new Error("users route not registered");
  const handler = route.handler;
  return {
    deps,
    handler,
    store,
    usersFile,
    logs,
    cookieFor: async (username = "alice") =>
      `dsh_auth=${(await store.create(username, 60_000)).token}`,
    call: async (req) => {
      const res = makeRes();
      await handler(req, res.res);
      return res;
    },
    snapshot: async () => (await loadUsersFile(usersFile)).snapshot,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
