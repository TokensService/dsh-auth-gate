import type { LogoutTranslate } from "./logout-action.tsx";
export interface SettingsUsersSectionProps {
    /** 注入的本地化 translate（locale seat，`auth` 词典）。 */
    t?: LogoutTranslate;
}
/**
 * 「用户管理」设置页（`settings.section` 槽，password 模式专用）：列出 users.yaml
 * 全部用户（禁用/TOTP/当前登录徽标），支持添加、改密、启停、TOTP 启停、删除。
 * 数据走同源 `/auth/users` 管理 API（会话自校验；token 模式 404 → 不可用提示）。
 */
export declare function SettingsUsersSection({ t }: SettingsUsersSectionProps): import("react").JSX.Element;
//# sourceMappingURL=users-section.d.ts.map