import { type Translate } from "./user-import-controls.tsx";
export interface ImportPanelProps {
    t: Translate;
    /** 导入成功后由父级刷新用户列表。 */
    onChanged: () => void;
}
/**
 * 批量导入面板（仅 admin 挂载，D14）：本地文件（浏览器读原文）或服务器
 * imports/ 目录内 txt 二选一，提交 /auth/users/import；全量校验，失败按行号
 * 列出明细（码本地化），成功显示导入条数。
 */
export declare function ImportPanel({ t, onChanged }: ImportPanelProps): import("react").JSX.Element;
//# sourceMappingURL=user-import.d.ts.map