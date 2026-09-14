# 用户管理引入 admin 角色与权限矩阵（2026-09-14）

## 决定了什么

`users.yaml` 记录新增可选字段 `role: "admin"`（缺省 = 普通用户；strict schema
只认字面量 `admin`）。`/auth/users` 的权限矩阵：GET 列表任意会话可读；
POST/DELETE 仅 admin；PATCH 中 admin 可改任意用户，非 admin 只能改自己的
密码（目标非己或带 `disabled`/`totp` 字段 → `403 forbidden`）。用户名是主键，
任何角色都不能经 API/页面改名。角色授予/回收只走 CLI
（`dsh-auth user add --admin` / `dsh-auth user admin <enable|disable> <name>`），
API 不开放角色变更。设置页按 `users[].admin` + `current` 降级 UI（非 admin
看不到添加表单与他人行的操作按钮），但 API 才是权威。

## 背景

用户管理页（D12）上线时沿用了单门模型的隐含假设：「能登录 = 能管理用户」。
任何持有有效会话的用户都能增删改全部用户，包括把别人禁用、重置他人 TOTP。
用户要求收敛：只有 admin 能添加用户、改他人密码；非 admin 只能改自己的密码，
且不能改自己的用户名。存量 `users.yaml` 没有角色概念，升级后必须有一条
明确的 bootstrap 路径（否则页面管理功能对所有人锁死）。

## 考虑过的替代方案

- **首个用户即 admin / 配置里列 admin 名单**——否决：隐式规则会随用户增删
  漂移（删了第一个用户权限就变），配置与 users.yaml 双数据源会出现不一致；
  记录内字段随原子写天然一致。
- **API 也开放角色变更（admin 可授 admin）**——否决：web 面能造管理员就把
  「shell 才能提权」的边界打破了；当前需求只要求收敛权限，不要求 web 授权。
- **非 admin 连列表都不可见**——否决：页面需要自己的行来提供自助改密；
  用户名/状态本就不是秘密（登录页面对所有人开放），且原需求只约束变更。
- **保留 last_enabled 之外再加 last_admin 保护**——否决：自我禁用/删除已被
  self_target 挡住，操作者本人必是 admin，API 路径不可能删光 admin；CLI 始终
  是逃生通道。

## 为什么这样选

角色落在记录内（与密码哈希、TOTP secret 同一原子写），权限判定零额外数据源；
CLI 独占角色管理让提权必须经过 shell，web 面的爆炸半径被钉死在「admin 自己的
会话」。fail-closed 细节：被删除 admin 的在途会话因记录消失自动失去管理权
（D8 的不吊销语义只保留登录态，不保留权限）。UI 降级只是体验层，403 由服务端
恒强制。
