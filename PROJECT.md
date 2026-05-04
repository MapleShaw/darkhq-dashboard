# PROJECT.md · 老巢交接文档

> **给 OpenClaw 那端拉代码后让这个 dashboard 跑起来、并把真实数据接进来的人。**
>
> 版本：v3.2（2026-05）
> 仓库：本地 dev → push 到 GitHub → 服务器 pull + restart

---

## 1. 这是什么

一个独立的 Node.js Express 服务，作为 OpenClaw Bot 舰队的可视化控制台。主题是**香港黑帮"老巢"**，界面上大量使用堂口 / 班底 / 日程 / 风声 / 卷宗这类术语 —— 不过这只是 UI 文案，**代码字段全部英文**，对接时按英文字段走就行。

能看到的：
- 5 位 Bot 的当前状态 / 当前差事 / 最近一单
- 全部定时例牌（cron）的运行记录与输出历史
- 内容雷达（博客 / X / 播客）的今日风声和近 7 天旧账
- Bot 整理的档案 + 每日聊天底
- Bot 名称/角色配置 + Token 用量

**不是**什么：
- 不是 OpenClaw 的一部分，是它的下游消费方
- 不修改 OpenClaw workspace，只读 + 在自己的 `data/` 里归档
- 不做 Bot 启停控制，只读展示

---

## 2. 运行拓扑

