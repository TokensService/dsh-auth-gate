# 登录超时运行期可配（settings.yaml + /auth/settings）（2026-09-15）

## 决定了什么

用户管理设置页新增「登录超时」设置：admin 可在运行期查看并修改会话 TTL。
值存放在与 users.yaml 同目录的新文件 `settings.yaml`（strict zod schema、
原子写 0600，同 writeUsersFile 纪律），经新的 exact 路由 `/auth/settings`
暴露（仅 password 模式：GET 任意会话返回 `{sessionTtl, defaultTtl}`；
PATCH 仅 admin，整型秒 [60, 31536000]，全量写且可自愈损坏文件）。登录路径
每次签发会话时现读该文件，因此修改只影响之后新签发的会话；存量会话按
签发时的 TTL 过期。非 admin 会话在页面上只读当前值；token 模式不注册端点
（页面维持「不可用」提示）。

## 背景

会话 TTL 此前是静态插件配置（`sessionTtl`，默认 604800 秒）。修改它要改
cordis.patch.yml 并重启，对基础设施变更可以接受，对日常策略调整很笨。
用户管理页（2026-09-14）已经给了 admin 一个会话自校验的管理面，登录超时
设置自然落在同一页面。`IssueSessionDeps.sessionTtl` 由静态数值改为按签发
解析：password 模式的接线优先读 settings.yaml，缺失/读错回落配置值
（读错记 error 日志但不阻断登录：TTL 不是认证边界；文件损坏由管理 API 的
503 settings_store_unavailable 暴露给 admin）。

## 考虑过的替代方案

- **只用 cordis 配置覆盖**：否决。需要重启 + shell 访问，与「admin 在浏览器
  里运行期管理」的目标相悖。
- **session storage domain 新增一张表**：否决。domain spec 带版本号，而
  rc 依赖的迁移语义是未知面；设置行的生命周期也不同于单个会话。文件方案
  完全在本仓库掌控内，且有现成的原子写模式可复制。
- **并入 users.yaml 顶层键**：否决。strict version-1 schema 会拒绝新键；
  为一个非用户设置提升用户文件版本，把两件事搅进一次迁移。
- **新 TTL 作用于存量会话（滑动续期或立即重签）**：否决。静默缩短会把人
  踢下线，静默延长又失去收紧超时的意义。「只影响新登录」与页面既有脚注
  （禁用/删除只挡新登录）语义一致。

## 为什么这样选

文件方案零新配置、零新依赖、只加一条小 exact 路由，复用 users.yaml 的
读写纪律（按操作现读、原子写、0600），且每种失败都有明确出口：API 侧
503，登录侧回落配置默认并记 error 日志。写操作仅 admin，D13 权限矩阵不变
（提权仍需 shell）；[1 分钟, 365 天] 的边界加页面整小时输入，挡住误操作
又不引入新概念。
