# test1 · 点击挖矿

一个纯前端的增量放置网页游戏：点击矿石产出资源，购买设施自动产出，使用两种技能点（矿石 / 转生星尘）进行永久强化。

- 主游戏界面只有一个，技能、设置、转生均以不可拖动的浮层窗口叠加显示
- 支持离线收益（初始 2 小时上限，可通过技能提升至 8 小时）
- 支持云端账号（Supabase 用户名+密码，云存档，换设备续玩）与本地试玩两种模式

## 本地运行

双击 `start.bat`，或在本目录执行：

```bash
py -3 -m http.server 8000
```

然后访问 http://localhost:8000

## 在线访问

已通过 Cloudflare Pages 自动部署，push 到 `main` 分支即自动更新：

https://test1-5sf.pages.dev

## 启用云端账号（可选）

1. 注册免费 [Supabase](https://supabase.com) 项目
2. 在 SQL Editor 中执行 `supabase/schema.sql`
3. 在 Authentication → Providers → Email 中关闭 **Confirm email**
4. 将 Project Settings → API 中的 `Project URL` 与 `anon public key` 填入 `js/config.js`
5. 提交并推送，Cloudflare Pages 会自动重新部署

未配置云端密钥时，游戏自动进入本地试玩模式，进度仅保存在当前浏览器。
