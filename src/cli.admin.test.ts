import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main, type CliIo } from "./cli.js";
import { loadUsersFile } from "./shared/index.js";

function makeIo(lines: string[] = []): { io: CliIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const queue = [...lines];
  return {
    out,
    err,
    io: {
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      readLine: () => Promise.resolve(queue.shift() ?? ""),
    },
  };
}

describe("dsh-auth user admin role (D13)", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-cli-"));
    file = path.join(dir, "users.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("user add --admin stores the role (round-trips through the file)", async () => {
    const { io } = makeIo(["pw"]);
    const code = await main(
      ["user", "add", "alice", "--password-stdin", "--admin", "--file", file],
      io,
    );
    expect(code).toBe(0);
    const { snapshot } = await loadUsersFile(file);
    expect(snapshot.users.get("alice")?.role).toBe("admin");
  });

  it("user admin enable/disable grants and revokes the role", async () => {
    await main(["user", "add", "alice", "--password-stdin", "--file", file], makeIo(["pw"]).io);
    const enable = makeIo();
    expect(await main(["user", "admin", "enable", "alice", "--file", file], enable.io)).toBe(0);
    expect(enable.out).toEqual(["user alice is now an admin"]);
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.role).toBe("admin");
    const disable = makeIo();
    expect(await main(["user", "admin", "disable", "alice", "--file", file], disable.io)).toBe(0);
    expect(disable.out).toEqual(["user alice is no longer an admin"]);
    expect((await loadUsersFile(file)).snapshot.users.get("alice")?.role).toBeUndefined();
  });

  it("user admin disable keeps the disabled flag", async () => {
    await main(["user", "add", "alice", "--password-stdin", "--file", file], makeIo(["pw"]).io);
    await main(["user", "disable", "alice", "--file", file], makeIo().io);
    await main(["user", "admin", "enable", "alice", "--file", file], makeIo().io);
    await main(["user", "admin", "disable", "alice", "--file", file], makeIo().io);
    const alice = (await loadUsersFile(file)).snapshot.users.get("alice");
    expect(alice?.disabled).toBe(true);
    expect(alice?.role).toBeUndefined();
  });

  it("user admin fails for an unknown user and prints usage for a bad action", async () => {
    await main(["user", "add", "alice", "--password-stdin", "--file", file], makeIo(["pw"]).io);
    const ghost = makeIo();
    expect(await main(["user", "admin", "enable", "ghost", "--file", file], ghost.io)).toBe(1);
    expect(ghost.err).toEqual(["user ghost not found"]);
    const bad = makeIo();
    expect(await main(["user", "admin", "maybe", "alice", "--file", file], bad.io)).toBe(1);
    expect(bad.err.join("\n")).toContain("Usage:");
  });

  it("user list marks admins (combined with the disabled marker when both apply)", async () => {
    await main(
      ["user", "add", "alice", "--password-stdin", "--admin", "--file", file],
      makeIo(["pw"]).io,
    );
    await main(
      ["user", "add", "bob", "--password-stdin", "--admin", "--disabled", "--file", file],
      makeIo(["pw"]).io,
    );
    const list = makeIo();
    await main(["user", "list", "--file", file], list.io);
    expect(list.out).toEqual(["alice (admin)", "bob (admin, disabled)"]);
  });
});
