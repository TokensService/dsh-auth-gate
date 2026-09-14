import type { IncomingMessage, ServerResponse } from "node:http";
import { type UserAdminDeps } from "./user-admin-common.js";
/** PATCH /auth/users {username, password?, disabled?, totp?}：改密/启停/TOTP 启停。 */
export declare function handleUserUpdate(deps: UserAdminDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
/** DELETE /auth/users {username}：删除用户；自我删除/最后一个启用用户保护。 */
export declare function handleUserDelete(deps: UserAdminDeps, req: IncomingMessage, res: ServerResponse): Promise<void>;
//# sourceMappingURL=user-admin-mutations.d.ts.map