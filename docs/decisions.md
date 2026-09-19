# Decisions

本插件重大决策的编号索引。每条记录按状态放在
[`docs/decisions/{proposed,implemented,archived}/`](decisions/) 下，双语（`.zh.md`/`.en.md`）
成对；本页只有一句话摘要 + 链接，细节与取舍看记录本身。约定见
[`docs/decisions/README.md`](decisions/README.md)。

> 注：M1–M3 的冻结决策表（D1–D16 / M1–M22 / P1–P26）是阶段执行契约，仍以
> `docs/implemented/impl-mN.md` 为准；本索引从 2026-08-30 起收录「为什么层」记录，已实施的
> 重大决策按精选策略回填登记。

## D1. 认证门失败即关闭（fail-closed）

守卫在凭证无法确认时恒 deny（服务缺失、解析失败均按无凭证处理），失败在日志中响亮。
**替代方案**：服务缺失时放行（fail-open）；服务就绪后才挂门。**为什么**：误锁可人工解开，
误放无法追回。
→ [zh](decisions/implemented/2026-08-30-fail-closed-auth-gate.zh.md) ·
[en](decisions/implemented/2026-08-30-fail-closed-auth-gate.en.md)（回填自 M2/M3）

## D2. 守卫包装 webServer，不 fork

插件内包装 webServer 四类入口 + 启动自检（fail loud），不改 dsh web 宿主。
**替代方案**：fork dsh-web-app；靠路由注册顺序；不做自检。**为什么**：包装是最小侵入面，
自检把「静默未挂门」变成「启动即失败」。
→ [zh](decisions/implemented/2026-08-30-guard-wrap-seam.zh.md) ·
[en](decisions/implemented/2026-08-30-guard-wrap-seam.en.md)（回填自 M1）

## D3. scrypt 参数随哈希存储，验证按存储值重派生

`node:crypto` scrypt + 参数随哈希存储，升级参数不使存量哈希失效，验证侧恒时比较。
**替代方案**：bcrypt/argon2（引进依赖）；只认当前模块常量（升级即全员失效）。
**为什么**：免依赖 + 加固成为滚动变更。
→ [zh](decisions/implemented/2026-08-30-scrypt-portable-params.zh.md) ·
[en](decisions/implemented/2026-08-30-scrypt-portable-params.en.md)（回填自 M3）

## D4. 退出按钮槽位 order 可配置

`logoutOrder` 配置项（默认 1000），经 `/auth/status` 透传 client 半边。
**替代方案**：固定常量；运行时自动探测最大 order。**为什么**：显式旋钮比探测更可预期。
→ [zh](decisions/implemented/2026-08-30-configurable-logout-order.zh.md) ·
[en](decisions/implemented/2026-08-30-configurable-logout-order.en.md)（回填自 v0.10.0）

## D5. src 分层 + 跨 slice 只走 barrel

`gate/`/`session/` 核心机制层 + `features/{token,password,proxy}` + `shared/` 叶子层，
跨 slice 唯一 barrel 入口，feature 同层互禁；verify 链新增 slice/bundle/no-emdash/build 门禁。
**替代方案**：完整 FSD；保持平铺；session 作 feature slice（执行中被边界检查否决，降层）；
轻量 ADR 制度（被官方实践否决）。**为什么**：层匹配依赖图，机器约束防回潮。
→ [zh](decisions/implemented/2026-08-30-layered-src-with-barrels.zh.md) ·
[en](decisions/implemented/2026-08-30-layered-src-with-barrels.en.md)（2026-08-30 实施）

## D6. TOTP 两段式登录采用无状态挑战 cookie

密码通过后发短 TTL 挑战 cookie（无服务端状态），验证码通过才发正式会话并同帧清零。
**替代方案**：内存 pending 会话；挑战页重提交密码；签名挑战令牌。**为什么**：
中间态压成浏览器状态，服务端零存储、重启无感，安全边界仍在验证码本身。
→ [zh](decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-two-stage-challenge-cookie.en.md)

