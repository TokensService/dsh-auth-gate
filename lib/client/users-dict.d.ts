/**
 * 用户管理设置页的词典（`auth` 命名域，zh/en 成对）。
 * 错误文案按 host 稳定错误码命名（users.error.<code>），client 直接按码查表。
 */
export declare const USERS_DICT_ZH: Record<string, string>;
export declare const USERS_DICT_EN: Record<string, string>;
/**
 * 错误码 → 本地化文案；码缺失（词典未覆盖）时回落 generic。
 * users-section 与 user-import 共用。
 */
export declare function userErrorText(t: (key: string) => string, code: string): string;
//# sourceMappingURL=users-dict.d.ts.map