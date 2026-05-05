# CHANGELOG

所有值得记录的变更都会出现在这里。

## v3.3.1 — 2026-05-05 · 信号数据源去重修复

### 修复
- `/api/signals` 过去会把主源 `dashboard-signals.json` 和兜底 `feed-*.json` 的结果**叠加**，导致同一条信号出现多次
- 归档文件过去会被 `?source=blog` 这类筛选参数污染，导致 `/api/signals/history` 的"旧账"tab 数据残缺

### 改进
- 新策略：**主源优先 + 兜底按 source 补位** —— 主源覆盖了某个 source（如 x/blog）就不再读对应的兜底文件；主源没有的 source（当前是 podcast）才从兜底补
- 归档使用全量合并结果，不受前端筛选参数影响
- PROJECT.md §7.3 重写，明确优先级规则

---

## v3.3.0 — 2026-05-05 · 视觉微调与 Token 口径统一

### 视觉
- 班底卡片**默认状态**加边框 + 微渐变，不再是一整片纯黑
- 卡片 hover 时酒红边框 + 外阴影 + 顶部光带，层次更清晰

### Token 用量
- **口径明确化**：`totalTokens` / `todayTokens` / `statPeriod` / `timezone` 四字段约定
- **新增 bots[] 契约**：`usage.bots[*].todayTokens` 按 bot 拆分，server 会把它 merge 到 `/api/bots` 的响应
- **班底卡片新增「今日 Token」行**，无数据时降级显示 —
- **侧栏 Token 卡加口径说明**（底部小字显示 statPeriod + timezone）
- PROJECT.md §7.6 新增完整契约文档

---

## v3.2.0 — 2026-05-04 · 黑帮主题与视觉升级

### 主题一致化
- 项目定位明确为**"老巢"**香港黑帮主题，全站术语统一（详见 [`README.md`](./README.md) 术语表）
- 导航与页面改名：
  - Dashboard → **堂口**
  - Cron Jobs → **日程**
  - Signal Radar → **风声**
  - Documents → **卷宗**（档案 + 聊天底两个 tab）
  - Settings → **设置**
- 状态词改为江湖味：在场 / 开工中 / 失联、搞掂 / 失手、接通 / 断线、线路正常 / 线路断了
- 保留 bot 既定外号（老大 / 洗脑专家 / 键盘杀手 / 线人 / 跟班）

### 视觉
- **body 酒红渐变**：右上 + 左下两层 radial gradient，整体从红调暗色向纯黑过渡
- **线路心跳卡**带酒红渐变和发光边线，作为侧栏视觉主角
- topbar / rail 毛玻璃化（`backdrop-filter: blur`），让渐变透过来
- 新增 sparkline 迷你折线、Token 堆叠进度条、心跳趋势 pill 等组件

### 首页侧栏重构
- 去掉重复的 Quick Access（已经被左 rail 覆盖）
- 新三卡：**线路心跳**（带实时 sparkline）+ **Token 用量**（迷你堆叠进度条）+ **系统信息**
- 前端每 5 秒 fetch `/health` 测量真实延迟，最多保留 30 个数据点

### 文档
- `PROJECT.md` 全量刷新：新增术语表、UI 组件表、变更说明
- `README.md` 简化为入口页
- 新增本文件 `CHANGELOG.md`
- `package.json` 版本升至 `3.2.0`

---

## v3.1.0 — 2026-05-04

### 新增
- Logo 换为 `avatars/logo.png`，5 张 Bot 头像写死（不再上传）
- 左 rail 支持**悬停展开**（64px → 220px）
- Bot 从列表改回卡片，显示**当前任务 / 最近执行 / 本周任务数**
- 新增 `/docs.html` — 会话日志 + 整理文档双 tab
- 新增 Signal Radar 历史归档 tab
- Cron 任务行点击展开看**近 10 次运行历史**
- `data/` 目录的简化归档机制
- 新增 API：`/api/cron/:jobId/runs`、`/api/signals/history`、`/api/docs`、`/api/docs/:id`

---

## v3.0.0 — 2026-05-04

- Dark Fintech 视觉重构
- Icon rail + 扁平卡片 + Inter 字体
- 深酒红强调色 `#c8323a`
- 本地 mock 机制（`MOCK=1` 或非 production 自动启用）

---

## v2.0.0（之前的版本）

- 赛博朋克风格 dashboard
- 四页布局：主页 / 定时任务 / 创意雷达 / 设置
