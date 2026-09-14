import { type UserAdminDeps } from "./user-admin-common.js";
export type { UserAdminDeps, UserAdminErrorCode } from "./user-admin-common.js";
/** 用户管理端点路径（exact；`/auth` 白名单内，端点自做会话校验）。 */
export declare const USERS_PATH = "/auth/users";
/**
 * 注册 exact `/auth/users`（password 模式专属的用户管理 API）。method 内部分发：
 * GET 列表 / POST 新增 / PATCH 变更（密码、disabled、totp）/ DELETE 删除。
 * 全部要求有效会话（cookie 或 Bearer 会话 token，与门的会话模型一致）；写操作只收
 * `application/json`（表单无法伪造 JSON content-type，SameSite=Lax 之上再挡 CSRF）。
 * 权限（D13）：GET 对任意会话开放；POST/DELETE 仅 admin；PATCH 中 admin 可改任意
 * 用户，非 admin 只能改自己的密码（带 disabled/totp 字段或目标非己 → 403 forbidden）。
 */
export declare function registerUserAdminEndpoints(deps: UserAdminDeps): () => void;
//# sourceMappingURL=user-admin-endpoints.d.ts.map