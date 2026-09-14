import type { IncomingMessage, ServerResponse } from "node:http";
import { type UserRecord, type UsersLoadResult, type UsersSnapshot } from "../../shared/index.js";
import type { HttpHandler } from "../../gate/index.js";
import type { SessionStore } from "../../session/index.js";
/** 管理 API 的稳定错误码（client 按码本地化，不依赖英文文案）。 */
export type UserAdminErrorCode = "unauthorized" | "forbidden" | "store_unavailable" | "user_store_unavailable" | "bad_json" | "unsupported_media_type" | "body_too_large" | "invalid_username" | "empty_password" | "invalid_field" | "nothing_to_update" | "duplicate" | "not_found" | "self_target" | "last_enabled" | "totp_exists" | "invalid_entry" | "no_entries" | "too_many_entries" | "import_file_not_found" | "import_file_too_large";
export interface UserAdminDeps {
    /** 注册路由（index.ts 传入包装后的 server.register；/auth 白名单放行，端点自校验会话）。 */
    register(route: {
        kind: "exact" | "prefix";
        path: string;
        handler: HttpHandler;
    }): () => void;
    sessions: () => SessionStore | undefined;
    cookieName: string;
    /** 仅用于错误日志（用户文件读写失败时定位）。 */
    usersPath: string;
    loadUsers: () => Promise<UsersLoadResult>;
    writeUsers: (snapshot: UsersSnapshot) => Promise<void>;
    /** 注入的 TOTP secret 生成（index.ts 从 features/totp 装配；同层互禁，D9 模式）。 */
    generateTotpSecret: () => string;
    /** 注入的 otpauth URI 拼装（同上）。 */
    totpUri: (name: string, secret: string) => string;
    logger: {
        error(message: unknown): void;
        info(message: unknown): void;
    };
}
/** 列表/变更响应里的用户视图（永不包含 hash/secret）。 */
export interface UserView {
    username: string;
    disabled: boolean;
    totp: boolean;
    admin: boolean;
    current: boolean;
}
export declare function viewOf(username: string, record: UserRecord, subject: string): UserView;
/** subject 是否为管理员（D13）：users.yaml 里 `role: admin`；缺省/无记录均非管理员。 */
export declare function isAdmin(snapshot: UsersSnapshot, subject: string): boolean;
/**
 * 会话门 + 管理员门（D13/D14）：store 缺失 503、无会话 401、非 admin 403；
 * 通过返回 subject 与已加载快照（调用方继续用同一快照做写操作）。
 */
export declare function requireAdmin(deps: UserAdminDeps, req: IncomingMessage, res: ServerResponse): Promise<{
    subject: string;
    snapshot: UsersSnapshot;
} | undefined>;
export declare function enabledCount(snapshot: UsersSnapshot): number;
/** 会话门：store 缺失 503、无有效会话 401（JSON）；通过返回会话 subject。 */
export declare function requireSubject(deps: UserAdminDeps, req: IncomingMessage, res: ServerResponse): string | undefined;
/** 读取 JSON 对象请求体；失败已写响应（415/413/400）并返回 undefined。 */
export declare function readJsonOrRespond(req: IncomingMessage, res: ServerResponse, limit?: number): Promise<Record<string, unknown> | undefined>;
export declare function loadUsersOr503(deps: UserAdminDeps, res: ServerResponse): Promise<UsersLoadResult | undefined>;
export declare function writeUsersOr503(deps: UserAdminDeps, res: ServerResponse, snapshot: UsersSnapshot): Promise<boolean>;
export declare function sendJson(res: ServerResponse, status: number, body: unknown): void;
export declare function sendCode(res: ServerResponse, status: number, code: UserAdminErrorCode): void;
//# sourceMappingURL=user-admin-common.d.ts.map