import { mkdirSync, writeFileSync } from "node:fs";
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

  it("lists and imports server-side files from the imports dir only", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base);
      mkdirSync(join(root, "imports"), { recursive: true });
      writeFileSync(join(root, "imports", "team.txt"), "erin,pw-e\n");
      const list = await importCall(base, "GET", cookie);
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual({ files: [{ name: "team.txt", size: 10 }] });
      const res = await importCall(base, "POST", cookie, { file: "team.txt" });
      expect(res.status).toBe(201);
      const escape = await importCall(base, "POST", cookie, { file: "../users.yaml" });
      expect(escape.status).toBe(404);
      expect(await escape.json()).toEqual({ error: "import_file_not_found" });
    } finally {
      await unmountStack(fibers, root);
    }
  });

  it("rejects non-admin sessions with 403 on both verbs", async () => {
    const { port, fibers, root } = await mountUsersStack();
    try {
      const base = `http://127.0.0.1:${port}`;
      const cookie = await loginCookie(base, "plain");
      const list = await importCall(base, "GET", cookie);
      expect(list.status).toBe(403);
      const res = await importCall(base, "POST", cookie, { text: "carol,pw-c" });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    } finally {
      await unmountStack(fibers, root);
    }
  });
});
