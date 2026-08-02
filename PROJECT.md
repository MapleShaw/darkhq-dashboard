# PROJECT.md · 老巢交接文档

> **给 OpenClaw 那端拉代码后让这个 dashboard 跑起来、并把真实数据接进来的人。**
>
> 版本：v3.3（2026-05）
> 仓库：本地 dev → push 到 GitHub → 服务器 pull + restart

---

## 1. 这是什么

一个独立的 Node.js Express 服务，作为 OpenClaw Bot 舰队的可视化控制台。主题是**香港黑帮"老巢"**，界面上大量使用堂口 / 班底 / 日程 / 风声 / 卷宗这类术语 —— 不过这只是 UI 文案，**代码字段全部英文**，对接时按英文字段走就行。

能看到的：
- 5 位 Bot 的当前状态 / 当前差事 / 最近一单
- 全部定时例牌（cron）的运行记录与输出历史
- 内容雷达（博客 / X / 播客）的今日风声和近 7 天旧账
- 核心手册、团队文件、成员档案、聊天记录与 Cron 产出，支持全文搜索
- Bot 名称/角色配置 + ZenMux Token / 费用用量
- 任务流水、WeWeRSS、Headroom 与系统健康状态

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
| 今日 Token | `todayTokens: N`（来自 `/api/usage` 的 `bots[]` 合并） |
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
├── scripts/
│   └── cron-wrapper.sh     # 例牌包装器，把运行记录回写到 dashboard（给 OpenClaw 用）
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
| GET | `/api/usage` | ZenMux Token / 费用用量与趋势 |
| GET | `/api/docs?type=manuals\|team\|docs\|memory&bot=xxx&q=关键词` | 文档列表、成员筛选与白名单范围全文搜索 |
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

Dashboard 已经暴露 `POST /api/cron/:jobId/runs`，存到 `data/cron-runs/{jobId}/*.json`，在「日程 › 展开」里显示最近 10 次出勤。

#### 推荐方式：用仓库自带的 wrapper 脚本

`scripts/cron-wrapper.sh`（随代码仓库一起提交）帮你把"跑任务 + 量时长 + 抓输出 + 回写 dashboard"全部搞定。

在 OpenClaw 的 crontab 里，**把原来直接写的命令改成 wrapper 包装一层**即可：

```crontab
# 之前：
30 15 * * * node /home/openclaw/.openclaw/signal-radar.js

# 之后：
30 15 * * * /home/openclaw/darkhq-dashboard/scripts/cron-wrapper.sh signal-radar node /home/openclaw/.openclaw/signal-radar.js
```

Wrapper 会：
- 记录开始时间 + 时长（毫秒）
- 抓 stdout/stderr 作为 `output`（自动截断到 4KB，防止塞爆）
- 根据退出码判断 `success` / `failed`
- POST 回写到 dashboard，失败静默（不影响任务本身）
- 最后用任务真实退出码退出（系统的 cron 报错邮件照常触发）

#### 手工方式（不想用 wrapper 时）

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

**字段约定**（POST body）：
- `status`: `"success"` / `"failed"` / `"running"`（必填）
- `output`: 任务的原始输出，建议保留原样，dashboard 会用等宽字体展示（必填，可空字符串）
- `startedAt`: ISO 8601 时间戳（可选，不填用服务器当前时间）
- `durationMs`: 毫秒数（可选）

**这是最小对接，强烈建议做**。做完后所有例牌会从"未知"变为"搞掂/失手"，展开能看到真实的运行历史。

### 7.3 ✅ Signal Radar（已对接，2026-05 升级）

Dashboard 使用 **"主源优先 + 兜底按 source 补位"** 策略读取信号数据，两种数据源可同时存在，不会重复。

#### 优先级规则

