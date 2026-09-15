import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSessionTtlResolver } from "./session-settings-endpoints.js";
import {
  makeReq,
  makeUserAdminHarness,
  type UserAdminHarness,
} from "../../../test/user-admin-harness.js";

function json(res: { body: string }): unknown {
  return JSON.parse(res.body);
}

const harnesses: UserAdminHarness[] = [];

async function makeHarness(): Promise<UserAdminHarness> {
  const harness = await makeUserAdminHarness();
  harnesses.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

function patchReq(cookie: string, body: unknown): ReturnType<typeof makeReq> {
  return makeReq({ method: "PATCH", cookie, contentType: "application/json", body });
}

describe("GET /auth/settings (D16)", () => {
  it("answers 401 without a session and 503 when the session store is unavailable", async () => {
    const harness = await makeHarness();
    const anon = await harness.callSettings(makeReq({}));
    expect(anon.status).toBe(401);
    expect(json(anon)).toEqual({ error: "unauthorized" });

    harness.settingsDeps.sessions = () => undefined;
    const noStore = await harness.callSettings(makeReq({ cookie: await harness.cookieFor() }));
    expect(noStore.status).toBe(503);
    expect(json(noStore)).toEqual({ error: "store_unavailable" });
  });

  it("returns the configured default when settings.yaml is absent (readable by any session)", async () => {
    const harness = await makeHarness();
    const asAdmin = await harness.callSettings(
      makeReq({ cookie: await harness.cookieFor("alice") }),
    );
    expect(asAdmin.status).toBe(200);
    expect(json(asAdmin)).toEqual({ sessionTtl: 604800, defaultTtl: 604800 });

    const asBob = await harness.callSettings(makeReq({ cookie: await harness.cookieFor("bob") }));
    expect(asBob.status).toBe(200);
    expect(json(asBob)).toEqual({ sessionTtl: 604800, defaultTtl: 604800 });
  });

  it("reflects a file value; a corrupted file answers 503 and logs the error", async () => {
    const harness = await makeHarness();
    await fs.writeFile(harness.settingsFile, "version: 1\nsessionTtl: 3600\n");
    const res = await harness.callSettings(makeReq({ cookie: await harness.cookieFor() }));
    expect(json(res)).toEqual({ sessionTtl: 3600, defaultTtl: 604800 });

    await fs.writeFile(harness.settingsFile, "version: 1\nsessionTtl: soon\n");
    const broken = await harness.callSettings(makeReq({ cookie: await harness.cookieFor() }));
    expect(broken.status).toBe(503);
    expect(json(broken)).toEqual({ error: "settings_store_unavailable" });
    expect(harness.logs.some((entry) => entry.level === "error")).toBe(true);
  });
});

describe("PATCH /auth/settings permissions and media (D16)", () => {
  it("rejects non-admin sessions with 403 forbidden", async () => {
    const harness = await makeHarness();
    const res = await harness.callSettings(
      patchReq(await harness.cookieFor("bob"), { sessionTtl: 3600 }),
    );
    expect(res.status).toBe(403);
    expect(json(res)).toEqual({ error: "forbidden" });
  });

  it("requires application/json and caps the body (415/413/400)", async () => {
    const harness = await makeHarness();
    const cookie = await harness.cookieFor();
    const form = await harness.callSettings(
      makeReq({
        method: "PATCH",
        cookie,
        contentType: "text/plain",
        body: { sessionTtl: 3600 },
      }),
    );
    expect(form.status).toBe(415);
    expect(json(form)).toEqual({ error: "unsupported_media_type" });

    const huge = await harness.callSettings(
      patchReq(cookie, { sessionTtl: 3600, pad: "x".repeat(20 * 1024) }),
    );
    expect(huge.status).toBe(413);
    expect(json(huge)).toEqual({ error: "body_too_large" });

    const notObject = await harness.callSettings(patchReq(cookie, "just-a-string"));
    expect(notObject.status).toBe(400);
    expect(json(notObject)).toEqual({ error: "bad_json" });
  });

  it("answers 405 with an allow header for other methods", async () => {
    const harness = await makeHarness();
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await harness.callSettings(
        makeReq({ method, cookie: await harness.cookieFor() }),
      );
      expect(res.status).toBe(405);
      expect(res.headers["allow"]).toBe("GET, PATCH");
    }
  });
});

