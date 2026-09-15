/**
 * `/auth/users` 管理 API 的浏览器封装（host 端 user-admin-endpoints 的契约镜像）。
 * 全部经同源 fetch，会话 cookie 自动携带；错误以稳定 code 返回（UI 按码本地化）。
 */
export interface AdminUser {
    username: string;
    disabled: boolean;
    totp: boolean;
    admin: boolean;
    current: boolean;
}
export type ListResult = {
    ok: true;
    users: AdminUser[];
} | {
    ok: false;
    status: number;
    code: string;
};
export interface MutationResult {
    ok: boolean;
    status: number;
    /** 稳定错误码（host UserAdminErrorCode）；成功或无法归类时为 ""。 */
    code: string;
    totpSecret?: string;
    totpUri?: string;
}
export interface UserUpdate {
    username: string;
    password?: string;
    disabled?: boolean;
    totp?: "enable" | "disable";
}
/** GET /auth/users；404 = token 模式（端点未注册，落 /auth 兜底）。 */
export declare function listUsers(): Promise<ListResult>;
export declare function createUser(username: string, password: string): Promise<MutationResult>;
export declare function updateUser(update: UserUpdate): Promise<MutationResult>;
export declare function deleteUser(username: string): Promise<MutationResult>;
/** 批量导入的单行失败明细（host ImportFailure 镜像）。 */
export interface ImportFailure {
    line: number;
    username: string;
    code: string;
}
export interface ImportResult {
    ok: boolean;
    status: number;
    code: string;
    created?: number;
    failures?: ImportFailure[];
}
/** POST 导入：本地文件原文（{text}）。 */
export declare function importUsersText(text: string): Promise<ImportResult>;
/** POST 导入：服务器上 `.txt` 的绝对路径（{path}，D15）。 */
export declare function importUsersServerPath(path: string): Promise<ImportResult>;
/** GET /auth/settings 的结果（host session-settings-endpoints 的契约镜像）。 */
export interface SessionSettingsResult {
    ok: boolean;
    status: number;
    code: string;
    /** 生效中的会话 TTL（秒）。 */
    sessionTtl?: number;
    /** 插件配置的默认 TTL（秒；settings.yaml 未设置时生效值即它）。 */
    defaultTtl?: number;
}
/** GET /auth/settings；404 = token 模式（端点未注册，落 /auth 兜底）。 */
export declare function getSessionSettings(): Promise<SessionSettingsResult>;
/** PATCH /auth/settings {sessionTtl}（admin 权限由服务端裁定，UI 降级只是镜像）。 */
export declare function updateSessionTtl(sessionTtl: number): Promise<MutationResult>;
//# sourceMappingURL=users-api.d.ts.map