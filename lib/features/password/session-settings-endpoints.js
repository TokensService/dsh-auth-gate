import { loadSettingsFile, MAX_SESSION_TTL, MIN_SESSION_TTL, readSessionTtl, writeSettingsFile, } from "../../shared/index.js";
import { readJsonOrRespond, requireAdmin, requireSubject, sendCode, sendJson, } from "./user-admin-common.js";
/** 登录超时（会话 TTL）管理端点路径（exact；`/auth` 白名单内，端点自做会话校验）。 */
export const SETTINGS_PATH = "/auth/settings";
/**
 * 注册 exact `/auth/settings`（password 模式专属的登录超时管理 API，D16）。
 * GET 任意会话可读（生效值 = 文件值 ?? 配置默认，随附配置默认）；PATCH 仅 admin，
 * 收整型秒 [MIN_SESSION_TTL, MAX_SESSION_TTL]，全量写 settings.yaml（损坏文件可被
 * 一次成功写自愈）。生效语义：只影响之后新签发的会话；存量会话按签发时 TTL 过期
 * （与 users 页的"只挡新登录"脚注同义）。
 */
export function registerSessionSettingsEndpoints(deps) {
    return deps.register({
        kind: "exact",
        path: SETTINGS_PATH,
        handler: (req, res) => dispatch(deps, req, res),
    });
}
function dispatch(deps, req, res) {
    if (req.method === "GET")
        return handleGet(deps, req, res);
    if (req.method === "PATCH")
        return handlePatch(deps, req, res);
    res.setHeader("cache-control", "no-store");
    res.writeHead(405, { allow: "GET, PATCH", "content-type": "text/plain" });
    res.end("method not allowed");
}
/** GET /auth/settings：生效 TTL + 配置默认 TTL（任意会话可读；读文件失败 → 503）。 */
async function handleGet(deps, req, res) {
    const subject = requireSubject(deps, req, res);
    if (subject === undefined)
        return;
    const loaded = await loadSettingsOr503(deps, res);
    if (loaded === undefined)
        return;
    sendJson(res, 200, {
        sessionTtl: loaded.settings.sessionTtl ?? deps.defaultTtl,
        defaultTtl: deps.defaultTtl,
    });
}
/** PATCH /auth/settings {sessionTtl}：改登录超时（仅 admin；非法值 → 400 invalid_ttl）。 */
async function handlePatch(deps, req, res) {
    const admin = await requireAdmin(deps, req, res);
    if (admin === undefined)
        return;
    const body = await readJsonOrRespond(req, res);
    if (body === undefined)
        return;
    const ttl = body["sessionTtl"];
    if (typeof ttl !== "number" ||
        !Number.isInteger(ttl) ||
        ttl < MIN_SESSION_TTL ||
        ttl > MAX_SESSION_TTL) {
        sendCode(res, 400, "invalid_ttl");
        return;
    }
    try {
        await deps.writeSettings({ sessionTtl: ttl });
    }
    catch (error) {
        deps.logger.error(`settings store write failed (${deps.settingsPath}): ${errorMessage(error)}`);
        sendCode(res, 503, "settings_store_unavailable");
        return;
    }
    deps.logger.info(`session TTL updated to ${ttl}s via /auth/settings`);
    sendJson(res, 200, { sessionTtl: ttl, defaultTtl: deps.defaultTtl });
}
async function loadSettingsOr503(deps, res) {
    try {
        return await deps.loadSettings();
    }
    catch (error) {
        deps.logger.error(`settings store unavailable (${deps.settingsPath}): ${errorMessage(error)}`);
        sendCode(res, 503, "settings_store_unavailable");
        return undefined;
    }
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** 由共享的管理 deps + 设置文件路径装配 settings 端点 deps（index.ts 接线用）。 */
export function sessionSettingsDeps(base, settingsPath, defaultTtl) {
    return {
        ...base,
        settingsPath,
        loadSettings: () => loadSettingsFile(settingsPath),
        writeSettings: (settings) => writeSettingsFile(settingsPath, settings),
        defaultTtl,
    };
}
/**
 * 登录超时现读（D16）：settings.yaml 的 sessionTtl 优先，文件缺失/未设置回落插件
 * 配置；读错（语法/schema）记 error 日志并回落配置默认（TTL 非认证边界，不阻断
 * 登录；管理 API 的 GET 会以 503 暴露文件损坏）。
 */
export function makeSessionTtlResolver(settingsPath, fallback, log) {
    return async () => {
        try {
            return (await readSessionTtl(settingsPath)) ?? fallback;
        }
        catch (error) {
            log.error(`settings file unreadable, using configured sessionTtl: ${errorMessage(error)}`);
            return fallback;
        }
    };
}
//# sourceMappingURL=session-settings-endpoints.js.map