# test1 项目交接 SOP

> 给开发者（或 AI 助手）的完整交接文档。读完本文件即可接手项目全部工作。
> 最后更新：2026-10-21

---

## 1. 项目概述

增量放置网页游戏「点击挖矿」。点击矿石产出资源 → 购买设施自动产出 → 两种技能点强化 → （预留）转生重置换全局加成。

- 主游戏界面只有一个；技能、设置、转生均为**不可拖动、可关闭**的浮层窗口（点 ×、点遮罩、按 Esc 关闭）
- 云端账号：用户名+密码注册登录，云存档，换设备续玩；无云后端环境自动降级为本地试玩
- 离线收益：初始上限 2 小时，技能「离线延长」每级 +1 小时，上限 8 小时；**按服务器时间结算**，改本地时间无效

## 2. 关键地址

| 项 | 值 |
|---|---|
| 线上地址 | https://test1-5sf.pages.dev （`test1.pages.dev` 被占用，系统自动分配） |
| GitHub 仓库 | https://github.com/coldfox121/test1 （**PUBLIC**，禁止提交任何密钥） |
| 生产分支 | `main`，push 即自动部署（Cloudflare Pages Git 集成） |

## 3. 技术架构（全部 Cloudflare 免费额度，无第三方依赖）

- **Cloudflare Pages**：托管静态页面
- **Pages Functions**：`functions/api/` 提供后端 API，与前端同域
- **Cloudflare D1**（SQLite）：存账号与云存档

Cloudflare 资源（ID 非密钥，但需配合 API Token 才能操作）：
- Account ID: `d581be8903c61299eaa2d551e3a0f56d`（账号邮箱 1059458369@qq.com）
- Pages 项目: `test1`；D1 数据库: `test1-db`（uuid `d0c2fa7f-74e8-4da8-975c-e83a50bc500f`），绑定名 `DB`（production + preview 均已绑定）

安全设计：
- 密码 PBKDF2-SHA256 加盐散列（10 万次迭代），盐每用户独立
- 会话 token 32 字节随机数，数据库只存其 SHA-256 散列，有效期 30 天
- `last_seen` 由服务器写入，防篡改本地时间刷离线收益
- 存档接口必须带 `Authorization: Bearer <token>`，只能读写自己的数据

## 4. 目录结构

```
index.html          登录/注册 + 主游戏界面（单页面）
style.css           全部样式（含 860px 移动端响应式）
js/app.js           全部前端逻辑（IIFE，约千行；游戏数值常量在中部的 BALANCE 区）
functions/
  _shared.js        密码散列、会话、鉴权公共函数（下划线前缀，不会成为路由）
  api/health.js     GET  存活探测，前端用它判断是否有云后端
  api/register.js   POST {username,password} → {token,username}
  api/login.js      POST {username,password} → {token,username}
  api/load.js       GET  → {username,save,last_seen,server_now}
  api/save.js       POST {save} → {ok,server_now}
  api/logout.js     POST → {ok}
d1/schema.sql       D1 表结构（users / sessions 两表 + 一个索引）
start.bat           本地静态服务（python -m http.server 8000）
```

前端存档结构见 `app.js` 的 `newState()`；旧存档兼容走 `migrate()`（新增字段时必须在此补默认值，否则老玩家白屏）。

## 5. 游戏规则现状

- 设施 6 种（矿镐→矿脉核心），价格等比递增，产量指数增长
- 本循环技能（花矿石）：镐头强化（点击）、爆破专精（全产量）、幸运矿工（暴击）、离线延长
- 转生：累计 100 万矿石可转生，星尘公式已实现；**转生按钮与全局技能树当前锁定**，数据字段（stardust、全局技能）已预留
- 数字格式：K/M/B/T 后进 aa/ab…

## 6. 本地开发流程

### 只改玩法/界面（最常用）
双击 `start.bat` → http://localhost:8000 ，无 `/api` 自动进入本地试玩模式，存档在浏览器 localStorage。改完直接刷新测。

### 要测云端功能
```bash
# 首次：初始化本地 D1
npx wrangler d1 execute test1-db --local --file d1/schema.sql
# 启动（前端+Functions+本地 D1 模拟）
npx wrangler pages dev . --d1 DB=test1-db --port 8788
```
注意：`py -m http.server` 只够静态试玩；Functions 必须用 wrangler。

### 发布
```bash
git add -A && git commit -m "说明" && git push
```
Cloudflare 自动部署，旧版本在线直到新版构建成功，零停机。改存档结构时必须先更新 `migrate()` 再发布。

### 开发纪律
- 用专门的测试账号调试（见下），不要动真实玩家存档
- 任何密钥（CF API Token 等）**绝不提交到本仓库**（仓库公开）
- PowerShell 里 curl 传 JSON 必须用 `--data-binary "@文件"`，内联引号会被 PS5 吞掉

## 7. 测试账号（供调试）

- `test01` / `uitest01`，密码均为 `test123456`

## 8. 常用运维操作（Cloudflare API）

需用户提供 API Token（权限：Pages Edit + D1 Edit），Token 只在对话中临时使用，用完建议用户在 dash.cloudflare.com/profile/api-tokens 轮换。

```bash
# 查部署状态
curl -H "Authorization: Bearer <TOKEN>" "https://api.cloudflare.com/client/v4/accounts/<ACCT>/pages/projects/test1/deployments"
# D1 执行 SQL（每次一条语句）
curl -X POST -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  --data-binary '{"sql":"SELECT username,last_seen FROM users"}' \
  "https://api.cloudflare.com/client/v4/accounts/<ACCT>/d1/database/<DB_UUID>/query"
```

重置某玩家存档：`UPDATE users SET save='', last_seen=NULL WHERE username='xxx'`
删测试账号：`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username='xxx'); DELETE FROM users WHERE username='xxx'`（分两条执行）

## 9. 路线图（用户确认的优先级）

1. ✅ 首版：点击、设施、技能、离线收益、云账号
2. ⬜ 转生功能开放 + 星尘全局技能树（接口已预留）
3. ⬜ 绑定自定义域名（需购域名并托管 NS 到 Cloudflare，免费证书自动签发）
4. 候选：排行榜（D1 直接支持）、多存档槽

## 10. 给 AI 助手的续聊指引

用户在任何新设备/新会话中提供本仓库地址时：
1. 先读本文件（SOP.md）与 README.md
2. 游戏规则改动先看 `js/app.js` 的 BALANCE 区与 `newState()`/`migrate()`
3. 涉及云端资源操作向用户索要 CF API Token；涉及推送先确认 git 凭据可用
4. 遵守第 6 节开发纪律
