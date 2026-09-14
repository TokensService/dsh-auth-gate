import { type CSSProperties } from "react";
import type { AdminUser } from "./users-api.ts";
/** 行内小按钮（主题变量描边，不硬编码色值）。 */
export declare const SMALL_BUTTON_STYLE: CSSProperties;
type Translate = (key: string) => string;
export interface UserRowProps {
    user: AdminUser;
    t: Translate;
    /** 当前登录用户是否为 admin（决定管理按钮是否出现；改密按钮本人亦可见）。 */
    isAdmin: boolean;
    busy: boolean;
    onPassword: (username: string, password: string) => Promise<boolean>;
    onToggleDisabled: (user: AdminUser) => Promise<boolean>;
    onTotp: (user: AdminUser) => Promise<boolean>;
    onDelete: (username: string) => Promise<boolean>;
}
/** 单个用户行：状态徽标 + 改密内联表单 + 管理操作组（仅 admin，删除两步确认）。 */
export declare function UserRow(props: UserRowProps): import("react").JSX.Element;
export interface AddUserFormProps {
    t: Translate;
    busy: boolean;
    onAdd: (username: string, password: string) => Promise<boolean>;
}
/** 添加用户表单（成功后清空输入）。 */
export declare function AddUserForm({ t, busy, onAdd }: AddUserFormProps): import("react").JSX.Element;
export {};
//# sourceMappingURL=user-rows.d.ts.map