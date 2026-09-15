# 用户管理走设置页 + 会话自校验的 /auth/users API（2026-09-14）

## 决定了什么

在 dsh 设置面板新增「用户管理」页（`settings.section` 槽，id `auth-users`，
order 30），由新的 exact 路由 `GET|POST|PATCH|DELETE /auth/users` 支撑。端点
位于 `/auth` 门白名单内，因此自行校验会话（cookie 或 Bearer 会话 token）。
变更只收 `application/json`。服务端拒绝禁用/删除当前登录用户、拒绝移除最后
一个启用用户。

## 背景

用户管理过去必须有 shell 访问权（`dsh-auth user` CLI）；dsh RPC 通道把特权
方法钉在 loopback，公网部署下浏览器侧没有任何办法操作 `users.yaml`。本插件
已经握有同源且自动携带会话的通道（`/auth/*`）和挂在设置面板里的 client 半
边，不需要上游改动就能自服务一个管理页。

## 考虑过的替代方案

- **走 dsh RPC 通道（`settings.*`/自定义方法）**——否决：特权方法仅
  loopback（`PRIVILEGED_METHODS`），公网部署无论是否认证都是 403。
- **把端点注册在 `/auth` 之外让门来守卫**——否决：门的白名单需要引入新概念
  （公开 auth 路由 vs 需会话 auth 路由）；全部留在 `/auth` 内、端点自做会话
  检查只是一个小 helper，与 `/auth/status` 一致。
- **像 CLI 一样允许自我禁用/自我删除**——否决：UI 是防误操作面，锁死之后
  照样要 SSH（CLI 保留为逃生通道）。
- **实现 `revokeBySubject` 让禁用/删除踢掉在途会话**——否决：D8 已经再评估
  并明确暂缓（`TODO(auth-m5)`）；页面改为把语义写清楚，不重开决策。
- **section order 可配置（仿 D4 `logoutOrder`）**——否决：section 区段稀疏
  （内置 0-20、第三方 ~100），固定 order 30 没有被证明的碰撞风险。

## 为什么这样选

单门模型信任每一个已认证会话，所以任何已登录管理员都可以管理用户；剩下的
风险是 CSRF（用 JSON-only 变更 + SameSite=Lax 回答）和操作失误（用服务端
自我/最后启用保护回答）。复用 `/auth` 通道与 `settings.section` 槽让本次变
更不引入上游耦合、新依赖和新配置。
