import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "./password.js";
import {
  makeReq,
  makeUserAdminHarness,
  type UserAdminHarness,
} from "../../../test/user-admin-harness.js";

const harnesses: UserAdminHarness[] = [];

async function makeHarness(
  options?: Parameters<typeof makeUserAdminHarness>[0],
): Promise<UserAdminHarness> {
  const h = await makeUserAdminHarness(options);
  harnesses.push(h);
  return h;
}

/** PATCH/DELETE 便捷调用（alice 会话 + JSON body）。 */
async function call(
  h: UserAdminHarness,
  method: string,
  body: unknown,
): Promise<{ status: number | undefined; body: string }> {
  return h.call(
    makeReq({ method, contentType: "application/json", body, cookie: await h.cookieFor() }),
  );
}

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()!.cleanup();
});

describe("PATCH /auth/users", () => {
  it("changes a password (new hash verifies, old password rejected)", async () => {
    const h = await makeHarness();
    const res = await call(h, "PATCH", { username: "bob", password: "new-pw" });
    expect(res.status).toBe(200);
    const bob = (await h.snapshot()).users.get("bob")!;
    await expect(verifyPassword("new-pw", bob.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("bob-pw", bob.passwordHash)).resolves.toBe(false);
  });

  it("disables and re-enables a user", async () => {
    const h = await makeHarness();
    expect((await call(h, "PATCH", { username: "bob", disabled: true })).status).toBe(200);
    expect((await h.snapshot()).users.get("bob")?.disabled).toBe(true);
    expect((await call(h, "PATCH", { username: "bob", disabled: false })).status).toBe(200);
    expect((await h.snapshot()).users.get("bob")?.disabled).toBe(false);
  });

  it("refuses to disable the signed-in user or the last enabled user", async () => {
    const h = await makeHarness({ bob: { role: "admin" } });
    const self = await call(h, "PATCH", { username: "alice", disabled: true });
    expect(self.status).toBe(409);
    expect(JSON.parse(self.body)).toEqual({ error: "self_target" });
    // bob 禁用后 alice 是唯一启用用户：bob 的既有会话（D8：不吊销 subject 会话）
    // 再禁 alice → last_enabled。
    await call(h, "PATCH", { username: "bob", disabled: true });
    const res = await h.call(
      makeReq({
        method: "PATCH",
        contentType: "application/json",
        body: { username: "alice", disabled: true },
        cookie: await h.cookieFor("bob"),
      }),
    );
    expect(JSON.parse(res.body)).toEqual({ error: "last_enabled" });
  });

  it("rejects unknown users, empty updates and bad field types", async () => {
    const h = await makeHarness();
    const notFound = await call(h, "PATCH", { username: "carol", disabled: true });
    expect(notFound.status).toBe(404);
    expect(JSON.parse(notFound.body)).toEqual({ error: "not_found" });
    expect(JSON.parse((await call(h, "PATCH", { username: "bob" })).body)).toEqual({
      error: "nothing_to_update",
    });
    const badDisabled = await call(h, "PATCH", { username: "bob", disabled: "yes" });
    expect(JSON.parse(badDisabled.body)).toEqual({ error: "invalid_field" });
    expect(JSON.parse((await call(h, "PATCH", { username: "bob", password: "" })).body)).toEqual({
      error: "empty_password",
    });
  });

  it("enables TOTP once (returns secret + uri) and disables it idempotently", async () => {
    const h = await makeHarness();
    const enable = await call(h, "PATCH", { username: "bob", totp: "enable" });
    expect(enable.status).toBe(200);
    expect(JSON.parse(enable.body)).toEqual({
      user: { username: "bob", disabled: false, totp: true, admin: false, current: false },
      totpSecret: "NEWSECRETB32",
      totpUri: "otpauth://totp/dsh-auth:bob?secret=NEWSECRETB32",
    });
    expect((await h.snapshot()).users.get("bob")?.totpSecret).toBe("NEWSECRETB32");
    const again = await call(h, "PATCH", { username: "bob", totp: "enable" });
    expect(again.status).toBe(409);
    expect(JSON.parse(again.body)).toEqual({ error: "totp_exists" });
    expect((await call(h, "PATCH", { username: "bob", totp: "disable" })).status).toBe(200);
    expect((await h.snapshot()).users.get("bob")?.totpSecret).toBeUndefined();
    expect(JSON.parse((await call(h, "PATCH", { username: "bob", totp: "reset" })).body)).toEqual({
      error: "invalid_field",
    });
  });
});

describe("DELETE /auth/users", () => {
  it("deletes a user and persists the removal", async () => {
    const h = await makeHarness();
    const res = await call(h, "DELETE", { username: "bob" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ deleted: "bob" });
    expect((await h.snapshot()).users.has("bob")).toBe(false);
  });

  it("refuses to delete the signed-in user or an unknown user", async () => {
    const h = await makeHarness();
    expect(JSON.parse((await call(h, "DELETE", { username: "alice" })).body)).toEqual({
      error: "self_target",
    });
    expect((await call(h, "DELETE", { username: "carol" })).status).toBe(404);
  });

  it("blocks deleting the last enabled user from another session", async () => {
    const h = await makeHarness({ bob: { role: "admin" } });
    // bob 先建会话再被 alice 禁用；其既有会话（D8：不吊销 subject 会话）删 alice
    // （此时唯一启用用户）→ last_enabled。
    const bobCookie = await h.cookieFor("bob");
    expect((await call(h, "PATCH", { username: "bob", disabled: true })).status).toBe(200);
    const res = await h.call(
      makeReq({
        method: "DELETE",
        contentType: "application/json",
        body: { username: "alice" },
        cookie: bobCookie,
      }),
    );
    expect(JSON.parse(res.body)).toEqual({ error: "last_enabled" });
  });
});

describe("non-admin sessions (D13)", () => {
  it("allows changing only the own password", async () => {
    const h = await makeHarness();
    const cookie = await h.cookieFor("bob");
    const patch = (body: unknown) =>
      h.call(makeReq({ method: "PATCH", contentType: "application/json", body, cookie }));
    const own = await patch({ username: "bob", password: "new-pw" });
    expect(own.status).toBe(200);
    const bob = (await h.snapshot()).users.get("bob")!;
    await expect(verifyPassword("new-pw", bob.passwordHash)).resolves.toBe(true);
    expect(JSON.parse((await patch({ username: "alice", password: "x" })).body)).toEqual({
      error: "forbidden",
    });
    expect(JSON.parse((await patch({ username: "bob", disabled: false })).body)).toEqual({
      error: "forbidden",
    });
    expect(JSON.parse((await patch({ username: "bob", totp: "enable" })).body)).toEqual({
      error: "forbidden",
    });
  });

  it("rejects DELETE with 403", async () => {
    const h = await makeHarness();
    const res = await h.call(
      makeReq({
        method: "DELETE",
        contentType: "application/json",
        body: { username: "alice" },
        cookie: await h.cookieFor("bob"),
      }),
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
    expect((await h.snapshot()).users.has("alice")).toBe(true);
  });

  it("treats a deleted admin's lingering session as non-admin (fail-closed)", async () => {
    const h = await makeHarness({ bob: { role: "admin" } });
    const bobCookie = await h.cookieFor("bob");
    expect((await call(h, "DELETE", { username: "bob" })).status).toBe(200);
    const res = await h.call(
      makeReq({
        method: "POST",
        contentType: "application/json",
        body: { username: "carol", password: "x" },
        cookie: bobCookie,
      }),
    );
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
  });
});

describe("PATCH /auth/users admin role (D18)", () => {
  it("grants and revokes the admin role for another user", async () => {
    const h = await makeHarness();
    const grant = await call(h, "PATCH", { username: "bob", admin: true });
    expect(grant.status).toBe(200);
    expect(JSON.parse(grant.body)).toEqual({
      user: { username: "bob", disabled: false, totp: false, admin: true, current: false },
    });
    expect((await h.snapshot()).users.get("bob")?.role).toBe("admin");
    const revoke = await call(h, "PATCH", { username: "bob", admin: false });
    expect(revoke.status).toBe(200);
    expect(JSON.parse(revoke.body)).toEqual({
      user: { username: "bob", disabled: false, totp: false, admin: false, current: false },
    });
    const bob = (await h.snapshot()).users.get("bob")!;
    expect(bob.role).toBeUndefined();
    // 回收是逐字段重建：passwordHash/disabled/totpSecret 都不受影响。
    await expect(verifyPassword("bob-pw", bob.passwordHash)).resolves.toBe(true);
  });

  it("keeps the role across password/TOTP/disabled writes after a grant", async () => {
    const h = await makeHarness();
    expect((await call(h, "PATCH", { username: "bob", admin: true })).status).toBe(200);
    expect((await call(h, "PATCH", { username: "bob", password: "new-pw" })).status).toBe(200);
    expect((await h.snapshot()).users.get("bob")?.role).toBe("admin");
    expect((await call(h, "PATCH", { username: "bob", totp: "disable" })).status).toBe(200);
    expect((await h.snapshot()).users.get("bob")?.role).toBe("admin");
    expect((await call(h, "PATCH", { username: "bob", disabled: true })).status).toBe(200);
    expect((await h.snapshot()).users.get("bob")?.role).toBe("admin");
  });

  it("refuses to revoke the signed-in admin's own role", async () => {
    const h = await makeHarness({ bob: { role: "admin" } });
    const res = await call(h, "PATCH", { username: "alice", admin: false });
    expect(res.status).toBe(409);
    expect(JSON.parse(res.body)).toEqual({ error: "self_target" });
    expect((await h.snapshot()).users.get("alice")?.role).toBe("admin");
  });

  it("rejects a non-boolean admin field", async () => {
    const h = await makeHarness();
    const res = await call(h, "PATCH", { username: "bob", admin: "yes" });
    expect(JSON.parse(res.body)).toEqual({ error: "invalid_field" });
    expect((await h.snapshot()).users.get("bob")?.role).toBeUndefined();
  });

  it("rejects role changes from a non-admin session (own target or not)", async () => {
    const h = await makeHarness();
    const cookie = await h.cookieFor("bob");
    const patch = (body: unknown) =>
      h.call(makeReq({ method: "PATCH", contentType: "application/json", body, cookie }));
    expect(JSON.parse((await patch({ username: "bob", admin: true })).body)).toEqual({
      error: "forbidden",
    });
    expect(JSON.parse((await patch({ username: "alice", admin: false })).body)).toEqual({
      error: "forbidden",
    });
    expect((await h.snapshot()).users.get("bob")?.role).toBeUndefined();
    expect((await h.snapshot()).users.get("alice")?.role).toBe("admin");
  });

  it("treats a demoted admin's lingering session as non-admin (fail-closed)", async () => {
    const h = await makeHarness({ bob: { role: "admin" } });
    const bobCookie = await h.cookieFor("bob");
    expect((await call(h, "PATCH", { username: "bob", admin: false })).status).toBe(200);
    expect((await h.snapshot()).users.get("bob")?.role).toBeUndefined();
    const res = await h.call(
      makeReq({
        method: "PATCH",
        contentType: "application/json",
        body: { username: "alice", disabled: true },
        cookie: bobCookie,
      }),
    );
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
  });
});
