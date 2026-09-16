/**
 * 会话过期看门狗（client 半边）。dsh web 是长寿命 SPA：登录后页面不再整页
 * 导航，而服务端会话过期后守卫只能拒绝「新」请求（页面导航 302 登录页、
 * XHR 401、WS 拒握手），已加载的界面不会自己退回登录页，表现为登录超时后
 * 仍停留在登录后界面。本模块按周期 + 窗口焦点事件探测 /auth/status，拿到
 * 明确的 authenticated:false 即整页跳转登录页（next 回跳当前路径）。
 * 不确定的探测结果（网络错误、非 200、JSON 解析失败、字段缺失）一律不跳，
 * 避免服务器重启或网络抖动把人误踢下线。
 */

/** 探测间隔（毫秒）：会话过期后最迟在这个量级内跳回登录页。 */
export const SESSION_WATCH_INTERVAL_MS = 30_000;

/** 状态端点（token / password 两种模式都注册；GET 响应 JSON 含 authenticated）。 */
export const SESSION_STATUS_URL = "/auth/status";

/**
 * 过期跳转目标：/auth/login?next=<当前路径>。next 与服务端 validateNext 同
 * 规则（站内相对路径、不指回 /auth 自身），不合法时回落 "/"（服务端会再校验
 * 一次，这里只是少发一个必然被回落的值）。
 */
export function loginRedirectUrl(pathname: string, search: string): string {
  const usable =
    pathname.startsWith("/") &&
    !pathname.startsWith("//") &&
    pathname !== "/auth" &&
    !pathname.startsWith("/auth/");
  const next = usable ? pathname + search : "/";
  return `/auth/login?next=${encodeURIComponent(next)}`;
}

/** 看门狗可调项（生产全用默认值；测试注入间隔与跳转 spy）。 */
export interface SessionWatcherOptions {
  /** 探测间隔（默认 30 秒）。 */
  intervalMs?: number;
  /** 整页跳转实现（默认 window.location.assign；jsdom 无真导航，测试注入 spy）。 */
  navigate?: (url: string) => void;
}

/**
 * 启动看门狗并返回 disposer（清定时器 + 摘事件监听，供 ctx.effect 级联卸载）。
 * 跳转最多发生一次：首次确认过期即停表摘监听，在途探针晚到的结果不再重复导航。
 */
export function startSessionWatcher(options: SessionWatcherOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? SESSION_WATCH_INTERVAL_MS;
  const navigate =
    options.navigate ??
    ((url: string): void => {
      window.location.assign(url);
    });
  let expired = false;

  const probe = async (): Promise<void> => {
    if (expired) return;
    let body: { authenticated?: unknown };
    try {
      const res = await fetch(SESSION_STATUS_URL, { cache: "no-store" });
      if (!res.ok) return;
      body = (await res.json()) as { authenticated?: unknown };
    } catch {
      return; // 网络 / 解析失败：状态不确定，保持现状等下一轮
    }
    if (expired || body.authenticated !== false) return;
    expired = true;
    dispose();
    navigate(loginRedirectUrl(window.location.pathname, window.location.search));
  };

  const check = (): void => {
    void probe();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") check();
  };

  const timer = setInterval(check, intervalMs);
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisibilityChange);

  function dispose(): void {
    clearInterval(timer);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  return dispose;
}
