import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { verifyPassword } from "./password.js";
import { parseImportText } from "./user-admin-import.js";
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

/** POST /auth/users/import 便捷调用（alice admin 会话 + JSON body）。 */
async function post(
  h: UserAdminHarness,
  body: unknown,
  cookie?: string,
): Promise<{ status: number | undefined; body: string }> {
  return h.callImport(
    makeReq({
      method: "POST",
      contentType: "application/json",
      body,
      cookie: cookie ?? (await h.cookieFor()),
    }),
  );
}

afterEach(() => {
  while (harnesses.length > 0) harnesses.pop()!.cleanup();
});

describe("parseImportText", () => {
  it("parses username,password lines; splits at the first comma; skips blanks/comments", () => {
    const { entries, failures } = parseImportText(
      "# comment\n\nalice,pw1\r\nbob, pw,with,commas \n",
    );
    expect(entries).toEqual([
      { line: 3, username: "alice", password: "pw1" },
      { line: 4, username: "bob", password: "pw,with,commas" },
    ]);
    expect(failures).toEqual([]);
  });

  it("reports invalid usernames and empty passwords with line numbers", () => {
    const { entries, failures } = parseImportText("bad name,x\nnopassword\nok_user,pw");
    expect(entries).toEqual([{ line: 3, username: "ok_user", password: "pw" }]);
    expect(failures).toEqual([
      { line: 1, username: "bad name", code: "invalid_username" },
      { line: 2, username: "nopassword", code: "empty_password" },
    ]);
  });
});

describe("/auth/users/import method guard", () => {
  it("answers 405 to non-POST methods (the GET list left with the removed sandbox mode)", async () => {
    const h = await makeHarness();
    const res = await h.callImport(makeReq({ cookie: await h.cookieFor() }));
    expect(res.status).toBe(405);
  });
});

describe("POST /auth/users/import {text}", () => {
  it("creates all users (hashes verify) and reports the count", async () => {
    const h = await makeHarness();
    const res = await post(h, { text: "carol,pw-c\ndave,pw-d" });
    expect(res.status).toBe(201);
    const body = JSON.parse(res.body) as { created: number };
    expect(body.created).toBe(2);
    const snapshot = await h.snapshot();
    await expect(verifyPassword("pw-c", snapshot.users.get("carol")!.passwordHash)).resolves.toBe(
      true,
    );
    await expect(verifyPassword("pw-d", snapshot.users.get("dave")!.passwordHash)).resolves.toBe(
      true,
    );
  });

  it("is all-or-nothing: invalid lines reject the whole batch with per-line details", async () => {
    const h = await makeHarness();
    const res = await post(h, { text: "carol,pw-c\nbad name,x\nnopw" });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      error: "invalid_entry",
      failures: [
        { line: 2, username: "bad name", code: "invalid_username" },
        { line: 3, username: "nopw", code: "empty_password" },
      ],
    });
    expect((await h.snapshot()).users.has("carol")).toBe(false);
  });

  it("flags duplicates within the batch and against the existing file", async () => {
    const h = await makeHarness();
    const res = await post(h, { text: "alice,pw1\ncarol,pw2\ncarol,pw3" });
    expect(JSON.parse(res.body)).toEqual({
      error: "invalid_entry",
      failures: [
        { line: 1, username: "alice", code: "duplicate" },
        { line: 3, username: "carol", code: "duplicate" },
      ],
    });
  });

  it("rejects empty content, oversized batches and ambiguous bodies", async () => {
    const h = await makeHarness();
    expect(JSON.parse((await post(h, { text: "# only comments\n" })).body)).toEqual({
      error: "no_entries",
    });
    const many = Array.from({ length: 101 }, (_, i) => `u${i},pw`).join("\n");
    expect(JSON.parse((await post(h, { text: many })).body)).toEqual({
      error: "too_many_entries",
    });
    expect(JSON.parse((await post(h, {})).body)).toEqual({ error: "invalid_field" });
    // {file} 随 imports/ 沙箱模式一并移除：不再被识别为来源。
    expect(JSON.parse((await post(h, { file: "x.txt" })).body)).toEqual({
      error: "invalid_field",
    });
  });

  it("rejects non-admin sessions with 403", async () => {
    const h = await makeHarness();
    const res = await post(h, { text: "carol,pw" }, await h.cookieFor("bob"));
    expect(res.status).toBe(403);
    expect((await h.snapshot()).users.has("carol")).toBe(false);
  });
});

describe("POST /auth/users/import {path}", () => {
  it("imports a txt from an absolute path on the server", async () => {
    const h = await makeHarness();
    const filePath = join(h.dir, "elsewhere.txt");
    writeFileSync(filePath, "carol,pw-c\n");
    const res = await post(h, { path: filePath });
    expect(res.status).toBe(201);
    expect((await h.snapshot()).users.has("carol")).toBe(true);
    expect(
      h.logs.some((log) => log.level === "info" && String(log.message).includes(filePath)),
    ).toBe(true);
  });

  it("rejects relative paths, non-txt names and missing files with 404", async () => {
    const h = await makeHarness();
    const cases = ["", "team.txt", "sub/dir.txt", h.usersFile, join(h.dir, "missing.txt")];
    for (const value of cases) {
      const res = await post(h, { path: value });
      expect(res.status).toBe(404);
      expect(JSON.parse(res.body)).toEqual({ error: "import_file_not_found" });
    }
  });

  it("rejects files beyond the size cap with 413", async () => {
    const h = await makeHarness();
    const huge = join(h.dir, "huge.txt");
    writeFileSync(huge, "x".repeat(256 * 1024 + 1));
    const res = await post(h, { path: huge });
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ error: "import_file_too_large" });
  });

  it("rejects combined sources with 400 invalid_field", async () => {
    const h = await makeHarness();
    expect(JSON.parse((await post(h, { text: "a,b", path: "/x.txt" })).body)).toEqual({
      error: "invalid_field",
    });
  });

  it("rejects non-admin sessions with 403", async () => {
    const h = await makeHarness();
    const filePath = join(h.dir, "elsewhere.txt");
    writeFileSync(filePath, "carol,pw-c\n");
    const res = await post(h, { path: filePath }, await h.cookieFor("bob"));
    expect(res.status).toBe(403);
    expect((await h.snapshot()).users.has("carol")).toBe(false);
  });
});
