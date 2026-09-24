import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { PasswordGate } from "./password-gate.js";
import { SESSION_READINESS_TIMEOUT_MS, type SessionStore } from "../../session/index.js";

function fakeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

function fakeSessions(validTokens: ReadonlySet<string>): SessionStore {
  const session = {
    subject: "alice",
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
    revoked: false,
  };
  return {
    getByToken: (token: string) => (validTokens.has(token) ? session : undefined),
  } as unknown as SessionStore;
}

/** 永不会的就绪信号（超时路径用；executor 刻意不 settle）。 */
function neverReady(): Promise<void> {
  return new Promise<void>(() => {
    // never settles by design
  });
}

function makeGate(options?: {
  sessions?: () => SessionStore | undefined;
  cookieName?: string;
  waitForSessions?: () => Promise<void>;
}): PasswordGate {
  return new PasswordGate({
    sessions: options?.sessions ?? (() => undefined),
    cookieName: options?.cookieName ?? "dsh_auth",
    ...(options?.waitForSessions !== undefined ? { waitForSessions: options.waitForSessions } : {}),
  });
}

describe("PasswordGate", () => {
  it("allows the /auth whitelist with no credentials at all", () => {
    const gate = makeGate();
    expect(gate.decide(fakeReq({}), "exact", "/auth")).toBe("allow");
    expect(gate.decide(fakeReq({}), "exact", "/auth/login")).toBe("allow");
    expect(gate.decide(fakeReq({}), "prefix", "/auth/whatever")).toBe("allow");
  });

  it("allows a valid session cookie and rejects unknown/expired/revoked tokens", () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["good-session"])) });
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=unknown" }), "exact", "/probe")).toBe("deny");
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=revoked" }), "exact", "/probe")).toBe("deny");
    expect(gate.decide(fakeReq({}), "exact", "/probe")).toBe("deny");
  });

  it("allows a session token via Bearer and accepts case variants", () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["session-tok"])) });
    expect(gate.decide(fakeReq({ authorization: "Bearer session-tok" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(gate.decide(fakeReq({ authorization: "bearer session-tok" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(gate.decide(fakeReq({ authorization: "Bearer unknown" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(gate.decide(fakeReq({ authorization: "Token session-tok" }), "exact", "/probe")).toBe(
      "deny",
    );
  });

  it("denies everything (except whitelist) when sessions are unavailable", () => {
    const gate = makeGate({ sessions: () => undefined });
    expect(gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(gate.decide(fakeReq({ authorization: "Bearer session-tok" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(gate.decide(fakeReq({}), "upgrade", "/api/events.host")).toBe("deny");
  });

  it("returns synchronously (no promise)", () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["t"])) });
    const decision = gate.decide(fakeReq({ cookie: "dsh_auth=t" }), "exact", "/probe");
    expect(typeof decision).toBe("string");
    expect(decision).toBe("allow");
  });
});

describe("PasswordGate session readiness", () => {
  it("waits for the session store and allows a valid cookie once it appears", async () => {
    let store: SessionStore | undefined;
    const gate = makeGate({
      sessions: () => store,
      waitForSessions: () => {
        store = fakeSessions(new Set(["good-session"]));
        return Promise.resolve();
      },
    });
    await expect(
      gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe"),
    ).resolves.toBe("allow");
  });

  it("still denies when the store stays unavailable after the wait", async () => {
    const gate = makeGate({
      sessions: () => undefined,
      waitForSessions: () => Promise.resolve(),
    });
    await expect(
      gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe"),
    ).resolves.toBe("deny");
    await expect(
      gate.decide(fakeReq({ authorization: "Bearer session-tok" }), "exact", "/probe"),
    ).resolves.toBe("deny");
  });

  it("stops waiting after the readiness timeout and denies (fail-closed)", async () => {
    vi.useFakeTimers();
    try {
      const gate = makeGate({
        sessions: () => undefined,
        waitForSessions: neverReady,
      });
      const decision = gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe");
      await vi.advanceTimersByTimeAsync(SESSION_READINESS_TIMEOUT_MS);
      await expect(decision).resolves.toBe("deny");
    } finally {
      vi.useRealTimers();
    }
  });

  it("denies immediately without waiting when no waitForSessions is injected", () => {
    const gate = makeGate({ sessions: () => undefined });
    const decision = gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe");
    expect(typeof decision).toBe("string");
    expect(decision).toBe("deny");
  });
});