## D7. TOTP 三态配置，默认 off

`totp: "off" | "optional" | "required"`，默认 `"off"`（升级零惊扰）。
**替代方案**：布尔开关；默认 optional；仅按用户手工开挖。**为什么**：三态覆盖
升级兼容、渐进启用、强制基线三种场景。
→ [zh](decisions/implemented/2026-08-30-totp-config-off-by-default.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-config-off-by-default.en.md)

## D8. M3 遗留评估项维持不实施

revokeBySubject / 登录 CSRF token / 限速与防重放持久化，M4 再评估后全部**维持不做**
（各留 TODO(auth-m5)）。**替代方案**：gate 路径现读用户文件；新增 CSRF token；
状态落盘。**为什么**：收益在单门模型下边际递减，现状与局限均已文档化，
「评估后明确不做」即是 M3 契约要求的收尾。
→ [zh](decisions/implemented/2026-08-30-totp-disposition-of-m3-leftovers.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-disposition-of-m3-leftovers.en.md)

## D9. TOTP 独立 slice，能力经根装配注入 password

`features/totp/` 与 token/password/proxy 并列；password 不 import totp，由 index.ts
把 verifyTotp/replayCheck/clock 注入 deps。**替代方案**：TOTP 放 shared；
直接同层互引；全写进 password。**为什么**：保持依赖图清晰 + slice:check 守护，
注入复用 M3 既有模式。
→ [zh](decisions/implemented/2026-08-30-totp-slice-and-injection.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-slice-and-injection.en.md)

## D10. TOTP 挑战 cookie 加 HMAC 签名（取代 D6 的「不签名」）

挑战 cookie 值加第三段 MAC（HMAC-SHA256，进程级随机密钥，无新配置/依赖）：伪造 cookie
不再能跳过密码阶段。D6 的其余决定（无状态、TTL 300s、SameSite=Lax）不变；代价是重启/
插件重载后在途挑战失效（≤5 分钟，README 已写明）。**替代方案**：维持不签名只文档化；
服务端 pending 挑战。**为什么**：「跳过密码」把 TOTP 从第二因素降成唯一因素，单门公网
不可接受；进程级 HMAC 与内存限速/防重放同一寿命模型。
→ [zh](decisions/implemented/2026-08-30-totp-signed-challenge-cookie.zh.md) ·
[en](decisions/implemented/2026-08-30-totp-signed-challenge-cookie.en.md)

## D11. /auth/status 透出登录用户名，token 模式恒 null

`GET /auth/status` 新增 `username` 字段（password 模式 = 会话 subject，token 模式恒 null），
client 在设置页退出按钮上方复用同一探针显示。**替代方案**：新增 /auth/whoami 端点；
token 模式返回 subject 占位符。**为什么**：增量字段零破坏、零额外请求，null 三态诚实。
→ [zh](decisions/implemented/2026-09-11-auth-status-username.zh.md) ·
[en](decisions/implemented/2026-09-11-auth-status-username.en.md)

## D12. 用户管理走设置页 + 会话自校验的 /auth/users API

设置面板新增「用户管理」整页（`settings.section`），API 留在 `/auth` 白名单内自做
会话校验；JSON-only 变更 + 自我/最后启用保护。**替代方案**：dsh RPC 通道（特权方法
loopback-only）；端点挂 `/auth` 外让门守卫；section order 可配置。**为什么**：
零上游耦合、零新依赖、零新配置，CSRF 与误操作各有收口。
→ [zh](decisions/implemented/2026-09-14-user-management-settings-page.zh.md) ·
[en](decisions/implemented/2026-09-14-user-management-settings-page.en.md)

## D13. 用户管理引入 admin 角色与权限矩阵

