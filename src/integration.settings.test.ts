import { promises as fs } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loginCookie,
  mountUsersStack,
  TEST_PASSWORD,
  unmountStack,
} from "./integration-users-helpers.js";

function settingsCall(
  base: string,
  method: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`${base}/auth/settings`, {
    method,
    headers: { "content-type": "application/json", cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("integration: /auth/settings over real HTTP (D16)", () => {
  it("gates writes behind admin and applies a new ttl to freshly issued sessions", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const anon = await fetch(`${base}/auth/settings`);
      expect(anon.status).toBe(401);
      expect(await anon.json()).toEqual({ error: "unauthorized" });

      const adminCookie = await loginCookie(base);
      const initial = await fetch(`${base}/auth/settings`, { headers: { cookie: adminCookie } });
      expect(await initial.json()).toEqual({ sessionTtl: 604800, defaultTtl: 604800 });

      const plainCookie = await loginCookie(base, "plain");
      const forbidden = await settingsCall(base, "PATCH", plainCookie, { sessionTtl: 3600 });
      expect(forbidden.status).toBe(403);
      expect(await forbidden.json()).toEqual({ error: "forbidden" });

      const invalid = await settingsCall(base, "PATCH", adminCookie, { sessionTtl: 30 });
      expect(invalid.status).toBe(400);
      expect(await invalid.json()).toEqual({ error: "invalid_ttl" });

      const updated = await settingsCall(base, "PATCH", adminCookie, { sessionTtl: 3600 });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toEqual({ sessionTtl: 3600, defaultTtl: 604800 });
      const onDisk = await fs.readFile(join(root, "settings.yaml"), "utf8");
      expect(onDisk).toContain("sessionTtl: 3600");

      const reflected = await fetch(`${base}/auth/settings`, { headers: { cookie: plainCookie } });
      expect(await reflected.json()).toEqual({ sessionTtl: 3600, defaultTtl: 604800 });

      // 动态 TTL 真路径：PATCH 之后新签发的会话带新 Max-Age（配置默认是 604800）。
      const login = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `username=admin&password=${encodeURIComponent(TEST_PASSWORD)}`,
        redirect: "manual",
      });
      expect(login.status).toBe(302);
      expect(login.headers.get("set-cookie")).toContain("Max-Age=3600");

      const wrongMethod = await settingsCall(base, "POST", adminCookie, {});
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("GET, PATCH");
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
