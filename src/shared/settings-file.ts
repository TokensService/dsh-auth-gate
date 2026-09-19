import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify } from "yaml";
import { z } from "zod";

/** 有限会话 TTL 的可设边界（秒，含端点）：1 分钟到 365 天；0 表示永不过期。 */
export const MIN_SESSION_TTL = 60;
export const MAX_SESSION_TTL = 31536000;

/** 运行期可调设置（settings.yaml 内容；当前仅会话 TTL，秒）。 */
export interface AuthSettings {
  sessionTtl?: number;
}

/** 加载结果：`missing` 区分"文件不存在"（回落插件配置）与"存在"。 */
export interface SettingsLoadResult {
  settings: AuthSettings;
  missing: boolean;
}

/** settings 文件不可用（语法/schema/读写）。message 面向操作员，可落日志。 */
export class SettingsFileError extends Error {}

const settingsFileSchema = z
  .object({
    version: z.literal(1),
    sessionTtl: z.number().int().nonnegative().optional(),
  })
  .strict();

/** 设置文件与 users.yaml 同目录（零新配置；`usersFile` 覆盖时随之迁移）。 */
export function defaultSettingsFilePath(usersFile: string): string {
  return path.join(path.dirname(usersFile), "settings.yaml");
}

/**
 * 每次现读（同 users.yaml 的 P7 纪律）。ENOENT → `{ settings: {}, missing: true }`（不抛）。
 * 文件只存非机密数值，不沿用 users.yaml 的权限位硬检查（避免新失败面）。
 */
export async function loadSettingsFile(filePath: string): Promise<SettingsLoadResult> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) return { settings: {}, missing: true };
    throw new SettingsFileError(`cannot read settings file: ${errorMessage(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    throw new SettingsFileError(`invalid settings file: ${errorMessage(error)}`);
  }
  const result = settingsFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new SettingsFileError(`invalid settings file: ${result.error.message}`);
  }
  const settings: AuthSettings = {};
  if (result.data.sessionTtl !== undefined) settings.sessionTtl = result.data.sessionTtl;
  return { settings, missing: false };
}

/** 只取会话 TTL；文件缺失/未设置 → undefined（调用方回落配置默认）。 */
export async function readSessionTtl(filePath: string): Promise<number | undefined> {
  return (await loadSettingsFile(filePath)).settings.sessionTtl;
}

/**
 * 全量序列化 + 同目录 `.tmp` + 原子替换 + 0600（同 writeUsersFile 纪律；目录自动创建）。
 * 不写 read-modify-write：当前唯一字段全量覆盖，损坏文件可被一次成功写自愈。
 */
export async function writeSettingsFile(filePath: string, settings: AuthSettings): Promise<void> {
  const text = stringify({
    version: 1,
    ...(settings.sessionTtl === undefined ? {} : { sessionTtl: settings.sessionTtl }),
  });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, text, { mode: 0o600 });
  await fs.rename(`${filePath}.tmp`, filePath);
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