describe("PATCH /auth/settings validation (D16)", () => {
  it("rejects type/range violations (400 invalid_ttl) and writes nothing", async () => {
    const harness = await makeHarness();
    const cookie = await harness.cookieFor();
    for (const sessionTtl of ["soon", 30, 31536001, 1.5, undefined]) {
      const res = await harness.callSettings(patchReq(cookie, { sessionTtl }));
      expect(res.status).toBe(400);
      expect(json(res)).toEqual({ error: "invalid_ttl" });
    }
    await expect(fs.readFile(harness.settingsFile, "utf8")).rejects.toThrow();
  });

  it("accepts the boundary values 60 and 31536000", async () => {
    const harness = await makeHarness();
    const cookie = await harness.cookieFor();
    for (const sessionTtl of [60, 31536000]) {
      const res = await harness.callSettings(patchReq(cookie, { sessionTtl }));
      expect(res.status).toBe(200);
      expect(json(res)).toEqual({ sessionTtl, defaultTtl: 604800 });
    }
  });
});

describe("PATCH /auth/settings persistence (D16)", () => {
  it("persists a valid ttl (admin), a later GET reflects it, and the change is audited", async () => {
    const harness = await makeHarness();
    const cookie = await harness.cookieFor();
    const res = await harness.callSettings(patchReq(cookie, { sessionTtl: 3600 }));
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({ sessionTtl: 3600, defaultTtl: 604800 });
    expect(await fs.readFile(harness.settingsFile, "utf8")).toContain("sessionTtl: 3600");

    const reflected = await harness.callSettings(makeReq({ cookie }));
    expect(json(reflected)).toEqual({ sessionTtl: 3600, defaultTtl: 604800 });
    expect(
      harness.logs.some(
        (entry) =>
          entry.level === "info" && String(entry.message).includes("session TTL updated to 3600s"),
      ),
    ).toBe(true);
  });

  it("self-heals a corrupted settings file", async () => {
    const harness = await makeHarness();
    await fs.writeFile(harness.settingsFile, "version: 1\nsessionTtl: [unclosed\n");
    const cookie = await harness.cookieFor();
    const res = await harness.callSettings(patchReq(cookie, { sessionTtl: 300 }));
    expect(res.status).toBe(200);
    const reflected = await harness.callSettings(makeReq({ cookie }));
    expect(json(reflected)).toEqual({ sessionTtl: 300, defaultTtl: 604800 });
  });

  it("answers 503 settings_store_unavailable when the write fails", async () => {
    const harness = await makeHarness();
    harness.settingsDeps.writeSettings = () => Promise.reject(new Error("disk full"));
    const res = await harness.callSettings(
      patchReq(await harness.cookieFor(), { sessionTtl: 3600 }),
    );
    expect(res.status).toBe(503);
    expect(json(res)).toEqual({ error: "settings_store_unavailable" });
    expect(harness.logs.some((entry) => entry.level === "error")).toBe(true);
  });
});

describe("makeSessionTtlResolver (D16)", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-resolver-"));
    file = path.join(dir, "settings.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("falls back to the configured default when the file is missing", async () => {
    const logs: unknown[] = [];
    const resolve = makeSessionTtlResolver(file, 604800, { error: (m) => logs.push(m) });
    await expect(resolve()).resolves.toBe(604800);
    expect(logs).toEqual([]);
  });

  it("reads the ttl from settings.yaml", async () => {
    await fs.writeFile(file, "version: 1\nsessionTtl: 3600\n");
    const resolve = makeSessionTtlResolver(file, 604800, { error: () => undefined });
    await expect(resolve()).resolves.toBe(3600);
  });

  it("falls back and logs on a corrupted file", async () => {
    await fs.writeFile(file, "version: 1\nsessionTtl: soon\n");
    const logs: unknown[] = [];
    const resolve = makeSessionTtlResolver(file, 604800, { error: (m) => logs.push(m) });
    await expect(resolve()).resolves.toBe(604800);
    expect(logs).toHaveLength(1);
  });
});
