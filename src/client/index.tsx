import type { AuthContext } from "./context.ts";
import { SettingsLogoutAction } from "./logout-action.tsx";
import { startSessionWatcher } from "./session-watcher.ts";
import { USERS_DICT_EN, USERS_DICT_ZH } from "./users-dict.ts";
import { SettingsUsersSection } from "./users-section.tsx";

/** 本插件文案的词典命名域（locale 服务按 (ns, locale) 分开注册）。 */
const AUTH_NS = "auth";
/** 命名词典里登出键。 */
const LOGOUT_KEY = "logout";
/** 命名词典里「当前登录」用户名行键。 */
const SIGNED_IN_AS_KEY = "signedInAs";
/**
 * 默认槽位 order：注册时先用它（与 host 端 Config 默认一致），随后 `/auth/status`
 * 探针读到 host 配置的 `logoutOrder` 时按配置重注册。1000 已大于 dsh 自带条目
 * （permission -20 / language 0 / appearance 10 / composer-enter 20），
 * 除非第三方插件注册更大的 order，按钮始终留在通用设置页最底部。
 */
const DEFAULT_LOGOUT_ORDER = 1000;
/**
 * 「用户管理」设置页（settings.section）的导航 order：内置页 general 0 /
 * models 10 / plugins 15 / agent-presets 20 之后、第三方页（如 better-sidebar 100）
 * 之前。固定常量即可：section 级碰撞概率低，导航图标按 id 落到默认齿轮。
 */
const USERS_SECTION_ORDER = 30;

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
export const inject = ["slots", "locale"];

export function apply(ctx: AuthContext): void {
  // 词典注册（zh/en 双语，挂 fiber 卸载级联）。
  ctx.effect(
    () => [
      ctx.locale.register(AUTH_NS, "zh", {
        [LOGOUT_KEY]: "退出登录",
        [SIGNED_IN_AS_KEY]: "当前登录",
        ...USERS_DICT_ZH,
      }),
      ctx.locale.register(AUTH_NS, "en", {
        [LOGOUT_KEY]: "Sign out",
        [SIGNED_IN_AS_KEY]: "Signed in as",
        ...USERS_DICT_EN,
      }),
    ],
    "auth: logout dictionary",
  );

  // 会话过期看门狗（root 作用域常驻）：周期 + 焦点事件探 /auth/status，确认
  // 过期即整页跳回登录页。SPA 登录后不再整页导航，没有它过期会话会一直停在
  // 登录后界面（守卫只能拒绝「新」请求）。
  ctx.effect(() => startSessionWatcher(), "auth: session watcher");

  // 绑定 translate：读取活动语言（thunk 每次投影重读，跟随语言切换）。
  const t = ctx.locale.bind(AUTH_NS);

  // 「用户管理」设置页（整页 section；label thunk 跟随语言切换）。
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "auth-users",
        locale: AUTH_NS,
        order: USERS_SECTION_ORDER,
        label: () => t("users.nav"),
      },
      SettingsUsersSection,
    ),
  );

  ctx.slots.inject("settings.general.item", () => {
    const mount = (order: number): (() => void) =>
      ctx.slots.register(
        {
          name: "settings.general.item",
          id: "dsh-auth-gate-logout",
          locale: AUTH_NS,
          order,
          label: () => t(LOGOUT_KEY),
        },
        SettingsLogoutAction,
      );
    let dispose: (() => void) | undefined = mount(DEFAULT_LOGOUT_ORDER);
    // 与 SettingsLogoutAction 相同的 status 探针：读 host 的 logoutOrder 配置并在
    // 不同时重注册。探针抛错（如测试环境无 fetch）保持默认，绝不吞掉注册。
    try {
      void fetch("/auth/status")
        .then((res) => res.json() as Promise<{ logoutOrder?: unknown }>)
        .then((body: { logoutOrder?: unknown }) => {
          const order = body.logoutOrder;
          if (
            typeof order !== "number" ||
            !Number.isInteger(order) ||
            order === DEFAULT_LOGOUT_ORDER
          ) {
            return;
          }
          const previous = dispose;
          dispose = mount(order);
          previous?.();
        })
        .catch(() => undefined);
    } catch {
      // fetch 不可用（测试环境/旧浏览器）：保持默认 order。
    }
    return () => dispose?.();
  });
}
