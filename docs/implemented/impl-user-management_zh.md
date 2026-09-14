# 用户管理设置页 + `/auth/users` API（实施规格）

> **Status**: implemented
> **Scope**: 独立于里程碑的切片，建立在 M3（password 模式）+ M4（TOTP）之上；仅 password 模式
> **Source**: 用户要求 2026-09-14（「在 dsh 设置中添加一个页面，支持添加、编辑、删除用户，查看用户状态」）

## 1. 背景

用户管理（`users.yaml`）过去必须有 shell 访问权：`dsh-auth user` CLI
（add/list/disable/totp）是唯一入口，而 dsh RPC 通道帮不上忙——其特权方法被
钉在 loopback（`PRIVILEGED_METHODS`），公网部署下 `settings.*` 无论是否认证
都是 403。与此同时，本插件已经握有同源且自动携带会话的通道（`/auth/*`）和
一个能往 dsh 设置面板挂 UI 的 client 半边。本切片在设置面板里新增**用户管理
页**（`settings.section` 槽），由一个新的会话自校验 JSON API 支撑，让已登录
管理员在浏览器里完成用户的列出、添加、改密、禁用/启用、TOTP 启停和删除。

## 2. 行为契约

| 场景                                        | 行为                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 无有效会话的任何调用                        | `401 {"error":"unauthorized"}`（会话 cookie 或 Bearer 会话 token；端点自校验）                                                                 |
| 会话存储不可用                              | `503 {"error":"store_unavailable"}`                                                                                                            |
| `GET /auth/users`                           | `200 {"users":[{username,disabled,totp,admin,current}]}`，按用户名字典序，绝不含哈希/secret；任意会话可读                                      |
| `POST` 新用户（仅 admin）                   | 校验用户名（`USERNAME_RE`）+ 非空密码 → scrypt 哈希 → 原子重写；`201` + 用户视图                                                               |
| `POST`/`DELETE` 非 admin 会话               | `403 forbidden`（D13：用户管理仅管理员）                                                                                                       |
| `PATCH` 非 admin 会话                       | 仅允许改**自己的密码**；目标非己或带 `disabled`/`totp` 字段 → `403 forbidden`                                                                  |
| `POST` 重名/非法用户名/空密码               | `409 duplicate` / `400 invalid_username` / `400 empty_password`                                                                                |
| `PATCH` 改密码                              | 新 salt 重哈希；旧密码立即失效                                                                                                                 |
| 用户名变更                                  | 不支持：用户名即主键，任何角色都不能经 API/页面改名（只能删除后重建）                                                                          |
| `PATCH disabled:true` 针对自己              | `409 self_target`（防误操作；CLI 仍是逃生通道）                                                                                                |
| `PATCH disabled:true`/`DELETE` 最后启用用户 | `409 last_enabled`（防锁死：至少保留一个启用用户）                                                                                             |
| `PATCH totp:"enable"`                       | 生成 secret 并落盘，响应**一次性**返回 `{totpSecret,totpUri}`（已有 secret → 409 `totp_exists`）                                               |
| `PATCH totp:"disable"`                      | 移除 secret（幂等，保留 role）                                                                                                                 |
| `DELETE` 用户（仅 admin）                   | 从 `users.yaml` 移除；`200 {"deleted":name}`；自我删除 → `409 self_target`                                                                     |
| 变更请求体非 JSON                           | `415 unsupported_media_type`（表单无法伪造 JSON content-type；SameSite=Lax 之上的 CSRF 层）                                                    |
| 请求体 > 16 KiB / JSON 非法                 | `413 body_too_large` / `400 bad_json`                                                                                                          |
| 被禁用/删除用户的在途会话                   | 会话在过期前仍有效（D8：明确不实现 `revokeBySubject`；页面上有脚注说明）；角色随记录判定——被删除 admin 的在途会话自动失去管理权（fail-closed） |
| token 模式                                  | 端点不注册 → 落 `/auth` 兜底 `404`；设置页显示「不可用」提示                                                                                   |
| users.yaml 读写失败                         | `503 user_store_unavailable` + error 日志                                                                                                      |

fail-closed 范围：端点位于 `/auth` 门白名单内，因此自行重做会话校验（cookie
优先、Bearer 会话 token 兜底——与门同一个会话模型）。所有错误响应都是带稳定
机器码的 JSON；client 按码本地化，绝不依赖英文文案。

## 3. 冻结设计决策

- **D-UM-1**：API 是 exact 路由 `/auth/users`，内部按 method 分发
  （GET/POST/PATCH/DELETE），与既有 auth 端点一致（webServer 无 method 路由）。
