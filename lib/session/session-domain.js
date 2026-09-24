import { sessionDomainSpec, SessionStore } from "./session-store.js";
/**
 * 门等待会话存储就绪的超时（毫秒）。插件热重载窗口内会话通道短暂不可用，门有界
 * 等待就绪信号后再判断；超时只解除等待，不代表就绪（仍 fail-closed）。
 */
export const SESSION_READINESS_TIMEOUT_MS = 3000;
export function makeSessionReadiness() {
    let signal = () => undefined;
    let current = new Promise((resolve) => {
        signal = resolve;
    });
    return {
        wait: () => current,
        signal: () => signal(),
        reset: () => {
            current = new Promise((resolve) => {
                signal = resolve;
            });
        },
    };
}
/**
 * 有界等待会话就绪：wait 解析、拒绝或超时都正常返回（永不 reject，门按 fail-closed
 * 继续判断而非抛错）。调用方随后重新现取 `sessions()` 再判断。
 */
export async function awaitSessionReadiness(wait, timeoutMs = SESSION_READINESS_TIMEOUT_MS) {
    let timer;
    await Promise.race([
        wait().catch(() => undefined),
        new Promise((resolve) => {
            timer = setTimeout(resolve, timeoutMs);
        }),
    ]);
    clearTimeout(timer);
}
/**
 * 会话层软接：storageDomain 缺失 -> error 日志 + signal（永不就绪）后守卫照常挂载；
 * 存在 -> effect 内 open domain，就绪后把 SessionStore 挂到 auth.sessions 并 signal；
 * open 失败同样 signal（fail-closed，不再空等）；dispose 时 reset 回未就绪。
 */
export function mountSessionDomain(ctx, auth, log, readiness) {
    const storageDomain = ctx.get("storageDomain");
    if (storageDomain === undefined) {
        log.error("storage-domain is unavailable: session persistence is disabled (guards stay mounted)");
        readiness.signal();
        return undefined;
    }
    return () => {
        let closed = false;
        const opening = storageDomain.open(sessionDomainSpec);
        const ready = opening.then((domain) => {
            if (closed) {
                void domain.close();
                return;
            }
            auth.sessions = new SessionStore(domain.table("sessions"));
            readiness.signal();
            log.info("session domain opened: dsh_auth_sessions");
        }, (error) => {
            readiness.signal();
            log.error(`session domain open failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        return async () => {
            closed = true;
            readiness.reset();
            await ready.catch(() => undefined);
            const domain = await opening.catch(() => undefined);
            await domain?.close();
        };
    };
}
//# sourceMappingURL=session-domain.js.map