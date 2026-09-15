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
});
