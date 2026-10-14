import { describe, expect, it } from "vitest";
import { loginCookie, mountUsersStack, mutate, unmountStack } from "./integration-users-helpers.js";

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
          { username: "admin", disabled: false, totp: false, admin: true, current: true },
          { username: "disableduser", disabled: true, totp: false, admin: false, current: false },
          { username: "plain", disabled: false, totp: false, admin: false, current: false },
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
      expect(body.users.map((u) => u.username)).toEqual(["admin", "plain"]);
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

describe("integration: /auth/users RBAC (D13)", () => {
  it("restricts non-admin sessions to changing their own password", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base, "plain");
      const create = await mutate(base, "POST", cookie, { username: "carol", password: "pw4" });
      expect(create.status).toBe(403);
      expect(await create.json()).toEqual({ error: "forbidden" });
      const other = await mutate(base, "PATCH", cookie, { username: "admin", password: "pw4" });
      expect(other.status).toBe(403);
      const removed = await mutate(base, "DELETE", cookie, { username: "admin" });
      expect(removed.status).toBe(403);
      const own = await mutate(base, "PATCH", cookie, { username: "plain", password: "pw4" });
      expect(own.status).toBe(200);
      const relogin = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=plain&password=pw4",
        redirect: "manual",
      });
      expect(relogin.status).toBe(302);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("lets an admin grant and revoke the admin role over HTTP (D18)", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base);
      // 非 admin 会话伪造 admin 字段 → 403（对自己/对他人都一样）。
      const plainCookie = await loginCookie(base, "plain");
      const forged = await mutate(base, "PATCH", plainCookie, { username: "plain", admin: true });
      expect(forged.status).toBe(403);
      expect(await forged.json()).toEqual({ error: "forbidden" });
      const grant = await mutate(base, "PATCH", cookie, { username: "plain", admin: true });
      expect(grant.status).toBe(200);
      expect(await grant.json()).toEqual({
        user: { username: "plain", disabled: false, totp: false, admin: true, current: false },
      });
      // 角色按记录判定：plain 授权前签发的会话立即获得管理权（无需重新登录）。
      const promoted = await mutate(base, "POST", plainCookie, {
        username: "carol",
        password: "pw5",
      });
      expect(promoted.status).toBe(201);
      // 自我降权被拒（脚下枪护栏）。
      const selfDemote = await mutate(base, "PATCH", cookie, { username: "admin", admin: false });
      expect(selfDemote.status).toBe(409);
      expect(await selfDemote.json()).toEqual({ error: "self_target" });
      // 回收后 plain 的存量会话立即失去管理权（fail-closed）。
      const revoke = await mutate(base, "PATCH", cookie, { username: "plain", admin: false });
      expect(revoke.status).toBe(200);
      const denied = await mutate(base, "POST", plainCookie, { username: "dave", password: "pw6" });
      expect(denied.status).toBe(403);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
