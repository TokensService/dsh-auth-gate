// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SESSION_WATCH_CONFIRMATIONS,
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

/** 看门狗测试夹具：mock fetch/navigate + 假时钟，钩子随 describe 注册与清理。 */
function makeWatcher() {
  const fetchMock = vi.fn();
  const navigate = vi.fn();
  let dispose: (() => void) | undefined;
  const harness = {
    fetchMock,
    navigate,
    start(options?: { intervalMs?: number; confirmations?: number }): void {
      dispose = startSessionWatcher({ navigate, ...options });
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

describe("startSessionWatcher interval outcomes", () => {
  const w = makeWatcher();

  it("does not arm an expiry redirect for a never-expiring session", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(true, null));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 3);
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it("redirects to the login page exactly once after two consecutive unauthenticated probes", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start();
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled(); // 单次 false 不跳
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

  it("ignores transient failures and still redirects on later consecutive definitive expiries", async () => {
    w.fetchMock.mockRejectedValueOnce(new Error("network"));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
    w.fetchMock.mockResolvedValue(statusResponse(false));
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled(); // 第一次 false，仅计数
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });
});

describe("startSessionWatcher unauthenticated confirmations", () => {
  const w = makeWatcher();

  it("does not redirect on a single unauthenticated probe", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start();
    await flushMicrotasks();
    expect(w.fetchMock).toHaveBeenCalledTimes(1);
    expect(w.navigate).not.toHaveBeenCalled();
  });

  it("resets the count when an authenticated probe lands between two false ones", async () => {
    w.fetchMock.mockResolvedValueOnce(statusResponse(false));
    w.fetchMock.mockResolvedValueOnce(statusResponse(true, null));
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });

  it("resets the count when a probe fails between two false ones", async () => {
    w.fetchMock.mockResolvedValueOnce(statusResponse(false));
    w.fetchMock.mockRejectedValueOnce(new Error("network"));
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });

  it("honors an injected confirmation threshold", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start({ confirmations: 3 });
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).not.toHaveBeenCalled(); // 两次 false 还不够
    await vi.advanceTimersByTimeAsync(SESSION_WATCH_INTERVAL_MS);
    await flushMicrotasks();
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });

  it("redirects on the first unauthenticated probe with confirmations: 1", async () => {
    w.fetchMock.mockResolvedValue(statusResponse(false));
    w.start({ confirmations: 1 });
    await flushMicrotasks();
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });

  it("still redirects immediately at a confirmed expiresAt regardless of the threshold", async () => {
    const now = new Date("2026-09-19T00:00:00.000Z");
    vi.setSystemTime(now);
    w.fetchMock.mockResolvedValueOnce(statusResponse(true, now.getTime() + 60_000));
    w.fetchMock.mockRejectedValue(new Error("offline"));
    w.start({ confirmations: SESSION_WATCH_CONFIRMATIONS + 3 });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.navigate).toHaveBeenCalledTimes(1);
  });
});
