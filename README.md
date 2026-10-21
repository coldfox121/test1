# test1 · 点击挖矿

一个纯前端的增量放置网页游戏：点击矿石产出资源，购买设施自动产出，使用两种技能点（矿石 / 转生星尘）进行永久强化。

- 主游戏界面只有一个，技能、设置、转生均以不可拖动的浮层窗口叠加显示
- 支持离线收益（初始 2 小时上限，可通过技能提升至 8 小时，按服务器时间结算）
- 云端账号：用户名+密码注册登录，云存档，换设备续玩；无云后端环境自动降级为本地试玩

## 技术栈

全部运行在 Cloudflare 免费套餐上：

- **Cloudflare Pages**：托管静态页面（`index.html` / `style.css` / `js/`）
- **Pages Functions**：`functions/api/` 提供注册、登录、读档、存档、登出接口
- **Cloudflare D1**：SQLite 数据库，存账号与云存档（表结构见 `d1/schema.sql`）

密码使用 PBKDF2-SHA256（10 万次迭代）加盐散列；会话 token 只存散列，有效期 30 天。

## 本地运行

静态页面（本地试玩模式）：

```bash
py -3 -m http.server 8000
```

完整云端功能（需要 Node.js，首次执行 `npx wrangler d1 execute test1-db --local --file d1/schema.sql` 初始化本地库）：

```bash
npx wrangler pages dev . --d1 DB=test1-db --port 8788
```

## 在线访问

push 到 `main` 分支即自动部署：

https://test1-5sf.pages.dev
