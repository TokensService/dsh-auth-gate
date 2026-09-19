/** 有限会话 TTL 的可设边界（秒，含端点）：1 分钟到 365 天；0 表示永不过期。 */
export declare const MIN_SESSION_TTL = 60;
export declare const MAX_SESSION_TTL = 31536000;
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
export declare class SettingsFileError extends Error {
}
/** 设置文件与 users.yaml 同目录（零新配置；`usersFile` 覆盖时随之迁移）。 */
export declare function defaultSettingsFilePath(usersFile: string): string;
/**
 * 每次现读（同 users.yaml 的 P7 纪律）。ENOENT → `{ settings: {}, missing: true }`（不抛）。
 * 文件只存非机密数值，不沿用 users.yaml 的权限位硬检查（避免新失败面）。
 */
export declare function loadSettingsFile(filePath: string): Promise<SettingsLoadResult>;
/** 只取会话 TTL；文件缺失/未设置 → undefined（调用方回落配置默认）。 */
export declare function readSessionTtl(filePath: string): Promise<number | undefined>;
/**
 * 全量序列化 + 同目录 `.tmp` + 原子替换 + 0600（同 writeUsersFile 纪律；目录自动创建）。
 * 不写 read-modify-write：当前唯一字段全量覆盖，损坏文件可被一次成功写自愈。
 */
export declare function writeSettingsFile(filePath: string, settings: AuthSettings): Promise<void>;
//# sourceMappingURL=settings-file.d.ts.map