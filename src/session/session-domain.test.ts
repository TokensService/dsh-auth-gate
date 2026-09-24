import type { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import {
  awaitSessionReadiness,
  makeSessionReadiness,
  mountSessionDomain,
  SESSION_READINESS_TIMEOUT_MS,
} from "./session-domain.js";
import { SessionStore, type Session } from "./session-store.js";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** 永不 settle 的等待（超时路径用；executor 刻意空转）。 */
function neverSettles(): Promise<void> {
  return new Promise<void>(() => {
    // never settles by design
  });
}

function makeCtx(storageDomain: unknown): Context {
  return {
    get: (serviceName: string) => (serviceName === "storageDomain" ? storageDomain : undefined),
  } as unknown as Context;
}

function makeLog(): {
  logs: { level: string; message: unknown }[];
  error(message: unknown): void;
  info(message: unknown): void;
} {
  const logs: { level: string; message: unknown }[] = [];
  return {
    logs,
    error: (message) => logs.push({ level: "error", message }),
    info: (message) => logs.push({ level: "info", message }),
  };
}

function makeDomain(table: Map<string, Session>, closed?: string[]): unknown {
  return {
    table: () => table,
    close: () => {
      closed?.push("close");
    },
  };
}

describe("makeSessionReadiness", () => {
  it("wait pends until signal and resolves immediately afterwards", async () => {
    const readiness = makeSessionReadiness();
    let settled = false;
    void readiness.wait().then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    readiness.signal();
    await readiness.wait();
    expect(settled).toBe(true);
  });

  it("reset rearms the deferred for the next mount", async () => {
    const readiness = makeSessionReadiness();
    readiness.signal();
    readiness.reset();
    let settled = false;
    void readiness.wait().then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    readiness.signal();
    await readiness.wait();
    expect(settled).toBe(true);
  });
});

describe("awaitSessionReadiness", () => {
  it("returns as soon as the wait resolves (timeout stays dormant)", async () => {
    let signal: () => void = () => undefined;
    const pending = awaitSessionReadiness(
      () =>
        new Promise<void>((resolve) => {
          signal = resolve;
        }),
    );
    signal();
    await pending;
  });

  it("returns after the timeout when the wait never settles", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const pending = awaitSessionReadiness(neverSettles).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(SESSION_READINESS_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows a rejected wait so gates stay fail-closed", async () => {
    await expect(
      awaitSessionReadiness(() => Promise.reject(new Error("boom"))),
    ).resolves.toBeUndefined();
  });
});

describe("mountSessionDomain", () => {
  it("signals readiness and mounts nothing when storageDomain is missing", async () => {
    const readiness = makeSessionReadiness();
    const log = makeLog();
    const auth: { sessions: SessionStore | undefined } = { sessions: undefined };
    const effect = mountSessionDomain(makeCtx(undefined), auth, log, readiness);
    expect(effect).toBeUndefined();
    await readiness.wait(); // 已 signal：会话通道不会就绪，等待立即解除
    expect(auth.sessions).toBeUndefined();
    expect(
      log.logs.some(
        (e) => e.level === "error" && String(e.message).includes("storage-domain is unavailable"),
      ),
    ).toBe(true);
  });

  it("assigns the store and signals readiness once the domain opens", async () => {
    const readiness = makeSessionReadiness();
    const log = makeLog();
    const auth: { sessions: SessionStore | undefined } = { sessions: undefined };
    const effect = mountSessionDomain(
      makeCtx({ open: () => Promise.resolve(makeDomain(new Map<string, Session>())) }),
      auth,
      log,
      readiness,
    );
    const dispose = effect!();
    expect(auth.sessions).toBeUndefined();
    await readiness.wait();
    expect(auth.sessions).toBeInstanceOf(SessionStore);
    expect(
      log.logs.some((e) => e.level === "info" && String(e.message).includes("dsh_auth_sessions")),
    ).toBe(true);
    await dispose();
  });

  it("signals readiness (fail-closed) when the domain open fails", async () => {
    const readiness = makeSessionReadiness();
    const log = makeLog();
    const auth: { sessions: SessionStore | undefined } = { sessions: undefined };
    const effect = mountSessionDomain(
      makeCtx({ open: () => Promise.reject(new Error("boom")) }),
      auth,
      log,
      readiness,
    );
    const dispose = effect!();
    await readiness.wait();
    await tick();
    expect(auth.sessions).toBeUndefined();
    expect(log.logs.some((e) => String(e.message).includes("boom"))).toBe(true);
    await dispose();
  });

  it("resets readiness on dispose so a remount waits again", async () => {
    const readiness = makeSessionReadiness();
    const log = makeLog();
    const auth: { sessions: SessionStore | undefined } = { sessions: undefined };
    const closed: string[] = [];
    const effect = mountSessionDomain(
      makeCtx({ open: () => Promise.resolve(makeDomain(new Map<string, Session>(), closed)) }),
      auth,
      log,
      readiness,
    );
    const dispose = effect!();
    await readiness.wait();
    await dispose();
    expect(closed).toContain("close");
    let settled = false;
    void readiness.wait().then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
  });
});
