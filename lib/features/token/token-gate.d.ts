import type { IncomingMessage } from "node:http";
import type { Gate, GuardKind } from "../../gate/index.js";
import { type SessionStore } from "../../session/index.js";
/**
 * 恒时比较：双方 sha256 Buffer 摘要后 timingSafeEqual（M17：timingSafeEqual 只接受
 * Buffer/TypedArray：hex 字符串直接 TypeError；Buffer 摘要双方恒 32 字节，无长度侧信道）。
 */
export declare function safeEqual(input: string, stored: string): boolean;
export interface TokenGateOptions {
    /** 每次 decide 调用的凭证解析器（index.ts 注入 credentials.resolve 闭包）。 */
    resolveToken: () => Promise<string | undefined>;
    /** 会话访问器（M16）：每次 decide 现取（domain 异步就绪；undefined = cookie 通道不可用。 */
    sessions: () => SessionStore | undefined;
    cookieName: string;
    /**
     * 会话就绪等待（可选，index.ts 注入会话就绪 deferred）：sessions() 为 undefined
     * 时有界等待就绪信号后重取再判断（热重载窗口不误踢）；未注入则立即按现状判断。
     */
    waitForSessions?: () => Promise<void>;
}
/** 共享 token 门（M2）：白名单 → 会话 cookie → Bearer，恒时校验，fail-closed。 */
export declare class TokenGate implements Gate {
    private readonly resolveToken;
    private readonly sessions;
    private readonly cookieName;
    private readonly waitForSessions;
    constructor(options: TokenGateOptions);
    decide(req: IncomingMessage, _kind: GuardKind, pathname: string): Promise<"allow" | "deny">;
}
//# sourceMappingURL=token-gate.d.ts.map