```
┌──────────────────────────────────────────────────────────────┐
│  腾讯云轻量服务器 (VM-0-5)                                    │
│                                                               │
│  ┌─────────────────┐      ┌──────────────────────────────┐   │
│  │ nginx :80       │ ───▶ │ darkhq-dashboard :9700       │   │
│  │ darkhq.         │      │   Express + static           │   │
│  │ indiehacker.fun │      └────────────┬─────────────────┘   │
│  └─────────────────┘                   │                     │
│                                        │  读文件 / 调 gateway │
│                                        ▼                     │
│                   ┌─────────────────────────────────────┐    │
│                   │ /home/openclaw/.openclaw/           │    │
│                   │   openclaw.json                     │    │
│                   │   workspace/memory/*.md             │    │
│                   │   workspace/content-signal-radar/   │    │
│                   │   workspace/docs/{botId}/*.md (新)  │    │
│                   └─────────────────────────────────────┘    │
│                                                               │
│                   ┌─────────────────────────────────────┐    │
│                   │ OpenClaw gateway :18789             │    │
│                   │   /health  /api/usage (已用)        │    │
│                   │   /api/bots/status  (待 OpenClaw 加)│    │
│                   └─────────────────────────────────────┘    │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ darkhq-dashboard/data/ (Dashboard 自维护，gitignore)  │    │
│  │   signals-archive/YYYY-MM-DD.json                    │    │
│  │   cron-runs/{jobId}/*.json                           │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

- nginx 配置：`nginx-darkhq.conf`（已提交）
- 监听端口：`9700`（可用 `PORT` 覆盖）
- 进程守护：systemd 示例见第 8 节

---

## 3. 术语对照表

**这一节最重要。**界面上的文案是香港黑帮主题，代码里是英文，两边的对应关系：

### 3.1 页面与导航

| 界面（江湖叫法） | 代码 / 路由 | 含义 |
|---|---|---|
| 堂口 | `/` dashboard | 总览 |
| 日程 / 例牌 | `/cron.html` cron | 定时任务 |
| 风声 | `/signals.html` signal | 内容雷达信号 |
| 卷宗 | `/docs.html` docs | 文档管理 |
| ├ 档案 | `type=docs` | Bot 整理的正式文档 |
| └ 聊天底 | `type=memory` | 每日会话日志 |
| 设置 | `/settings.html` settings | |

### 3.2 业务词

| 界面 | 代码字段 |
|---|---|
| 班底 / 兄弟 | `bot` / `bots` |
| 班底规模 | `bots.length` |
| 在场 | `status: 'online'` |
| 开工中 | `status: 'running'` |
| 失联 | `status: 'offline'` |
| 正在开工 | `currentTask: '...'` |
| 最近一单 | `lastTaskName` / `lastTaskStatus` / `lastTaskTime` |
| 本周 N 单 | `weekTasks: N` |
| 线路 | `gateway` |
| 接通 / 断线 | `gatewayOnline: true / false` |
| 搞掂 | `status: 'success'` |
| 失手 | `status: 'failed'` |
| 开工中 | `status: 'running'` |

### 3.3 Bot 外号与 codename（已固定，不要改）

| 外号（UI） | codename（代码） | 角色（UI） | 模型 |
|---|---|---|---|
| 老大 | `main` | 总指挥 | Claude Opus 4.6 |
| 洗脑专家 | `content` | 内容创作 | Claude Opus 4.6 |
| 键盘杀手 | `tech` | 技术运维 | Claude Sonnet 4.6 |
| 线人 | `intel` | 情报收集 | Claude Sonnet 4.6 |
| 跟班 | `assistant` | 杂活 | Ling 2.6 1T |

---

## 4. 目录结构

```
darkhq-dashboard/
├── server.js               # 主服务入口
├── mock-data.js            # 本地 mock 数据（仅 dev 加载）
├── package.json            # v3.2.0
├── README.md               # 入口页
├── PROJECT.md              # 本文件
├── CHANGELOG.md            # 版本变更
├── .gitignore              # 忽略 node_modules / data / bot-settings.json
├── nginx-darkhq.conf       # nginx 反代模板
│
├── public/
│   ├── index.html          # 堂口
│   ├── cron.html           # 日程
│   ├── signals.html        # 风声（今日 + 近 7 日旧账 tab）
│   ├── docs.html           # 卷宗（档案 + 聊天底 tab）
│   ├── settings.html       # 设置
│   ├── style.css           # 全局样式（酒红渐变 + 毛玻璃 + 扁平卡片）
│   ├── rail.js             # 左 rail 动态渲染，4 页共用
│   ├── app.js              # 仅 index.html 业务
│   ├── bot-settings.json   # 用户保存的名称/角色覆盖（gitignore）
│   └── avatars/            # logo.png + bot-{codename}.png × 5
│
└── data/                   # 运行时归档（gitignore，首次启动自动创建）
    ├── signals-archive/YYYY-MM-DD.json
    └── cron-runs/{jobId}/*.json
```

---

## 5. 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `NODE_ENV` | unset | 设 `production` = 生产部署，关闭自动 mock |
| `MOCK` | unset | `1` = 强制启用 mock（调试用） |
| `PORT` | `9700` | 监听端口 |
| `OPENCLAW_ROOT` | `/home/openclaw/.openclaw` | OpenClaw workspace 根 |
| `GATEWAY_URL` | `http://localhost:18789` | OpenClaw gateway 地址 |

**Mock 自动启用规则**（`server.js` 顶部）：

```js
USE_MOCK = process.env.MOCK === '1'
         || (process.env.NODE_ENV !== 'production'
             && !fs.existsSync('/home/openclaw/.openclaw'));
```

服务器必须设 `NODE_ENV=production` 才会走真实数据。

---

## 6. API 清单

所有 API 均 JSON，成功 `{ ok: true, ... }`，失败 `{ ok: false, error: "..." }`。

### 6.1 读接口（Dashboard 提供给前端）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/bots` | 返回 5 个 bot 的元数据 + 运行时状态。⚠️ 线上运行时字段当前是占位，需 OpenClaw 填充（见 §7.1） |
| GET | `/api/cron` | 返回 6 个例牌定义 + 最近一次状态。当 gateway 暴露 `/api/cron/jobs` 时会合并 |
| GET | `/api/cron/:jobId/runs?limit=10` | 从 `data/cron-runs/{jobId}/` 读运行历史 |
| GET | `/api/signals?source=all\|blog\|x\|podcast` | 读 `workspace/content-signal-radar/feed-*.json`，**同时归档一份到 `data/signals-archive/{today}.json`** |
| GET | `/api/signals/history?days=7` | 从 `data/signals-archive/*.json` 读近 N 天 |
| GET | `/api/usage` | Token 用量。调 gateway `/api/usage`，失败用 fallback |
| GET | `/api/docs?type=memory\|docs&bot=xxx` | 文档列表 |
| GET | `/api/docs/:id` | 返回单文档 markdown 原文 |
| GET | `/health` | `{ ok: true, mock: boolean }` — 心跳卡靠这个测延迟 |

### 6.2 写接口（供 OpenClaw 或前端调用）

| 方法 | 路径 | 调用方 | 说明 |
|---|---|---|---|
| POST | `/api/cron/:jobId/runs` | **OpenClaw** | 例牌跑完回写。Body: `{ status, output, startedAt, durationMs }` |
| POST | `/api/settings/bots` | 前端 | 保存 bot 名称/角色到 `public/bot-settings.json`。Body: `{ bots: [{id,name,role}] }` |
| POST | `/api/settings/avatar/:botId` | 前端（可选） | 头像上传。正常用不到，头像已写死 |

---

## 7. OpenClaw 那端要做的对接（核心）

按优先级排，**都不做 dashboard 也能跑**（会显示占位），做了就有真实数据。

### 7.1 ⚠️ Bot 运行时状态

当前 `/api/bots` 在线上只有元数据 + gateway 在线，**以下字段是空的**：

- `status` — `online` / `running` / `offline`
- `currentTask` — 正在执行的任务名（如 "正在整理《选题清单》"）
- `lastTaskName` / `lastTaskTime` / `lastTaskStatus` — 最近一单
- `weekTasks` — 本周任务数

**任选一种对接**：

**方案 A（推荐）：gateway 暴露 `/api/bots/status`**

```http
GET http://localhost:18789/api/bots/status
Authorization: Bearer {token}

Response:
{
  "bots": [
    {
      "id": "main",
      "status": "online",
      "currentTask": null,
      "lastTaskName": "📊 每日简报",
      "lastTaskTime": "2026-05-04T10:05:00Z",
      "lastTaskStatus": "success",
      "weekTasks": 18
    },
    ...
  ]
}
```

然后在 `server.js` 的 `/api/bots` 里合并这份数据即可（几行代码）。

**方案 B：OpenClaw 主动推送**

暴露 `POST /api/bots/status` 接口，OpenClaw 每次状态变化 POST 一次，dashboard 存到 `data/bots-status.json`。

### 7.2 ⚠️ 例牌运行记录

Dashboard 已经暴露 `POST /api/cron/:jobId/runs`。**OpenClaw 在每个 cron 任务 wrapper 里加一行 curl 即可**：

```bash
curl -X POST http://localhost:9700/api/cron/signal-radar/runs \
  -H 'Content-Type: application/json' \
  -d '{
    "status": "success",
    "output": "扫描完成，新增 9 条风声",
    "durationMs": 3200,
    "startedAt": "2026-05-04T15:30:00Z"
  }'
```

Dashboard 自动按 `{jobId}/{timestamp}.json` 归档，读取时返回最新 10 条。**这是最小对接，强烈建议做**。

### 7.3 ✅ Signal Radar（已对接）

Dashboard 直接读 `workspace/content-signal-radar/feed-{blogs,x,podcasts}.json`，不用改 OpenClaw。

归档是**被动**的 —— 每次 `/api/signals` 被访问时自动把当前数据写到 `data/signals-archive/{YYYY-MM-DD}.json`。

**建议**：如果担心没人访问导致漏归档，可以让 OpenClaw 的 signal-radar 任务跑完后加一行：
```bash
curl -s http://localhost:9700/api/signals > /dev/null
```

### 7.4 ✅ 聊天底（会话日志，已对接）

Dashboard 直接读 `workspace/memory/*.md`，按文件名倒序展示。**OpenClaw 继续按现在的方式写入即可，无需改动**。

### 7.5 ⚠️ 档案（整理文档）目录约定

Dashboard 期望的结构：

```
workspace/docs/
├── main/
│   ├── 第18周复盘.md
│   └── ...
├── content/
│   ├── 五月内容选题清单.md
│   └── ...
├── tech/
├── intel/
└── assistant/
```

**规则**：Bot 整理文档时写到 `workspace/docs/{codename}/{可读文件名}.md`。
- 文件名会直接作为文档标题展示 → 起可读的中文名，如 `技术债务清单 Q2.md`
- 会按 bot 在"档案"tab 里分组过滤

这个目录现在还没有，需要 OpenClaw 那端配合建立并约定。

---

## 8. 服务器部署 & 更新

### 8.1 首次部署

```bash
cd /home/openclaw
git clone https://github.com/YOU/darkhq-dashboard.git
cd darkhq-dashboard
npm install --omit=dev

# systemd 托管
sudo tee /etc/systemd/system/darkhq-dashboard.service <<'EOF'
[Unit]
Description=darkhq-dashboard
After=network.target

[Service]
Type=simple
User=openclaw
WorkingDirectory=/home/openclaw/darkhq-dashboard
Environment=NODE_ENV=production
Environment=PORT=9700
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now darkhq-dashboard

# nginx
sudo cp nginx-darkhq.conf /etc/nginx/conf.d/darkhq.conf
sudo nginx -t && sudo systemctl reload nginx
```

### 8.2 更新流程（本地改完 push 到 GitHub 后）

```bash
cd /home/openclaw/darkhq-dashboard
git pull
npm install --omit=dev     # 仅当 package.json 有变
sudo systemctl restart darkhq-dashboard
```

### 8.3 日志

```bash
sudo journalctl -u darkhq-dashboard -f
```

### 8.4 常见问题

| 现象 | 排查 |
|---|---|
| API 全返回 mock 数据 | `NODE_ENV` 是不是 production；`/home/openclaw/.openclaw` 是否存在 |
| 班底卡全部"失联" / 没运行时状态 | §7.1 未对接 |
| 日程展开没有运行历史 | §7.2 未对接，或 `data/cron-runs/{jobId}/` 为空 |
| 风声"旧账"tab 空 | Dashboard 靠被动归档，让 OpenClaw 每次 signal-radar 后访问一次 `/api/signals`（§7.3） |
| 档案 tab 空 | §7.5 目录未建立 |
| 头像显示 emoji 不显示图片 | 检查 `public/avatars/bot-{id}.png` 是否存在 |
| 心跳卡延迟一直 —— | 前端 JS 被拦截；或 `/health` 没返 `{ok:true}` |

---

## 9. 前端架构速览

- **技术栈**：原生 HTML/CSS/JS，零打包零框架，pull 即用
- **字体**：Inter + JetBrains Mono，从 Google Fonts CDN 加载
- **主题色**：`--accent: #c8323a`（酒红），功能色 `--ok/--warn/--err`
- **rail**：4 页共用 `public/rail.js`。改导航项：编辑 `NAV` 数组
- **自定义 UI 组件**：
  | 类名 | 用途 |
  |---|---|
  | `.card` | 普通卡 |
  | `.card.card-accent` | 酒红渐变主卡（线路心跳用） |
  | `.stat-grid` + `.stat` | KPI 4 宫格 |
  | `.bot-card-grid` + `.bot-card` | 班底卡片 |
  | `.cron-list` + `.cron-row` | 日程表格 |
  | `.signal-grid` + `.signal-card` | 风声卡片 |
  | `.doc-layout` + `.doc-list` + `.doc-viewer` | 卷宗双栏 |
  | `.badge.ok/err/warn/dim` | 状态标签 |
  | `.status-chip` | 顶栏状态 pill |
  | `.sparkline` | 心跳折线图（纯 SVG） |
  | `.token-mini` + `.token-bar-stack` | Token 用量堆叠条 |
  | `.tabs` + `.tab` | tab 切换 |
  | `.filters` + `.filter-btn` | 筛选 pill |
  | `.progress` + `.progress-fill` | 进度条 |
- **响应式**：<640px 隐藏 rail、简化列

---

## 10. 待办

- [ ] §7.1 Bot 运行时状态对接
- [ ] §7.2 例牌运行历史回写
- [ ] §7.5 档案目录约定
- [ ] 卷宗支持全文搜索
- [ ] 权限控制（现在完全裸奔）
- [ ] SQLite 存储替代 JSON 文件归档（数据量大后考虑）

---

## 11. 版本索引

见 [`CHANGELOG.md`](./CHANGELOG.md)。
