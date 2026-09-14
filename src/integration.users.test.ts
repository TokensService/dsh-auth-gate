import { Context, type Fiber } from "@deepseek-ai/cordis";
import { WebServer } from "@deepseek-ai/dsh-host-webserver";
import { Storage } from "@deepseek-ai/dsh-storage";
import * as storageDomain from "@deepseek-ai/dsh-storage-domain";
import * as storageJson from "@deepseek-ai/dsh-storage-json";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WrappableServer } from "./gate/index.js";
import { apply, Config, inject, name, type AuthConfig } from "./index.js";
import { hashPassword } from "./features/password/index.js";
import { writeUsersFile } from "./shared/index.js";

type RealServer = WrappableServer & { readonly port: number };

const TEST_PASSWORD = "s3cret-pw";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** 真实栈：storage-json + storage-domain + WebServer + 插件（password 模式）。 */
async function mountUsersStack(): Promise<{
  ctx: Context;
  port: number;
  fibers: Fiber[];
  root: string;
}> {
  const root = mkdtempSync(join(tmpdir(), "dsh-auth-users-it-"));
  const usersFile = join(root, "users.yaml");
  await writeUsersFile(usersFile, {
    users: new Map([
      ["admin", { passwordHash: await hashPassword(TEST_PASSWORD), disabled: false }],
      ["disableduser", { passwordHash: await hashPassword(TEST_PASSWORD), disabled: true }],
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

async function unmountStack(fibers: Fiber[], root: string): Promise<void> {
  for (const fiber of [...fibers].reverse()) {
    await fiber.dispose();
  }
  rmSync(root, { recursive: true, force: true });
}

/** 真实登录拿会话 cookie（admin / TEST_PASSWORD）。 */
async function loginCookie(base: string): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `username=admin&password=${encodeURIComponent(TEST_PASSWORD)}`,
    redirect: "manual",
  });
  expect(res.status).toBe(302);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeDefined();
  return cookie!;
}

function mutate(base: string, method: string, cookie: string, body: unknown): Promise<Response> {
  return fetch(`${base}/auth/users`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

describe("integration: /auth/users over real HTTP", () => {
  it("rejects unauthenticated calls and lists users for a session", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const anon = await fetch(`${base}/auth/users`);
      expect(anon.status).toBe(401);
      expect(await anon.json()).toEqual({ error: "unauthorized" });

      const cookie = await loginCookie(base);
      const list = await fetch(`${base}/auth/users`, { headers: { cookie } });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({
        users: [
          { username: "admin", disabled: false, totp: false, current: true },
          { username: "disableduser", disabled: true, totp: false, current: false },
        ],
      });
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("creates a user that can sign in for real, and rejects duplicates", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base);
      const created = await mutate(base, "POST", cookie, { username: "carol", password: "pw3" });
      expect(created.status).toBe(201);
      const dup = await mutate(base, "POST", cookie, { username: "carol", password: "pw3" });
      expect(dup.status).toBe(409);
      expect(await dup.json()).toEqual({ error: "duplicate" });

      const login = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=carol&password=pw3",
        redirect: "manual",
      });
      expect(login.status).toBe(302);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("enforces self/last-enabled protections and deletes a disabled user", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base);
      const self = await mutate(base, "PATCH", cookie, { username: "admin", disabled: true });
      expect(self.status).toBe(409);
      expect(await self.json()).toEqual({ error: "self_target" });
      const removed = await mutate(base, "DELETE", cookie, { username: "disableduser" });
      expect(removed.status).toBe(200);
      const list = await fetch(`${base}/auth/users`, { headers: { cookie } });
      const body = (await list.json()) as { users: { username: string }[] };
      expect(body.users.map((u) => u.username)).toEqual(["admin"]);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("answers 405 for PUT and 415 for a non-json content type", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base);
      const put = await mutate(base, "PUT", cookie, {});
      expect(put.status).toBe(405);
      const form = await fetch(`${base}/auth/users`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie },
        body: "username=carol&password=x",
      });
      expect(form.status).toBe(415);
      expect(await form.json()).toEqual({ error: "unsupported_media_type" });
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
