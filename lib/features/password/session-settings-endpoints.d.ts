import { type AuthSettings, type SettingsLoadResult } from "../../shared/index.js";
import { type UserAdminDeps } from "./user-admin-common.js";
/** 登录超时（会话 TTL）管理端点路径（exact；`/auth` 白名单内，端点自做会话校验）。 */
export declare const SETTINGS_PATH = "/auth/settings";
export interface SessionSettingsDeps extends UserAdminDeps {
    /** 仅用于错误日志（设置文件读写失败时定位）。 */
    settingsPath: string;
    loadSettings: () => Promise<SettingsLoadResult>;
    writeSettings: (settings: AuthSettings) => Promise<void>;
    /** 插件配置的默认 TTL（settings.yaml 未设置时的回落；响应透出供页面标注默认值）。 */
    defaultTtl: number;
}
/**
 * 注册 exact `/auth/settings`（password 模式专属的登录超时管理 API，D16）。
 * GET 任意会话可读（生效值 = 文件值 ?? 配置默认，随附配置默认）；PATCH 仅 admin，
 * 收整型秒 0（永不过期）或 [MIN_SESSION_TTL, MAX_SESSION_TTL]，全量写 settings.yaml（损坏文件可被
 * 一次成功写自愈）。生效语义：只影响之后新签发的会话；存量会话按签发时 TTL 过期
 * （与 users 页的"只挡新登录"脚注同义）。
 */
export declare function registerSessionSettingsEndpoints(deps: SessionSettingsDeps): () => void;
/** 由共享的管理 deps + 设置文件路径装配 settings 端点 deps（index.ts 接线用）。 */
export declare function sessionSettingsDeps(base: UserAdminDeps, settingsPath: string, defaultTtl: number): SessionSettingsDeps;
/**
 * 登录超时现读（D16）：settings.yaml 的 sessionTtl 优先，文件缺失/未设置回落插件
 * 配置；读错（语法/schema）记 error 日志并回落配置默认（TTL 非认证边界，不阻断
 * 登录；管理 API 的 GET 会以 503 暴露文件损坏）。
 */
export declare function makeSessionTtlResolver(settingsPath: string, fallback: number, log: {
    error(message: unknown): void;
}): () => Promise<number>;
//# sourceMappingURL=session-settings-endpoints.d.ts.map