- **D-UM-2**：变更只收 `application/json`（SameSite=Lax 之上的 CSRF 加固）；
  请求体上限 16 KiB，与 urlencoded 解析（M10）同量级。
- **D-UM-3**：服务端强制执行保护——禁止自我禁用/自我删除、禁止移除最后一个
  启用用户。页面对当前用户额外禁用这些按钮，但 API 才是权威。
- **D-UM-4**：TOTP 能力由 `index.ts` 注入（`generateTotpSecret`/`totpUri`
  来自 `features/totp`）——D9 装配模式（feature 同层互禁）。
- **D-UM-5**：`revokeBySubject` 维持不实现（D8）；页面脚注说明禁用/删除只
  阻止新登录。
- **D-UM-6**：页面是一整个 `settings.section`（id `auth-users`，order 30：
  在内置页 general 0 / models 10 / plugins 15 / agent-presets 20 之后、
  第三方页（如 better-sidebar 100）之前）；固定常量、不加配置旋钮（D4 的
  动机是真实碰撞风险，section 区段稀疏，不适用）。文案挂 `auth` 词典域
  （zh/en），错误键为 `users.error.<code>`。
- **D-UM-7**（D13）：`users.yaml` 记录新增可选 `role: "admin"`（缺省=普通
  用户；zod strict schema 只认字面量 `admin`）。角色只能经 CLI 授予/回收
  （`dsh-auth user add --admin` / `dsh-auth user admin <enable|disable> <name>`），
  API 不开放角色变更——web 面永远造不出新管理员，提权必须走 shell。
- **D-UM-8**（D13）：权限矩阵——GET 任意会话可读；POST/DELETE 仅 admin；
  PATCH 中 admin 可改任意用户，非 admin 只能改自己的密码（其余目标/字段 →
  `403 forbidden`）。页面按 `users[].admin` + `current` 降级 UI（藏添加表单
  与他人行的操作按钮），但 API 才是权威；所有写路径重建记录时必须保留
  `role`（TOTP disable 曾逐字段重建，已修）。

## 4. 部署说明

- 零新增配置；password 模式自动挂载端点，token 模式完全不注册。
- 无新增依赖；`users.yaml` 新增**向后兼容的可选字段** `role`（旧文件全部
  用户视为普通用户）。CLI 与 API 操作同一文件、同一原子写（`writeUsersFile`）。
- **升级迁移**：升级到含 D13 的版本后，存量用户都不是 admin，页面管理操作
  全部 403——先经 CLI 授予：`dsh-auth user admin enable <name>`（或
  `dsh-auth user add <name> --password-stdin --admin` 新建管理员）。
  `dsh-auth user list` 会以 `(admin)` / `(admin, disabled)` 标记角色。
- 页面启用 TOTP 时，base32 secret + otpauth URI 只在响应里出现一次，管理员
  手动录入认证器（不出二维码图，保持 bundle 自包含）。
- 审计：增/改/删写 `user <name> added|updated|deleted via /auth/users` info
  日志；secret/哈希永不落日志。

## 5. 测试

- 单测：`src/features/password/user-admin-endpoints.test.ts`（认证矩阵、
  Bearer 兜底、405、列表（含 admin 标记/非 admin 视角）、新增 + 400/409/415、
  非 admin POST 403）与 `user-admin-endpoints.update.test.ts`（改密往返、
  禁用/启用、自我/最后启用保护、TOTP 启停、删除、非 admin 权限矩阵：仅自己
  的密码可改/其余 403/被删 admin 在途会话降级）。共享基座：
  `test/user-admin-harness.ts`（临时目录真实 `users.yaml` 往返 + 内存会话表）。
- 集成：`src/integration.users.test.ts`——真实栈（storage-json +
  storage-domain + WebServer + 插件）：未认证 401、带 `current`/`admin` 标记的
  列表、创建后真实登录、重名 409、自我目标 409、删除持久化、405/415、非 admin
  会话 403 矩阵 + 自助改密后真实重登录。
- client：`src/client/users-section.test.tsx`（三态 + 变更 + TOTP 展示 +
  非 admin 降级 UI）；`src/client/logout-action.test.tsx` 扩展覆盖 section
  注册与合并词典。
- CLI/文件：`src/cli.test.ts`（`--admin`、`user admin enable/disable`、list
  角色标记）与 `src/shared/users-file.test.ts`（role 解析/拒绝非法值/写读往返）。

## 6. 变更记录

| commit       | 内容                                                            |
| ------------ | --------------------------------------------------------------- |
| 5508640      | feat: 用户管理设置页 + `/auth/users` API                        |
| （本次变更） | feat: admin 角色与权限矩阵（D13），CLI 角色管理，页面按角色降级 |
