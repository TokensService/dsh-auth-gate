# 用户管理页开放 admin 角色管理（2026-10-14）

## 决定了什么

`PATCH /auth/users` 接受 `admin: boolean`（仅 admin）：授予即在目标记录写入
`role: "admin"`，回收按逐字段重建记录的方式移除该字段（与 TOTP disable 同
纪律）。对自己 `admin: false` 返回 `409 self_target`（与自我禁用同款的防误
操作护栏；CLI 仍是逃生通道）。携带 `admin` 字段的非 admin 会话一律
`403 forbidden`（「仅自己密码」规则对 `disabled`/`totp`/`admin` 同等拒绝）。
用户管理页每行新增授予/回收按钮（自己一行禁用，与禁用/删除一致）。角色变更
对目标的在途会话立即生效：角色每次请求都按记录判定，被降权 admin 的会话
即刻降级为非 admin（fail-closed，与被删 admin 行互为镜像）。POST 新建与 txt
导入仍只造普通用户——提拔保持为单独的显式 PATCH 动作。本条修订 D13/D-UM-7
（角色仅 CLI 管理）。

## 背景

owner 要求 2026-10-14：admin 必须能在用户管理页把其他用户配置为 admin。
D13 当年刻意把角色变更钉在 CLI，让 web 面造不出管理员；实践中团队有多个
admin 并行，每次授予/回收都要 shell 成了瓶颈。owner 接受由此放宽的爆炸半径
（admin 会话现在能造新管理员），换取角色管理自助化。

## 考虑过的替代方案

- **维持角色仅 CLI**——否决：不满足提出的需求；多 admin 部署下 shell 边界
  的成本高于其保护价值。
- **页面允许自我降权**——否决：与自我禁用/删除同款脚下枪形态（D-UM-3）；
  确有需要的 admin 走 CLI 逃生通道。
- **独立 `POST /auth/users/role` 端点**——否决：新 exact 路由会重复 PATCH
  已有的会话/admin 门；在既有变更上加一个字段能让权限矩阵保持单点。

## 为什么这样选

复用 PATCH 变更让所有写路径收敛在同一权威点（`handleUserUpdate` 的 admin
门）与同一条审计日志（`user <name> updated via /auth/users`）。自我目标护栏
保住了 D13 的「API 路径不可能删光所有 admin」不变量，且无需单独的「最后
admin」计数器：自我降权是唯一可能归零的路径，而它已被拦截。
