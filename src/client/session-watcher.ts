/**
 * 会话过期看门狗（client 半边）。dsh web 是长寿命 SPA：登录后页面不再整页
 * 导航，而服务端会话过期后守卫只能拒绝「新」请求（页面导航 302 登录页、
 * XHR 401、WS 拒握手），已加载的界面不会自己退回登录页，表现为登录超时后
 * 仍停留在登录后界面。本模块启动后立即探测 /auth/status；有限会话按服务端
 * expiresAt - serverTime 安排本地相对到期定时器，并以周期 + 窗口焦点/可见性
 * 事件作为吊销兜底。拿到明确的 authenticated:false 或到达已确认的 expiresAt 时整页跳转
 * 登录页（next 回跳当前路径）。不确定的探测结果（网络错误、非 200、JSON 解析
 * 失败、字段缺失）一律不跳，也不取消已知期限，避免网络抖动误踢或延迟退出。
 */

/** 探测间隔（毫秒）：用于发现吊销，并作为绝对到期定时器之外的兜底。 */
export const SESSION_WATCH_INTERVAL_MS = 30_000;

/** 状态端点（token / password 两种模式都注册；GET 响应 JSON 含 authenticated）。 */
export const SESSION_STATUS_URL = "/auth/status";

/** 浏览器 setTimeout 的有符号 32 位上限；更远的期限分段重挂。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

interface SessionStatusBody {
  authenticated?: unknown;
  expiresAt?: unknown;
  serverTime?: unknown;
}

async function fetchSessionStatus(): Promise<SessionStatusBody | undefined> {
  try {
    const res = await fetch(SESSION_STATUS_URL, { cache: "no-store" });
    if (!res.ok) return undefined;
    return (await res.json()) as SessionStatusBody;
  } catch {
    return undefined;
  }
}

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
 * 跳转最多发生一次：首次确认过期即停表摘监听。并发探针按请求启动顺序提交状态，
 * 较旧的响应不能覆盖较新的确定结果。
 */
export function startSessionWatcher(options: SessionWatcherOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? SESSION_WATCH_INTERVAL_MS;
  const navigate =
    options.navigate ??
    ((url: string): void => {
      window.location.assign(url);
    });
  let active = true;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let nextProbeId = 0;
  let lastAppliedProbeId = 0;

  const cleanup = (): void => {
    clearInterval(timer);
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  const redirect = (): void => {
    if (!active) return;
    active = false;
    cleanup();
    navigate(loginRedirectUrl(window.location.pathname, window.location.search));
  };

  const armExpiry = (remainingMs: number): void => {
    if (expiryTimer !== undefined) clearTimeout(expiryTimer);
    if (remainingMs <= 0) {
      redirect();
      return;
    }
    const delay = Math.min(remainingMs, MAX_TIMER_DELAY_MS);
    expiryTimer = setTimeout(() => {
      if (!active) return;
      if (remainingMs <= delay) redirect();
      else armExpiry(remainingMs - delay);
    }, delay);
  };

  const probe = async (): Promise<void> => {
    if (!active) return;
    const probeId = ++nextProbeId;
    const requestStartedAt = performance.now();
    const body = await fetchSessionStatus();
    if (body === undefined) return; // 状态不确定：保持现状等下一轮
    if (!active || probeId < lastAppliedProbeId) return;
    if (body.authenticated === false) {
      lastAppliedProbeId = probeId;
      redirect();
      return;
    }
    if (body.authenticated !== true) return;
    lastAppliedProbeId = probeId;
    if (body.expiresAt === null) {
      if (expiryTimer !== undefined) clearTimeout(expiryTimer);
      expiryTimer = undefined;
      return;
    }
    if (isFiniteTimestamp(body.expiresAt) && isFiniteTimestamp(body.serverTime)) {
      const responseAge = Math.max(0, performance.now() - requestStartedAt);
      armExpiry(body.expiresAt - body.serverTime - responseAge);
    }
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
    active = false;
    cleanup();
  }
  check();
  return dispose;
}
