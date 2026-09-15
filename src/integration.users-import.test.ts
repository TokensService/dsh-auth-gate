import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  importCall,
  loginCookie,
  mountUsersStack,
  unmountStack,
} from "./integration-users-helpers.js";

describe("integration: /auth/users/import over real HTTP (D14)", () => {
  it("imports inline text as admin; imported users can sign in", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base);
      const res = await importCall(base, "POST", cookie, { text: "carol,pw-c\ndave,pw-d\n" });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { created: number };
      expect(body.created).toBe(2);
      const login = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=carol&password=pw-c",
        redirect: "manual",
      });
      expect(login.status).toBe(302);
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("imports from an absolute server path; non-txt and relative paths stay unreadable", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base);
      const outside = join(root, "team-full.txt");
      writeFileSync(outside, "frank,pw-f\n");
      const res = await importCall(base, "POST", cookie, { path: outside });
      expect(res.status).toBe(201);
      const login = await fetch(`${base}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "username=frank&password=pw-f",
        redirect: "manual",
      });
      expect(login.status).toBe(302);
      for (const value of [join(root, "users.yaml"), "team-full.txt"]) {
        const denied = await importCall(base, "POST", cookie, { path: value });
        expect(denied.status).toBe(404);
        expect(await denied.json()).toEqual({ error: "import_file_not_found" });
      }
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("rejects non-admin sessions with 403 and dropped verbs with 405", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base, "plain");
      const res = await importCall(base, "POST", cookie, { text: "carol,pw-c" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
      const list = await importCall(base, "GET", cookie);
      expect(list.status).toBe(405);
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
