import type { IncomingMessage } from "node:http";
import { parseCookieHeader } from "../../shared/index.js";
import type { Gate, GuardKind } from "../../gate/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import { awaitSessionReadiness, type SessionStore } from "../../session/index.js";

export interface PasswordGateOptions {
  /** 会话访问器（M16 同形）：每次 decide 现取；undefined = 会话通道不可用。 */
  sessions: () => SessionStore | undefined;
  cookieName: string;
  /**
   * 会话就绪等待（可选，index.ts 注入会话就绪 deferred）：sessions() 为 undefined
   * 时有界等待就绪信号后重取再判断（热重载窗口不误踢）；未注入则维持即时 deny。
   */
  waitForSessions?: () => Promise<void>;
}

/**
 * password 模式门（P12）：白名单 → 会话 cookie → Bearer 会话 token → deny。
 * 门内零 KDF、零文件 IO；存储就绪时同步返回，未就绪且注入 waitForSessions 时异步
 * 有界等待（超时后仍 undefined 维持 fail-closed deny）；Bearer 通道按会话查表。
 */
export class PasswordGate implements Gate {
  private readonly sessions: () => SessionStore | undefined;
  private readonly cookieName: string;
  private readonly waitForSessions: (() => Promise<void>) | undefined;

  constructor(options: PasswordGateOptions) {
    this.sessions = options.sessions;
    this.cookieName = options.cookieName;
    this.waitForSessions = options.waitForSessions;
  }

  decide(
    req: IncomingMessage,
    _kind: GuardKind,
    pathname: string,
  ): "allow" | "deny" | Promise<"allow" | "deny"> {
    if (pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")) {
      return "allow";
    }
    const store = this.sessions();
    if (store !== undefined) return this.decideWithStore(req, store);
    if (this.waitForSessions === undefined) return "deny";
    return this.decideAfterWait(req, this.waitForSessions);
  }

  private async decideAfterWait(
    req: IncomingMessage,
    waitForSessions: () => Promise<void>,
  ): Promise<"allow" | "deny"> {
    await awaitSessionReadiness(waitForSessions);
    const store = this.sessions();
    return store === undefined ? "deny" : this.decideWithStore(req, store);
  }

  private decideWithStore(req: IncomingMessage, store: SessionStore): "allow" | "deny" {
    const cookie = parseCookieHeader(req.headers.cookie, this.cookieName);
    if (cookie !== undefined && cookie !== "" && store.getByToken(cookie) !== undefined) {
      return "allow";
    }
    const authorization = req.headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
    if (match !== null) {
      const bearer = match[1];
      if (bearer !== undefined && store.getByToken(bearer) !== undefined) return "allow";
    }
    return "deny";
  }
}
