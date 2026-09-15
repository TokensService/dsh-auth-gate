import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "./password.js";
import {
  makeReq,
  makeUserAdminHarness,
  type UserAdminHarness,
} from "../../../test/user-admin-harness.js";

const harnesses: UserAdminHarness[] = [];

async function makeHarness(): Promise<UserAdminHarness> {
  const h = await makeUserAdminHarness();
  harnesses.push(h);
  return h;
}

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()!.cleanup();
});

describe("user admin endpoints auth", () => {
  it("rejects every method without a session (401 json)", async () => {
    const h = await makeHarness();
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const res = await h.call(makeReq({ method, contentType: "application/json", body: {} }));
      expect(res.status).toBe(401);
      expect(JSON.parse(res.body)).toEqual({ error: "unauthorized" });
    }
  });

  it("accepts a Bearer session token as well as the cookie", async () => {
    const h = await makeHarness();
    const token = (await h.cookieFor()).split("=")[1]!;
    const res = await h.call(makeReq({ authorization: `Bearer ${token}` }));
    expect(res.status).toBe(200);
  });

  it("returns 503 when the session store is unavailable", async () => {
    const h = await makeHarness();
    h.deps.sessions = () => undefined;
    const res = await h.call(makeReq({}));
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: "store_unavailable" });
  });

  it("answers 405 with an allow header for other methods", async () => {
    const h = await makeHarness();
    const res = await h.call(makeReq({ method: "PUT", contentType: "application/json", body: {} }));
    expect(res.status).toBe(405);
    expect(res.headers["allow"]).toBe("GET, POST, PATCH, DELETE");
  });
});

describe("GET /auth/users", () => {
  it("lists users sorted with status flags and the current marker", async () => {
    const h = await makeHarness();
    const res = await h.call(makeReq({ cookie: await h.cookieFor() }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      users: [
        { username: "alice", disabled: false, totp: false, admin: true, current: true },
        { username: "bob", disabled: false, totp: false, admin: false, current: false },
      ],
    });
  });

  it("stays readable for non-admin sessions (current marker follows the session)", async () => {
    const h = await makeHarness();
    const res = await h.call(makeReq({ cookie: await h.cookieFor("bob") }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      users: [
        { username: "alice", disabled: false, totp: false, admin: true, current: false },
        { username: "bob", disabled: false, totp: false, admin: false, current: true },
      ],
    });
  });
});

describe("POST /auth/users", () => {
  it("creates a user whose password verifies against the rewritten file", async () => {
    const h = await makeHarness();
    const res = await h.call(
      makeReq({
        method: "POST",
        contentType: "application/json",
        body: { username: "carol", password: "carol-pw" },
        cookie: await h.cookieFor(),
      }),
    );
    expect(res.status).toBe(201);
    const carol = (await h.snapshot()).users.get("carol");
    expect(carol?.disabled).toBe(false);
    await expect(verifyPassword("carol-pw", carol!.passwordHash)).resolves.toBe(true);
  });

  it("rejects invalid username, empty password and duplicates", async () => {
    const h = await makeHarness();
    const cookie = await h.cookieFor();
    const post = (body: unknown) =>
      h.call(makeReq({ method: "POST", contentType: "application/json", body, cookie }));
    const badName = await post({ username: "bad name", password: "x" });
    expect(badName.status).toBe(400);
    expect(JSON.parse(badName.body)).toEqual({ error: "invalid_username" });
    expect(JSON.parse((await post({ username: "carol", password: "" })).body)).toEqual({
      error: "empty_password",
    });
    const dup = await post({ username: "alice", password: "x" });
    expect(dup.status).toBe(409);
    expect(JSON.parse(dup.body)).toEqual({ error: "duplicate" });
  });

  it("requires application/json and a json object body", async () => {
    const h = await makeHarness();
    const cookie = await h.cookieFor();
    const form = await h.call(
      makeReq({
        method: "POST",
        contentType: "application/x-www-form-urlencoded",
        body: { username: "carol", password: "x" },
        cookie,
      }),
    );
    expect(form.status).toBe(415);
    expect(JSON.parse(form.body)).toEqual({ error: "unsupported_media_type" });
    const notObject = await h.call(
      makeReq({ method: "POST", contentType: "application/json", body: [1, 2], cookie }),
    );
    expect(notObject.status).toBe(400);
    expect(JSON.parse(notObject.body)).toEqual({ error: "bad_json" });
  });

  it("rejects non-admin sessions with 403 forbidden (D13)", async () => {
    const h = await makeHarness();
    const res = await h.call(
      makeReq({
        method: "POST",
        contentType: "application/json",
        body: { username: "carol", password: "carol-pw" },
        cookie: await h.cookieFor("bob"),
      }),
    );
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body)).toEqual({ error: "forbidden" });
    expect((await h.snapshot()).users.has("carol")).toBe(false);
  });
});
