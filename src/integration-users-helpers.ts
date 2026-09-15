import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";
import { hashPassword } from "./features/password/index.js";
import { writeUsersFile } from "./shared/index.js";

export type RealServer = WrappableServer & { readonly port: number };

export const TEST_PASSWORD = "s3cret-pw";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 真实栈：storage-json + storage-domain + WebServer + 插件（password 模式）。 */
export async function mountUsersStack(): Promise<{
  ctx: Context;
  port: number;
  fibers: Fiber[];
  root: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-users-it-"));
  const usersFile = join(root, "users.yaml");
  await writeUsersFile(usersFile, {
    users: new Map([
      [
        "admin",
        { passwordHash: await hashPassword(TEST_PASSWORD), disabled: false, role: "admin" },
      ],
      ["disableduser", { passwordHash: await hashPassword(TEST_PASSWORD), disabled: true }],
      ["plain", { passwordHash: await hashPassword(TEST_PASSWORD), disabled: false }],
    ]),
  });
  const ctx = new Context();
  const fibers: Fiber[] = [];
  fibers.push(await ctx.plugin(Storage));
  fibers.push(
    await ctx.plugin(
      {
        name: storageJson.name,
        inject: storageJson.inject,
        apply: storageJson.apply,
        Config: storageJson.Config,
      },
      { root },
    ),
  );
  fibers.push(
    await ctx.plugin(
      {
        name: storageDomain.name,
        inject: storageDomain.inject,
        apply: storageDomain.apply,
        Config: storageDomain.Config,
      },
      { backend: "json" },
    ),
  );
  fibers.push(await ctx.plugin(WebServer, { host: "127.0.0.1", port: 0 }));
  fibers.push(
    await ctx.plugin({ name, inject, apply, Config }, {
      mode: "password",
      cookieSecure: false,
      usersFile,
    } as AuthConfig),
  );
  const server = ctx.get("webServer") as unknown as RealServer;
  await waitFor(() => ctx.get("auth")!.sessions !== undefined);
  return { ctx, port: server.port, fibers, root };
}

export async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

/** 真实登录拿会话 cookie（默认 admin / TEST_PASSWORD）。 */
export async function loginCookie(base: string, username = "admin"): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `username=${username}&password=${encodeURIComponent(TEST_PASSWORD)}`,
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeDefined();
  return cookie!;
}

export function mutate(
  base: string,
  method: string,
  cookie: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${base}/auth/users`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

export function importCall(
  base: string,
  method: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${base}/auth/users/import`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
