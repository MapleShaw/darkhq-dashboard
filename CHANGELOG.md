# CHANGELOG

## Unreleased — 任务流水来源可视化 + 文档校准

### 改进
- 任务流水页新增 OpenClaw Cron 与 DarkHQ 结构化回写的条数、缓存/过期/不可用状态和降级警告。
- 每条记录增加「Cron 原生 / 结构化回写」来源标签，并修正“独立于 cron”的旧文案。

### 文档
- PROJECT 校准 Bot 最近任务事实源、Cron 原生状态接入和结构化回写的可选增强定位。

## v3.3.5 — 2026-08-02 · 卷宗全文搜索 + 文档校准

### 新增
- 卷宗支持在现有白名单边界内搜索标题、分类、标签与正文，不扩大可展示文件范围。
- 搜索结果显示正文命中摘要与关键词高亮，支持成员筛选、分页和一键清除。

### 文档
- README 补齐任务流水、微读、省流、健康等现有页面，并说明可选鉴权。
- PROJECT 校准 ZenMux 用量、卷宗分层、鉴权和全文搜索的实际状态。

## v3.3.4 — 2026-05-16 · 布局修复 + 登录鉴权 + 移动端导航 + Token 说明

### 修复
- **卷宗分页布局**（`docs.html` + `style.css`）：`#pagination-bar` 原本被动态插入到 `.doc-layout` grid 容器成为第三格，挤开 doc-viewer。改为：
  - HTML 结构重组：`<aside class="doc-list" id="doc-list-wrap">` 内嵌 `.doc-list-inner`（可滚动列表区）和 `#pagination-bar`（固定在底部）
  - `renderPagination()` 改为直接 `getElementById('pagination-bar').innerHTML`，不再动态插入 DOM
  - `.doc-list` 改为 `flex` 列布局，`.doc-list-inner` 有 `flex:1; overflow-y:auto`，分页栏 `flex-shrink:0`

### 新增
- **页面登录鉴权**（`server.js` + `public/login.html`）：
  - 新增 `GET /auth/login`、`POST /auth/login`、`GET /auth/logout` 路由
  - 新增 `public/login.html`：暗色酒红风格极简密码登录页
  - 静态资源鉴权中间件：在 `express.static` 之前插入，检查 `dh_session` HttpOnly cookie
  - `/auth/*` 和 `/avatars/logo.png` 白名单免鉴权（login 页资源）
  - **若 `DASHBOARD_TOKEN` 未设置，跳过所有鉴权（向后兼容）**
  - 各页面 topbar 加「登出」链接
  - Cookie 有效期 7 天，手动解析（无额外依赖）
- **移动端底部导航**（`rail.js` + `style.css`）：`@media (max-width: 640px)` 时 rail 隐藏，改为底部固定 tab bar
  - 5 个 tab：🏴 堂口 / 📅 日程 / 📡 风声 / 📂 卷宗 / ⚙️ 设置
  - `rail.js` 渲染完 rail 后自动追加 `.bottom-nav` 到 body
  - 激活状态根据当前页面 URL 自动判断
  - 底部安全区适配（`env(safe-area-inset-bottom)`），`.page` 加 `padding-bottom` 防遮挡

### 改进
- **班底今日 Token 说明**（`app.js`）：`todayTokens == null` 时改为 `— 暂无数据`（小字）并加 `title` tooltip 说明原因（ZenMux API 无 per-agent 统计）

---

## v3.3.3 — 2026-05-16 · totalTokens + latestDay + API 鉴权

### 新增
- `/api/usage` 新增 `totalTokens`（周期总 token 数，单位：实际 tokens）和 `latestDay`（最近计费日的花费 + token 数）
  - ZenMux timeseries `metric=tokens` 接口，单位换算：`raw / 1000 = 实际 token 数`
  - `latestDay` 包含 `date`、`costUSD`、`tokens`、`note`（说明延迟原因）
  - ZenMux 今日数据约延迟 1 天，`latestDay` 为 series 最后一个 bucket，并有注释说明
- `fetchZenMuxUsage()` 内部重构：`getPeriodRange()`、`getSeries()`、`extractLatestDay()` 抽出复用，`fetchTrend()` 同步改用新函数，消除重复代码
- **API 鉴权中间件**（`server.js`）：所有 `/api/*` 路由统一校验
  - 环境变量 `DASHBOARD_TOKEN` 未设置时跳过鉴权（向后兼容）
  - 设置后支持 `Authorization: Bearer <token>` 和 `?token=xxx` 两种方式
  - `/health` 不受影响（不走 /api 前缀）
  - `.env` 已加注释提示行

### 前端（settings.html）
- 用量面板顶部新增 3 张 summary 卡片：周期总花费、周期总 Token（M 级显示）、最近计费日（含日期 + token 数 + ⓘ 说明）
- 新增 `.usage-summary` / `.usage-stat` / `.usage-stat-label` / `.usage-stat-value` / `.usage-stat-sub` 样式

### 说明
- ZenMux API 无 per-agent 维度，`bots[]` 仍为空数组，班底卡今日 Token 继续显示 `—`（已在 PROJECT.md §7.6 注明）

---

所有值得记录的变更都会出现在这里。

## v3.3.2 — 2026-05-05 · Token 对接 + 大文件保护 + 交互细节

### 修复
- `/api/usage` 线上拿不到数据时，过去会返回硬编码假数据（`totalTokens: 284500`，永远对不上），导致用户误以为已对接。现在改为返回 `{ ok: true, notConnected: true, reason }`，UI 明确显示"⚠ Gateway 未对接"，并给出对接指引链接
- 日程展开后详情内部**左侧无留白**，紧贴父卡片边缘；现在加了 `padding-left: 1.6rem` + 酒红色的左侧细线，视觉上更像"嵌在父行里"的子区域
- 日程展开区点击任意位置会**冒泡到行头触发收起**（选中文字、复制 cron 表达式、点历史条目都会误触）；给 `.cron-row-detail` 加 `stopPropagation`，详情区吞掉 click 事件
- 卷宗里打开大文件（如 300KB+ 的 `ideas.md`）会**一直转圈**——原因是朴素 markdown 渲染里的 table/列表正则在大文本上回溯爆炸。现在加了分级保护：
  - 文件 > 150KB → 切换纯文本模式 + 警告
  - 文件 > 500KB → 截断到前 300KB + 警告"去服务器看完整原文"

### 改进
- `/api/signals/history` 增加 **id 去重**（防御旧脏数据）+ **今日实时拼进去**（不再依赖当天必须访问过 `/api/signals` 才有归档）
- 抽出 `liveSignalsAll()` 共用函数，`/api/signals` 和 `/api/signals/history` 复用同一套"主源 + 兜底"逻辑

### 新增
- `scripts/cron-wrapper.sh` —— 给 OpenClaw 那边用的 cron 包装器，自动把任务运行记录回写到 dashboard，crontab 里原命令前加一层调用即可
- PROJECT.md §7.6 重写：**明确标注 gateway 未实现**，加了诊断步骤 + gateway 侧实现指引（SQLite / JSONL / 厂商账单 API 三种方案）
- PROJECT.md §7.7 新增：**memory/ 目录命名与大小建议**，针对当前命名混乱 + 累积型笔记过大的问题，给 OpenClaw 那边提出整顿方案
- PROJECT.md §7.2 重写：推荐用 `cron-wrapper.sh`，手动 curl 作为次选

---

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
