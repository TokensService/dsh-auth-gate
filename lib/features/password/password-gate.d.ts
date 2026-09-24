import type { IncomingMessage } from "node:http";
import type { Gate, GuardKind } from "../../gate/index.js";
import { type SessionStore } from "../../session/index.js";
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
export declare class PasswordGate implements Gate {
    private readonly sessions;
    private readonly cookieName;
    private readonly waitForSessions;
    constructor(options: PasswordGateOptions);
    decide(req: IncomingMessage, _kind: GuardKind, pathname: string): "allow" | "deny" | Promise<"allow" | "deny">;
    private decideAfterWait;
    private decideWithStore;
}
//# sourceMappingURL=password-gate.d.ts.map