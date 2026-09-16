import type { AuthContext } from "./context.ts";
/**
 * dsh-auth-gate client 半边，设置面板两处挂载：
 *
 * 1. 「用户管理」整页（`settings.section`，id `auth-users`，order 30）：password
 *    模式下的 users.yaml 管理 UI（列表/添加/改密/启停/TOTP/删除），数据走同源
 *    `/auth/users` 管理 API；token 模式端点未注册（404），页面显示不可用提示。
 * 2. 「退出登录 / Sign out」按钮（`settings.general.item`，root 作用域可追加列表
 *    槽，General 页堆叠渲染，按 order 升序）：会话带用户名时（password 模式），
 *    按钮上方显示「当前登录：\<username\>」，数据来自 `/auth/status` 探针
 *    （token 模式 username 恒 null，不渲染该行）。
 * 3. 会话过期看门狗（`ctx.effect` 常驻，无 UI）：周期 + 焦点事件探
 *    `/auth/status`，确认过期即整页跳转登录页，避免过期会话停在登录后界面。
 *
 * 登出顺序可配置：先以默认 order（1000）注册（探针失败/未开始前按钮也可见），再探
 * `/auth/status` 读取 host 配置的 `logoutOrder`，与默认不同则按配置值重注册
 * （同 id 注册 = 槽位替换，先注册新条目再释放旧条目，避免中间态空白）。
 *
 * 文案挂进 dsh 现有的 locale 机制（与「设置」里的语言切换同一套）：注册 `auth`
 * 词典（zh/en，登出键 + users.* 用户管理键），再以 `locale: "auth"` 给注册条目
 * 注入 `t` seat，文字随界面语言实时切换。不改任何服务端端点/会话语义。
 */
export declare const inject: string[];
export declare function apply(ctx: AuthContext): void;
//# sourceMappingURL=index.d.ts.map