1. **主源**：`content-signal-radar/dashboard-signals.json`
   - 由 `prepare-digest.js` 每次运行后自动写出（cron job 每天 15:30 跑）
   - 包含即刻、RSS 博客、X 推文的全量高信号，**无需 API key**
   - **只要文件存在，它覆盖的 source 就不再读兜底**（例如主源里有 `source: 'x'` 的条目，就不会再读 `feed-x.json`）

2. **兜底**：`feed-{blogs,x,podcasts}.json`
   - 由 `generate-feed.js`（GitHub Actions）生成，需要 `X_BEARER_TOKEN` + `SUPADATA_API_KEY`
   - **只在"主源里该 source 为空"时补位**。例如主源暂不处理 podcast，`feed-podcasts.json` 就会被读取来补 podcast 数据
   - 如果 secrets 未配置，兜底文件本身也是空的，降级为只有主源

> **关键**：这个 "source 级别的 override" 规则由 Dashboard 在 `server.js` 的 `/api/signals` 里实现，OpenClaw 那端不用关心。主源产出就只管写 `dashboard-signals.json`，不需要考虑会不会和 `feed-*.json` 冲突。

#### 主源数据结构

```json
{
  "generatedAt": "2026-05-05T07:30:00.000Z",
  "stats": { ... },
  "signals": [
    {
      "id": "https://x.com/user/status/123",
      "source": "x",              // "x" | "blog" | "podcast"（当前主源仅前两个）
      "sourceName": "Zara Zhang",
      "handle": "zarazhangrui",   // 仅 x 有
      "title": "...",
      "url": "https://...",
      "summary": "...",
      "score": 82,                // 0-100，prepare-digest 的 scoring.total * 100
      "publishedAt": "2026-05-04T06:48:41.000Z",
      "topic": "product_signal",  // signalIntent 字段
      "needsReview": false,
      "reviewNote": null
    }
  ]
}
```

#### 归档

- 每次 `/api/signals` 被访问时，**用全量数据（合并主源 + 兜底，不受 `?source=xx` 过滤影响）**自动存一份到 `data/signals-archive/{YYYY-MM-DD}.json`
- 同一天多次访问会覆盖当日文件（保留最后一次快照）
- 这个归档供 `/api/signals/history?days=N` 用于风声页"旧账"tab

#### 建议

让 signal-radar cron job 跑完后主动 touch 一下归档（确保每天至少归档一次）：

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

### 7.6 ⚠️ Token 用量统计（口径 + 契约）

> **当前状态（2026-05）**：**OpenClaw gateway 未实现 `/api/usage`**。
>
> Dashboard 调不到数据时会返回 `{ ok: true, notConnected: true, reason: '...' }`，前端会显示"⚠ Gateway 未对接该接口"而不是假数据。下面是让 gateway 这端实现的完整指引。

#### 当前诊断

在服务器上跑这两条 curl 确认是哪种情况：

```bash
# 1) Dashboard 自己的接口（看它返回 notConnected 原因）
curl -s http://localhost:9700/api/usage | jq

# 2) 绕过 dashboard 直接问 gateway
TOKEN=$(jq -r '.gateway.auth.token' /home/openclaw/.openclaw/openclaw.json)
curl -sv -H "Authorization: Bearer $TOKEN" http://localhost:18789/api/usage
# 404/501 → gateway 完全没这个路由
# 200 但字段不对 → 路由有但口径不符（见下文契约）
```

#### 契约：gateway 应该返回的结构

`GET http://localhost:18789/api/usage` （带 `Authorization: Bearer <token>`）：

