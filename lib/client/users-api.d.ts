/**
 * `/auth/users` 管理 API 的浏览器封装（host 端 user-admin-endpoints 的契约镜像）。
 * 全部经同源 fetch，会话 cookie 自动携带；错误以稳定 code 返回（UI 按码本地化）。
 */
export interface AdminUser {
    username: string;
    disabled: boolean;
    totp: boolean;
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
//# sourceMappingURL=users-api.d.ts.map