`users.yaml` 记录新增可选 `role: "admin"`；GET 任意会话可读，POST/DELETE 仅
admin，PATCH 非 admin 只能改自己的密码（其余 → `403 forbidden`）；用户名是主键
不可改；角色授予/回收只走 CLI。页面按角色降级 UI，API 恒为权威。**替代方案**：
首用户即 admin / 配置名单；API 开放角色授予；非 admin 不可见列表；last_admin
保护。**为什么**：角色随记录原子写零额外数据源，提权必须经过 shell，web 面
爆炸半径钉死在 admin 自己的会话。
→ [zh](decisions/implemented/2026-09-14-user-admin-role.zh.md) ·
[en](decisions/implemented/2026-09-14-user-admin-role.en.md)

## D14. txt 批量导入用户：本地/服务端双模式 + 固定 imports/ 沙箱

`POST /auth/users/import` 收 `{text}`（浏览器读本地文件原文）或 `{file}`
（服务端 `<usersDir>/imports/` 内 `.txt`，basename 白名单防遍历）；逐行
`用户名,密码`，全量校验、行号明细、all-or-nothing 原子写；仅 admin；
256 KiB/100 条上限。**替代方案**：任意路径输入（任意文件读；D15 起放开
并取代沙箱）；multipart 上传；best-effort 逐条跳过；txt 带 role 列；
客户端预解析。**为什么**：本地模式零文件系统暴露，服务端模式用固定目录
换便利，失败可机读可重传。
→ [zh](decisions/implemented/2026-09-14-txt-batch-user-import.zh.md) ·
[en](decisions/implemented/2026-09-14-txt-batch-user-import.en.md)

## D15. 批量导入改用任意服务器绝对路径（修订 D14）

`POST /auth/users/import` 服务端来源改为 `{path}`（服务器上任意绝对路径的
`.txt`），D14 的 imports/ 沙箱（`{file}` + GET 列举）一并移除；非绝对路径/
含 NUL/非 `.txt` 一律 404，256 KiB 封顶，审计日志记录路径；页面只留
「本地文件 / 服务器路径」。**替代方案**：沙箱与 {path} 并存；文件系统浏览器；
放开任意后缀；非法形态返回 400。**为什么**：owner 接受「admin 可读任意
.txt」后，{path} 以最少入口覆盖全部服务端导入场景，端点与页面同步收窄。
→ [zh](decisions/implemented/2026-09-14-server-path-import.zh.md) ·
[en](decisions/implemented/2026-09-14-server-path-import.en.md)

## D16. 登录超时运行期可配（settings.yaml + /auth/settings）

用户管理页新增「登录超时」设置：admin 运行期修改会话 TTL，落在与 users.yaml
同目录的 settings.yaml；新 exact 路由 `/auth/settings`（GET 任意会话、
PATCH 仅 admin，整型秒 [60, 31536000]）；登录每次签发现读，只影响新会话。
**替代方案**：cordis 配置覆盖（需重启 + shell）；session domain 新表（迁移
语义未知）；并入 users.yaml（strict schema 需版本迁移）；作用于存量会话。
**为什么**：复用 users.yaml 原子写文件模式，零新配置零新依赖，失败出口明确，
权限矩阵不变。
→ [zh](decisions/implemented/2026-09-15-login-timeout-setting.zh.md) ·
[en](decisions/implemented/2026-09-15-login-timeout-setting.en.md)

## D17. 默认会话永不过期，有限会话由浏览器按绝对时间退出

`sessionTtl` 默认改为 `0`（永不过期），设置页仍可选择有限时长；`/auth/status`
透出有限会话的 `expiresAt`，client 按绝对时间定时跳回登录页，并保留探测兜底。
**替代方案**：继续默认 7 天；只靠 30 秒轮询；复用 `0` 秒 Cookie 语义。
**为什么**：默认符合长期登录诉求，绝对定时器修复 SPA 到期后停留，同时不把
网络抖动当登出；应用层哨兵与 Cookie 删除语义分离，手工登出仍可靠。
→ [zh](decisions/implemented/2026-09-19-never-expiring-session-default.zh.md) ·
[en](decisions/implemented/2026-09-19-never-expiring-session-default.en.md)
