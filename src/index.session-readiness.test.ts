import type { Context } from "@deepseek-ai/cordis";
import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { WrappableRoute, WrappableServer, WrappableUpgradeRoute } from "./gate/index.js";
import { apply, type AuthConfig, type AuthService } from "./index.js";
import { digestToken, type Session } from "./session/index.js";

function cfg(): AuthConfig {
  return {
    mode: "token",
    sessionTtl: 0,
    cookieName: "dsh_auth",
    tokenRef: "DSH_AUTH_TOKEN",
    cookieSecure: true,
    usersFile: "",
    totp: "off",
    logoutOrder: 1000,
  };
}

function makeFakeServer(): WrappableServer {
  const exact = new Map<string, WrappableRoute>();
  const prefixes = new Map<string, WrappableRoute>();
  const upgrades = new Map<string, WrappableUpgradeRoute>();
  const server: WrappableServer = {
    exact,
    prefixes,
    upgrades,
    fallback: undefined,
    register(route) {
      exact.set(route.path, route);
      return () => exact.delete(route.path);
    },
    registerUpgrade(route) {
      upgrades.set(route.path, route);
      return () => upgrades.delete(route.path);
    },
    registerFallback(handler) {
      server.fallback = handler;
      return () => {
        server.fallback = undefined;
      };
    },
  };
  return server;
}

function makeCtx(server: WrappableServer, storageDomain: unknown) {
  const logs: { level: string; message: unknown }[] = [];
  const provided: Record<string, unknown> = {};
  const ctx = {
    get(serviceName: string): unknown {
      if (serviceName === "webServer") return server;
      if (serviceName === "storageDomain") return storageDomain;
      return undefined;
    },
    provide(serviceName: string, value: unknown): void {
      provided[serviceName] = value;
    },
    logger(): { error(message: unknown): void; info(message: unknown): void } {
      return {
        error: (message) => logs.push({ level: "error", message }),
        info: (message) => logs.push({ level: "info", message }),
      };
    },
    effect(callback: () => unknown): void {
      callback();
    },
  } as unknown as Context;
  return { ctx, logs, provided };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function cookieReq(token: string): IncomingMessage {
  return { headers: { cookie: `dsh_auth=${token}` } } as IncomingMessage;
}

describe("apply: 会话就绪接线（热重载窗口不误踢）", () => {
  it("waits for a slow session domain open instead of denying immediately", async () => {
    const server = makeFakeServer();
    const table = new Map<string, Session>();
    const token = "slow-open-session";
    table.set(digestToken(token), { subject: "token", createdAt: 0, expiresAt: 0, revoked: false });
    let resolveOpen: (domain: unknown) => void = () => undefined;
    const { ctx, provided } = makeCtx(server, {
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    apply(ctx, cfg());
    const auth = provided["auth"] as AuthService;
    let settled = false;
    const decision = Promise.resolve(auth.gate.decide(cookieReq(token), "exact", "/probe")).then(
      (outcome) => {
        settled = true;
        return outcome;
      },
    );
    await flush();
    expect(settled).toBe(false); // 存储未就绪：门等待就绪信号而非立即 deny
    resolveOpen({ table: () => table, close: () => undefined });
    await flush();
    await expect(decision).resolves.toBe("allow");
  });

  it("denies promptly when storageDomain is absent (readiness pre-signaled)", async () => {
    vi.useFakeTimers();
    try {
      const server = makeFakeServer();
      const { ctx, provided, logs } = makeCtx(server, undefined);
      apply(ctx, cfg());
      const auth = provided["auth"] as AuthService;
      const decision = Promise.resolve(auth.gate.decide(cookieReq("x"), "exact", "/probe"));
      await vi.advanceTimersByTimeAsync(0); // 不就绪也不空等：立即解除等待
      await expect(decision).resolves.toBe("deny");
      expect(
        logs.some(
          (e) => e.level === "error" && String(e.message).includes("storage-domain is unavailable"),
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
