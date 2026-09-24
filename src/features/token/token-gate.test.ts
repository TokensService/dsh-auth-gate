import type { IncomingMessage } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { SESSION_READINESS_TIMEOUT_MS, type SessionStore } from "../../session/index.js";
import { safeEqual, TokenGate } from "./token-gate.js";

function fakeReq(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

function fakeSessions(validTokens: ReadonlySet<string>): SessionStore {
  const session = {
    subject: "token",
    createdAt: 0,
    expiresAt: Date.now() + 60_000,
    revoked: false,
  };
  return {
    getByToken: (token: string) => (validTokens.has(token) ? session : undefined),
  } as unknown as SessionStore;
}

function makeGate(options?: {
  resolveToken?: () => Promise<string | undefined>;
  sessions?: () => SessionStore | undefined;
  cookieName?: string;
  waitForSessions?: () => Promise<void>;
}): TokenGate {
  return new TokenGate({
    resolveToken: options?.resolveToken ?? (() => Promise.resolve(undefined)),
    sessions: options?.sessions ?? (() => undefined),
    cookieName: options?.cookieName ?? "dsh_auth",
    ...(options?.waitForSessions !== undefined ? { waitForSessions: options.waitForSessions } : {}),
  });
}

describe("TokenGate", () => {
  it("allows the /auth whitelist with no credentials at all", async () => {
    const gate = makeGate();
    expect(await gate.decide(fakeReq({}), "exact", "/auth")).toBe("allow");
    expect(await gate.decide(fakeReq({}), "exact", "/auth/login")).toBe("allow");
    expect(await gate.decide(fakeReq({}), "prefix", "/auth/whatever")).toBe("allow");
  });

  it("allows a valid session cookie and falls through otherwise", async () => {
    const gate = makeGate({ sessions: () => fakeSessions(new Set(["good-session"])) });
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "allow",
    );
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=unknown" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=revoked" }), "exact", "/probe")).toBe(
      "deny",
    );
  });

  it("allows a correct bearer token, rejects a wrong one, and accepts case variants", async () => {
    const token = "top-secret";
    const gate = makeGate({ resolveToken: () => Promise.resolve(token) });
    expect(
      await gate.decide(fakeReq({ authorization: `Bearer ${token}` }), "exact", "/probe"),
    ).toBe("allow");
    expect(
      await gate.decide(fakeReq({ authorization: `bearer ${token}` }), "exact", "/probe"),
    ).toBe("allow");
    expect(await gate.decide(fakeReq({ authorization: "Bearer wrong" }), "exact", "/probe")).toBe(
      "deny",
    );
  });

  it("skips the cookie channel without sessions but still honors bearer", async () => {
    const token = "top-secret";
    const gate = makeGate({
      sessions: () => undefined,
      resolveToken: () => Promise.resolve(token),
    });
    expect(await gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe")).toBe(
      "deny",
    );
    expect(
      await gate.decide(
        fakeReq({ cookie: "dsh_auth=good-session", authorization: `Bearer ${token}` }),
        "exact",
        "/probe",
      ),
    ).toBe("allow");
  });

  it("denies without any credential", async () => {
    const gate = makeGate();
    expect(await gate.decide(fakeReq({}), "exact", "/probe")).toBe("deny");
    expect(await gate.decide(fakeReq({}), "upgrade", "/api/events.host")).toBe("deny");
  });

  it("denies (fail-closed) when the resolver throws", async () => {
    const gate = makeGate({
      resolveToken: () => Promise.reject(new Error("boom")),
    });
    await expect(
      gate.decide(fakeReq({ authorization: "Bearer x" }), "exact", "/probe"),
    ).resolves.toBe("deny");
  });
});

/** 永不会的就绪信号（超时路径用；executor 刻意不 settle）。 */
function neverReady(): Promise<void> {
  return new Promise<void>(() => {
    // never settles by design
  });
}

describe("TokenGate session readiness", () => {
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

  it("keeps honoring bearer and denies an unknown cookie when the store never arrives", async () => {
    const token = "top-secret";
    const gate = makeGate({
      sessions: () => undefined,
      resolveToken: () => Promise.resolve(token),
      waitForSessions: () => Promise.resolve(),
    });
    await expect(
      gate.decide(fakeReq({ cookie: "dsh_auth=good-session" }), "exact", "/probe"),
    ).resolves.toBe("deny");
    await expect(
      gate.decide(fakeReq({ authorization: `Bearer ${token}` }), "exact", "/probe"),
    ).resolves.toBe("allow");
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
});

describe("safeEqual", () => {
  it("matches known vectors", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});
