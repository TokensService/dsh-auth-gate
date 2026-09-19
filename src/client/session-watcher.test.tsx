// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loginRedirectUrl,
  SESSION_WATCH_INTERVAL_MS,
  startSessionWatcher,
} from "./session-watcher.ts";

/** 让 probe 的整条微任务链（fetch → json → 判定）在断言前跑完。 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** /auth/status 的正常响应（200 + authenticated + 可选绝对过期时间/服务端时间）。 */
function statusResponse(
  authenticated: boolean,
  expiresAt?: number | null,
  serverTime: number = Date.now(),
): unknown {
  return {
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        authenticated,
        ...(expiresAt === undefined ? {} : { expiresAt }),
        serverTime,
      }),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => (resolve = done)), resolve };
}

/** 临时覆写 document.visibilityState（jsdom 默认 visible；configurable 以便还原）。 */
function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

/** 看门狗测试夹具：mock fetch/navigate + 假时钟，钩子随 describe 注册与清理。 */
function makeWatcher() {
  const fetchMock = vi.fn();
  const navigate = vi.fn();
  let dispose: (() => void) | undefined;
  const harness = {
    fetchMock,
    navigate,
    start(): void {
      dispose = startSessionWatcher({ navigate });
    },
    stop(): void {
      dispose?.();
      dispose = undefined;
    },
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    harness.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    navigate.mockReset();
  });
  return harness;
}

describe("loginRedirectUrl", () => {
  it("builds the login URL with the current path as next", () => {
    expect(loginRedirectUrl("/", "")).toBe("/auth/login?next=%2F");
    expect(loginRedirectUrl("/chat", "?a=1&b=2")).toBe(
      `/auth/login?next=${encodeURIComponent("/chat?a=1&b=2")}`,
    );
  });

  it("falls back to / for non-relative and /auth paths", () => {
    expect(loginRedirectUrl("//evil.example", "")).toBe("/auth/login?next=%2F");
    expect(loginRedirectUrl("relative", "")).toBe("/auth/login?next=%2F");
    expect(loginRedirectUrl("/auth", "")).toBe("/auth/login?next=%2F");
    expect(loginRedirectUrl("/auth/login", "")).toBe("/auth/login?next=%2F");
  });
});

describe("startSessionWatcher interval probing", () => {
  const w = makeWatcher();

  it("keeps watching without navigating while the session stays valid", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(true));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 3);
    expect(w.fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(w.fetchMock).toHaveBeenCalledWith("/auth/status", { cache: "no-store" });
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it("probes immediately and redirects at the server-provided expiry without another response", async () => {
    const now = new Date("2026-09-19T00:00:00.000Z");
    vi.setSystemTime(now);
    w.fetchMock.mockResolvedValue(statusResponse(true, now.getTime() + 60_000));
    w.start();
    await flushMicrotasks();
    expect(w.fetchMock).toHaveBeenCalledTimes(1);

    w.fetchMock.mockRejectedValue(new Error("offline"));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(w.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });

  it("uses server-relative duration when the browser clock is ahead", async () => {
    const serverNow = Date.parse("2026-09-19T00:00:00.000Z");
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    const browserNow = Date.now();
    w.fetchMock.mockImplementation(() => {
      const elapsed = Date.now() - browserNow;
      return Promise.resolve(statusResponse(true, serverNow + 60_000, serverNow + elapsed));
    });
    w.start();
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(w.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });
});

describe("startSessionWatcher response ordering", () => {
  const w = makeWatcher();

  it("ignores an older unauthenticated response while a newer probe is pending", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    w.fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    w.start();
    window.dispatchEvent(new Event("focus"));
    first.resolve(statusResponse(false));
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
    second.resolve(statusResponse(true, null));
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it("ignores an older finite response after a newer never-expiring response", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    w.fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    w.start();
    window.dispatchEvent(new Event("focus"));
    second.resolve(statusResponse(true, null));
    await flushMicrotasks();
    first.resolve(statusResponse(true, Date.now() + 1000));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it("ignores an older never-expiring response after a newer finite response", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    w.fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    w.start();
    window.dispatchEvent(new Event("focus"));
    second.resolve(statusResponse(true, Date.now() + 1000));
    await flushMicrotasks();
    first.resolve(statusResponse(true, null));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1000);
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });
});

describe("startSessionWatcher interval outcomes", () => {
  const w = makeWatcher();

  it("does not arm an expiry redirect for a never-expiring session", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(true, null));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 3);
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it("redirects to the login page exactly once after the session expires", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).toHaveBeenCalledTimes(1);
    expect(w.navigate).toHaveBeenCalledWith("/auth/login?next=%2F");
    // 跳转后停表：后续 tick 不再探测也不再导航。
    const probes = w.fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 3);
    expect(w.fetchMock.mock.calls.length).toBe(probes);
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });

  it("ignores transient failures and still redirects on a later definitive expiry", async () => {
    w.fetchMock.mockRejectedValueOnce(new Error("network"));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
    w.fetchMock.mockResolvedValue(statusResponse(false));
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });
});

describe("startSessionWatcher inconclusive probes", () => {
  const w = makeWatcher();

  it("ignores non-200 responses", async () => {
    w.fetchMock.mockResolvedValue({ ok: false, status: 503, json: () => Promise.resolve({}) });
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it("ignores bodies that fail JSON parsing or lack the authenticated flag", async () => {
    w.fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("bad json")),
    });
    w.fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}) });
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
  });
});

describe("startSessionWatcher focus and disposal", () => {
  const w = makeWatcher();

  it("probes immediately on window focus", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start();
    window.dispatchEvent(new Event("focus"));
    await flushMicrotasks();
    expect(w.fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });

  it("probes when the tab becomes visible and skips while hidden", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(true));
    w.start();
    await flushMicrotasks();
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();
    expect(w.fetchMock).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();
    expect(w.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops probing after dispose", async () => {
    let resolveStatus: ((value: unknown) => void) | undefined;
    w.fetchMock.mockImplementation(() => new Promise((resolve) => (resolveStatus = resolve)));
    w.start();
    w.stop();
    resolveStatus?.(statusResponse(false));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 2);
    window.dispatchEvent(new Event("focus"));
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();
    expect(w.fetchMock).toHaveBeenCalledTimes(1);
    expect(w.navigate).not.toHaveBeenCalled();
  });
});
