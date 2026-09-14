# /auth/status 透出登录用户名，token 模式恒 null

## 决定了什么

`GET /auth/status` 响应新增 `username` 字段：password 模式为会话 subject（即登录
用户名），未登录为 `null`；token 模式恒为 `null`。client 半边在设置页「退出登录」
按钮上方显示该用户名（复用同一个 status 探针，token 模式不渲染该行）。

## 背景

dsh web 需要显示当前登录用户名，而插件只暴露了 authenticated 布尔位。会话行的
subject 在 password 模式就是用户名（P14），token 模式恒为审计占位 "token"。
约束：响应必须是纯增量（旧 client 只读 authenticated/logoutOrder）；不新增路由面；
username 不得伪造出「看起来像用户」的值。

## 考虑过的替代方案

- **新增 `/auth/whoami` 端点** - 与 status 重复会话查找，多一个路由/disposer 面；
  client 要多发一次请求。
- **token 模式返回 subject（"token"）** - UI 会把审计占位符显示成用户名，误导；
  调用方还得特判隐藏。
- **username 缺省而非 null** - 三种状态（未登录/token 模式/有用户名）无法用类型
  区分，消费方要同时看 authenticated。

## 为什么这样选

增量字段零破坏：status 探针本就由 client 挂载时 fetch，用户名同帧到达、零额外
请求；`string | null` 三态自描述（null = 无可显示身份），token 模式返回 null 是
诚实语义而非占位符泄漏。
