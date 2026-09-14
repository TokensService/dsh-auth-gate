import { type UserAdminDeps, type UserAdminErrorCode } from "./user-admin-common.js";
/** 批量导入端点路径（exact；`/auth` 白名单内，端点自做会话+admin 校验）。 */
export declare const USERS_IMPORT_PATH = "/auth/users/import";
/** 导入请求体 / 服务端文件上限（批量场景较 M10 放宽，仍硬封顶）。 */
export declare const IMPORT_BODY_LIMIT: number;
/** 单次导入条目上限：scrypt 成本随条目线性（libuv 线程池并行，100 条 ≈ 秒级）。 */
export declare const IMPORT_MAX_ENTRIES = 100;
/** 单行校验失败明细（line 为 1 起始行号，client 按 code 本地化）。 */
export interface ImportFailure {
    line: number;
    username: string;
    code: UserAdminErrorCode;
}
interface ImportEntry {
    line: number;
    username: string;
    password: string;
}
/**
 * 注册 exact `/auth/users/import`（D14：txt 批量导入）。GET 列出服务端导入目录
 * （`<usersDir>/imports/`）里的 `.txt` 文件；POST `{text}`（本地文件原文）或
 * `{file}`（服务端目录内文件名）二选一，全量校验后原子写入（all-or-nothing）。
 * 仅 admin；非 admin → 403 forbidden。
 */
export declare function registerUserImportEndpoints(deps: UserAdminDeps): () => void;
/**
 * 逐行解析 `用户名,密码`：跳过空行与 `#` 注释；首个逗号前为用户名
 * （用户名本身不含逗号），其余为密码（两端空白裁剪）。
 */
export declare function parseImportText(text: string): {
    entries: ImportEntry[];
    failures: ImportFailure[];
};
export {};
//# sourceMappingURL=user-admin-import.d.ts.map