# 老巢 · darkhq-dashboard

> OpenClaw 多 Bot 舰队的运维控制台，香港黑帮"老巢"主题。部署在腾讯云轻量服务器，通过 `darkhq.indiehacker.fun` 访问。

## 快速开始

```bash
# 本地开发（自动启用 mock 数据，无需任何 OpenClaw 环境）
npm install
npm run dev              # http://localhost:9700

# 服务器部署
NODE_ENV=production npm start
```

## 页面

| 路由 | 江湖叫法 | 说明 |
|---|---|---|
| `/` | **堂口** | 总览 —— KPI + 班底名册（头像 + 当前差事 + 最近一单）+ 日程预览 + 风声预览 + 线路心跳 + Token 用量 |
| `/cron.html` | **日程** | 例牌任务列表 + 4 项状态统计，点击行展开看近 10 次出勤与输出 |
| `/signals.html` | **风声** | 今日风声 + 旧账（近 7 天按日归档），可按源头筛选 |
| `/docs.html` | **卷宗** | 档案（Bot 整理的文档）+ 聊天底（每日会话日志），可按兄弟筛选 |
| `/settings.html` | **设置** | 班底身份、Token 用量、系统信息 |

## 术语速查（仅影响界面，代码字段保持英文）

| 界面 | 代码里 |
|---|---|
| 堂口 | Dashboard |
| 班底 | bot fleet |
| 兄弟 | bot |
| 日程 / 例牌 | cron job |
| 风声 | signal |
| 卷宗 | document |
| 档案 | curated docs (`workspace/docs/`) |
| 聊天底 | session log (`workspace/memory/`) |
| 线路 | gateway |
| 搞掂 / 失手 / 开工中 | success / failed / running |
| 在场 / 开工中 / 失联 | online / running / offline |

详细对接文档见 [`PROJECT.md`](./PROJECT.md)、版本变更见 [`CHANGELOG.md`](./CHANGELOG.md)。

## 关键设计

- **左 rail 悬停展开**：默认 64px 只显示图标，鼠标移上自动展开到 220px 显示中文标签
- **酒红渐变**：整站 body 带暗红径向渐变，线路心跳卡用深红线性渐变做视觉主角
- **本地归档**（简化方案）：Dashboard 自维护 `data/` 目录，不侵入 OpenClaw workspace
  - `data/signals-archive/YYYY-MM-DD.json` — 每次 `/api/signals` 被访问时自动归档当天一份
  - `data/cron-runs/{jobId}/*.json` — OpenClaw 跑完例牌可 POST 回写
- **头像写死**：`public/avatars/bot-{id}.png`，不依赖用户上传
- **Mock 开关**：`MOCK=1` 或非 production 自动启用，完整替换 API 返回
