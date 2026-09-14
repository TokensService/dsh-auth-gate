import { Context, type Fiber } from "@deepseek-ai/cordis";
import type { WrappableServer } from "./gate/index.js";
export type RealServer = WrappableServer & {
    readonly port: number;
};
export declare const TEST_PASSWORD = "s3cret-pw";
/** 真实栈：storage-json + storage-domain + WebServer + 插件（password 模式）。 */
export declare function mountUsersStack(): Promise<{
    ctx: Context;
    port: number;
    fibers: Fiber[];
    root: string;
}>;
export declare function unmountStack(fibers: Fiber[], root: string): Promise<void>;
/** 真实登录拿会话 cookie（默认 admin / TEST_PASSWORD）。 */
export declare function loginCookie(base: string, username?: string): Promise<string>;
export declare function mutate(base: string, method: string, cookie: string, body: unknown): Promise<Response>;
export declare function importCall(base: string, method: string, cookie: string, body?: unknown): Promise<Response>;
//# sourceMappingURL=integration-users-helpers.d.ts.map