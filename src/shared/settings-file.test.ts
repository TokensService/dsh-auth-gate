import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultSettingsFilePath,
  loadSettingsFile,
  readSessionTtl,
  SettingsFileError,
  writeSettingsFile,
} from "./settings-file.js";

describe("defaultSettingsFilePath", () => {
  it("sits next to the users file", () => {
    expect(defaultSettingsFilePath(path.join("/srv/dsh", "auth", "users.yaml"))).toBe(
      path.join("/srv/dsh", "auth", "settings.yaml"),
    );
  });
});

describe("settings file round-trip", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "dsh-auth-settings-"));
    file = path.join(dir, "settings.yaml");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reports missing:true when the file does not exist", async () => {
    const { settings, missing } = await loadSettingsFile(file);
    expect(missing).toBe(true);
    expect(settings.sessionTtl).toBeUndefined();
  });

  it("loads a valid file", async () => {
    await fs.writeFile(file, "version: 1\nsessionTtl: 3600\n");
    const { settings, missing } = await loadSettingsFile(file);
    expect(missing).toBe(false);
    expect(settings.sessionTtl).toBe(3600);
  });

  it("loads a file without sessionTtl", async () => {
    await fs.writeFile(file, "version: 1\n");
    const { settings, missing } = await loadSettingsFile(file);
    expect(missing).toBe(false);
    expect(settings.sessionTtl).toBeUndefined();
  });

  it("throws SettingsFileError on YAML syntax errors", async () => {
    await fs.writeFile(file, "version: 1\nsessionTtl: [unclosed");
    await expect(loadSettingsFile(file)).rejects.toBeInstanceOf(SettingsFileError);
  });

  it("throws SettingsFileError on schema violations", async () => {
    const cases = [
      "version: 2\nsessionTtl: 3600\n",
      "version: 1\nsessionTtl: soon\n",
      "version: 1\nsessionTtl: 3600\nextra: 1\n",
      "version: 1\nsessionTtl: 0\n",
      "version: 1\nsessionTtl: -5\n",
      "version: 1\nsessionTtl: 1.5\n",
    ];
    for (const [index, text] of cases.entries()) {
      const target = path.join(dir, `bad-${index}.yaml`);
      await fs.writeFile(target, text);
      await expect(loadSettingsFile(target)).rejects.toBeInstanceOf(SettingsFileError);
    }
  });

  it("throws SettingsFileError when the path is unreadable (a directory)", async () => {
    await expect(loadSettingsFile(dir)).rejects.toBeInstanceOf(SettingsFileError);
  });

  it("round-trips sessionTtl with 0600 permissions", async () => {
    await writeSettingsFile(file, { sessionTtl: 7200 });
    const { settings, missing } = await loadSettingsFile(file);
    expect(missing).toBe(false);
    expect(settings.sessionTtl).toBe(7200);
    if (process.platform !== "win32") {
      const stat = await fs.stat(file);
      expect(stat.mode & 0o777).toBe(0o600);
    }
  });

  it("creates the parent directory and serializes an empty settings object", async () => {
    const nested = path.join(dir, "sub", "settings.yaml");
    await writeSettingsFile(nested, {});
    const { settings, missing } = await loadSettingsFile(nested);
    expect(missing).toBe(false);
    expect(settings.sessionTtl).toBeUndefined();
  });

  it("readSessionTtl returns the value, or undefined when unset/missing", async () => {
    expect(await readSessionTtl(file)).toBeUndefined();
    await writeSettingsFile(file, { sessionTtl: 300 });
    expect(await readSessionTtl(file)).toBe(300);
  });
});