```json
{
  "usage": {
    "totalTokens": 1284500,
    "todayTokens": 52300,
    "statPeriod": "2026-04-01 起累计",
    "timezone": "Asia/Shanghai",
    "models": [
      { "model": "Claude Opus 4.6",   "tokens": 642250, "pct": 50 },
      { "model": "Claude Sonnet 4.6", "tokens": 385350, "pct": 30 },
      { "model": "Ling 2.6 1T",       "tokens": 256900, "pct": 20 }
    ],
    "bots": [
      { "id": "main",      "todayTokens":  8200, "totalTokens": 192000 },
      { "id": "content",   "todayTokens": 18400, "totalTokens": 512300 },
      { "id": "tech",      "todayTokens":  4100, "totalTokens": 128900 },
      { "id": "intel",     "todayTokens":  6800, "totalTokens": 156800 },
      { "id": "assistant", "todayTokens": 14800, "totalTokens": 294500 }
    ]
  }
}
```

#### 字段说明

| 字段 | 含义 | 计算方式 |
|---|---|---|
| `totalTokens` | 累计消耗（input + output） | 从 `statPeriod` 起点到现在的总和 |
| `todayTokens` | 今日消耗 | `timezone` 时区今日 00:00 至今的新增 |
| `models[].tokens` | 按模型的累计 | 同 totalTokens 的口径，按模型拆 |
| `models[].pct` | 模型占比 | 整数 0-100，`round(tokens / totalTokens * 100)` |
| `bots[].todayTokens` | 某个 bot 今日消耗 | **按 bot 维度的 todayTokens**，给班底卡片用 |
| `bots[].totalTokens` | 某个 bot 累计 | 可选，不填 dashboard 也能跑 |
| `statPeriod` | 累计起点说明 | 字符串，如 `"2026-04-01 起累计"` 或 `"since deploy"` |
| `timezone` | 今日口径的时区 | 字符串，如 `"Asia/Shanghai"` |

**关键约束**：
- `input + output` 都算进 token 消耗（与大模型厂商计费口径一致）
- `todayTokens` 必须**基于 timezone 字段指定的时区**计算当日边界，不是 UTC
- `bots[].id` 必须和 `/api/bots` 返回的 `bot.id` 一一对应（见 §3.3 codename 表：main/content/tech/intel/assistant）
- 所有字段**都可以缺省**：Dashboard 见到缺省字段会降级显示 `—`，不会报错
- 只要**顶层有 `totalTokens`（或 `models[]` 数组）**，dashboard 就认为"对接成功"，否则归类为 notConnected

#### Gateway 侧实现指引（给 OpenClaw 开发者）

Gateway 要拿到每次 LLM 调用的 usage，**数据来自哪里**：

1. **Claude API 响应**：`message.usage.input_tokens` + `message.usage.output_tokens`
2. **OpenAI 兼容接口**（Ling 等）：`response.usage.prompt_tokens` + `response.usage.completion_tokens`
3. **Anthropic SDK / OpenAI SDK 都会在 response 里带 usage 字段**

**建议的实现方式**（任选一种，按工作量从小到大）：

| 方案 | 工作量 | 说明 |
|---|---|---|
| A. SQLite 每次调用写一行 | 低 | 一张表 `llm_calls(ts, bot_id, model, input, output)`，`/api/usage` 做几个 SUM / GROUP BY 聚合返回 |
| B. 文件 append-only | 最低 | `usage.jsonl` 每次调用追加一行，`/api/usage` 启动时加载到内存 + 增量维护。适合没 DB 的场景 |
| C. 查 LLM 厂商的账单 API | 高 | Anthropic / 各家都有 usage API，但延迟 1-2 天、不能按 bot 拆、需要多 API key |

**推荐 A**。每个 bot 在发起 LLM 调用的那层加拦截器就行，gateway 层拦最方便。

#### Dashboard 侧怎么消费

1. **侧栏 Token 卡**（`/api/usage`）：展示 `totalTokens` / `todayTokens` / 分模型进度条 / `statPeriod + timezone` 口径说明
2. **班底卡片今日 Token**（`/api/bots`）：server.js 在响应 `/api/bots` 时会**内部调一次 `GET /api/usage`**，把 `usage.bots[*].todayTokens` 合并到对应 bot 对象上。Gateway 不用单独暴露 per-bot 接口，只要 `/api/usage` 里带 `bots` 数组就行

