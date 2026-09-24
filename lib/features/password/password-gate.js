import { parseCookieHeader } from "../../shared/index.js";
import { AUTH_PATH_PREFIX } from "../../gate/index.js";
import { awaitSessionReadiness } from "../../session/index.js";
/**
 * password 模式门（P12）：白名单 → 会话 cookie → Bearer 会话 token → deny。
 * 门内零 KDF、零文件 IO；存储就绪时同步返回，未就绪且注入 waitForSessions 时异步
 * 有界等待（超时后仍 undefined 维持 fail-closed deny）；Bearer 通道按会话查表。
 */
export class PasswordGate {
    sessions;
    cookieName;
    waitForSessions;
    constructor(options) {
        this.sessions = options.sessions;
        this.cookieName = options.cookieName;
        this.waitForSessions = options.waitForSessions;
    }
    decide(req, _kind, pathname) {
        if (pathname === AUTH_PATH_PREFIX || pathname.startsWith(AUTH_PATH_PREFIX + "/")) {
            return "allow";
        }
        const store = this.sessions();
        if (store !== undefined)
            return this.decideWithStore(req, store);
        if (this.waitForSessions === undefined)
            return "deny";
        return this.decideAfterWait(req, this.waitForSessions);
    }
    async decideAfterWait(req, waitForSessions) {
        await awaitSessionReadiness(waitForSessions);
        const store = this.sessions();
        return store === undefined ? "deny" : this.decideWithStore(req, store);
    }
    decideWithStore(req, store) {
        const cookie = parseCookieHeader(req.headers.cookie, this.cookieName);
        if (cookie !== undefined && cookie !== "" && store.getByToken(cookie) !== undefined) {
            return "allow";
        }
        const authorization = req.headers.authorization;
        const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
        if (match !== null) {
            const bearer = match[1];
            if (bearer !== undefined && store.getByToken(bearer) !== undefined)
                return "allow";
        }
        return "deny";
    }
}
//# sourceMappingURL=password-gate.js.map