#### 不变量校验（建议）

如果希望 dashboard 显示一致，gateway 实现时建议保证：
- `sum(bots[].todayTokens) ≈ todayTokens`（允许小误差，如舍入）
- `sum(models[].tokens) ≈ totalTokens`
- `sum(models[].pct) = 100`

---

### 7.7 ⚠️ 聊天底（memory）目录命名与大小建议

> **背景**：当前 `workspace/memory/` 下文件命名不统一，有的按日期（`2026-05-05.md`）、有的按主题（`2026-05-05-dashboard-cron.md`）、还有无日期的累积型笔记（`ideas.md` 361KB、`daily-english-notes.md`）。这导致 Dashboard 的"卷宗 › 聊天底"tab 列表混乱，大文件也会让浏览器渲染卡顿。

#### 建议的目录规则

| 文件形态 | 放哪里 | 命名 |
|---|---|---|
| 每日对话日志（全天） | `workspace/memory/` | `YYYY-MM-DD.md` |
| 主题化的子日志（一天多主题） | `workspace/memory/` | `YYYY-MM-DD-主题.md`，主题用英文短横杠 |
| **累积型笔记 / 长期列表** | **`workspace/docs/{bot_codename}/`** | 可读中文名，如 `灵感收集.md`、`每日美语笔记.md` |
| 整理过的正式产出 | `workspace/docs/{bot_codename}/` | 见 §7.5 |

**判断标准**：如果一个文件"会持续追加、不会主动清空、按时间线无意义"，它就不属于 `memory/`，应该挪到 `docs/` 里。

#### 大小限制

- **单个 md 文件建议 < 50 KB**（Dashboard 的 markdown 渲染对大文件会卡）
- Dashboard 前端兜底：
  - 文件 > 150 KB → 自动切换纯文本模式，关闭 markdown 渲染，并显示警告
  - 文件 > 500 KB → 截断到前 300 KB 显示，警告"请去服务器文件系统查看完整原文"
- 超过阈值的文件建议按主题或日期切分（比如把 `ideas.md` 按月切成 `ideas/2026-04.md`、`ideas/2026-05.md`）

#### 给 Bot 的 prompt 提示建议

写入 memory 的 bot 可以加一条系统指令：

> 每日对话日志按 `YYYY-MM-DD.md` 命名，同一天多主题时按 `YYYY-MM-DD-主题.md` 切分。
> 长期累积型笔记（如灵感、名言、学习记录）不要写 memory/，要写到 `workspace/docs/{你的 codename}/` 目录下，用可读中文名。
> 单文件超过 50KB 时主动按时间或主题切分。

这个目录整顿工作量应该不大（bot 的写入逻辑调整 + 已有文件做一次 mv），但收益很大：卷宗页会变得整齐，不会再出现单个 300KB+ 的聊天底让 dashboard 卡死。


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
- [ ] §7.2 例牌运行历史回写（使用仓库自带的 `scripts/cron-wrapper.sh` 最省事）
- [x] §7.3 Signal Radar 数据源升级（2026-05-05：prepare-digest.js 写出 dashboard-signals.json）
- [x] §7.3 Signal 双读去重 + 归档口径修复（2026-05-05 v3.3.1）
- [x] §7.5 档案目录约定与分层展示
- [x] §7.6 Token / 费用用量（改为 ZenMux management API，非 Gateway `/api/usage`）
- [ ] §7.7 memory/ 目录整顿 + 累积型笔记迁移到 docs/
- [x] 卷宗支持白名单范围全文搜索（标题、分类、标签与正文）
- [x] 可选权限控制（设置 `DASHBOARD_TOKEN` 后启用页面登录与 API 鉴权）
- [ ] SQLite 存储替代 JSON 文件归档（数据量大后考虑）

---

## 11. 版本索引

见 [`CHANGELOG.md`](./CHANGELOG.md)。
