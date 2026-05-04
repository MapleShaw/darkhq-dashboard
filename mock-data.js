/**
 * 本地 mock 数据
 * —————————————————
 * 仅本地开发使用：env.MOCK === '1' 或 NODE_ENV !== 'production' 时启用。
 */

'use strict';

const BOT_META = [
  { id: 'main',      name: '老大',     codename: 'main',      model: 'Claude Opus 4.6',   role: '总指挥',   channel: 'telegram' },
  { id: 'content',   name: '洗脑专家', codename: 'content',   model: 'Claude Opus 4.6',   role: '内容创作', channel: 'telegram' },
  { id: 'tech',      name: '键盘杀手', codename: 'tech',      model: 'Claude Sonnet 4.6', role: '技术运维', channel: 'telegram' },
  { id: 'intel',     name: '线人',     codename: 'intel',     model: 'Claude Sonnet 4.6', role: '情报收集', channel: 'telegram' },
  { id: 'assistant', name: '跟班',     codename: 'assistant', model: 'Ling 2.6 1T',       role: '杂活',     channel: 'telegram' },
];

// ── Bots（含当前状态、最近任务等卡片化所需信息）──────────────
function mockBots() {
  const now = Date.now();
  const min = (n) => new Date(now - n * 60 * 1000);

  const runtime = {
    main:      { status: 'online',  lastTaskName: '📊 每日简报',        lastTaskTime: min(42),  lastTaskStatus: 'success', weekTasks: 18, currentTask: null },
    content:   { status: 'running', lastTaskName: '每日灵魂拷问',        lastTaskTime: min(8),   lastTaskStatus: 'success', weekTasks: 24, currentTask: '正在整理《本周内容选题清单》' },
    tech:      { status: 'online',  lastTaskName: 'OpenClaw 更新检查',   lastTaskTime: min(112), lastTaskStatus: 'failed',  weekTasks: 11, currentTask: null },
    intel:     { status: 'online',  lastTaskName: '📡 Content Signal Radar', lastTaskTime: min(156), lastTaskStatus: 'success', weekTasks: 9, currentTask: null },
    assistant: { status: 'online',  lastTaskName: '每日会话自动日志',    lastTaskTime: min(3),   lastTaskStatus: 'success', weekTasks: 31, currentTask: null },
  };

  const bots = BOT_META.map((b) => ({
    ...b,
    avatarUrl: `/avatars/bot-${b.id}.png`,
    online: runtime[b.id].status !== 'offline',
    status: runtime[b.id].status,
    currentTask: runtime[b.id].currentTask,
    lastTaskName: runtime[b.id].lastTaskName,
    lastTaskTime: runtime[b.id].lastTaskTime.toISOString(),
    lastTaskStatus: runtime[b.id].lastTaskStatus,
    weekTasks: runtime[b.id].weekTasks,
    lastSeen: fmtShort(runtime[b.id].lastTaskTime),
  }));

  return {
    ok: true,
    gatewayOnline: true,
    host: 'VM-0-5-local',
    uptime: '3d 14h 22m',
    bots,
  };
}

function fmtShort(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}`;
}

// ── Cron 任务定义（含负责的 bot）────────────────────────────
const CRON_DEFS = [
  { id: 'daily-log',     name: '每日会话自动日志',       schedule: '01:00', emoji: '📝', botId: 'assistant' },
  { id: 'daily-brief',   name: '📊 每日简报',            schedule: '10:00', emoji: '📊', botId: 'main' },
  { id: 'update-check',  name: 'OpenClaw 更新检查',      schedule: '10:00', emoji: '🔄', botId: 'tech' },
  { id: 'signal-radar',  name: '📡 Content Signal Radar', schedule: '15:30', emoji: '📡', botId: 'intel' },
  { id: 'soul-check',    name: '每日灵魂拷问',            schedule: '21:00', emoji: '🧠', botId: 'content' },
  { id: 'daily-english', name: '🇺🇸 每日地道美语',        schedule: '21:10', emoji: '🇺🇸', botId: 'content' },
];

function mockCron() {
  const now = new Date();
  const jobs = CRON_DEFS.map((d, i) => {
    const [h, m] = d.schedule.split(':').map(Number);
    const last = new Date(now);
    last.setHours(h, m, 0, 0);
    if (last > now) last.setDate(last.getDate() - 1);
    const next = new Date(last);
    next.setDate(next.getDate() + 1);
    const status = d.id === 'update-check' ? 'failed' : 'success';
    return { ...d, lastRun: last.toISOString(), nextRun: next.toISOString(), enabled: true, status };
  });
  return { ok: true, jobs };
}

// ── Cron 运行历史（按 jobId 返回近 N 次）──────────────────────
const CRON_OUTPUTS = {
  'daily-log':     '✓ 已归档 2026/05/04 全部会话到 memory/2026-05-04.md\n涉及 5 个 bot，共 47 条消息\n生成摘要：280 字',
  'daily-brief':   '📊 2026/05/04 每日简报\n- OpenClaw fleet 全部 bot 在线\n- 昨日产出 3 份文档、18 条信号\n- 今日重点：Content Signal Radar 失败 1 次，需修复',
  'update-check':  '❌ OpenClaw 更新检查失败\nTraceback: ConnectionError — github.com 请求超时\n重试策略：next run at 2026-05-05 10:00',
  'signal-radar':  '📡 扫描完成\n新增信号：9（blog 3 / x 3 / podcast 3）\n过滤低分：4\n已写入 content-signal-radar/feed-*.json',
  'soul-check':    '🧠 今日灵魂拷问已发送到 telegram\n主题：如果把 OpenClaw 开源，你会怎样调整定位？\n生成字数：412',
  'daily-english': '🇺🇸 今日美语\nPhrase: "lowkey obsessed with"\n例句 3 条已生成\n已推送到 telegram',
};

function mockCronRuns(jobId, limit = 10) {
  const def = CRON_DEFS.find((d) => d.id === jobId);
  if (!def) return { ok: false, error: 'job not found' };
  const [h, m] = def.schedule.split(':').map(Number);

  const runs = [];
  const now = new Date();
  for (let i = 0; i < limit; i++) {
    const t = new Date(now);
    t.setDate(t.getDate() - i - 1);
    t.setHours(h, m, 0, 0);
    // mock: update-check 前 3 次失败，signal-radar 偶尔失败
    let status = 'success';
    if (jobId === 'update-check' && i < 3) status = 'failed';
    if (jobId === 'signal-radar' && i === 4) status = 'failed';
    runs.push({
      id: `${jobId}-${t.toISOString().slice(0, 10)}`,
      jobId,
      startedAt: t.toISOString(),
      durationMs: status === 'failed' ? 8_420 : 3_200 + Math.floor(Math.random() * 2_000),
      status,
      output: status === 'failed'
        ? `❌ 运行失败\nError: ${jobId === 'update-check' ? 'network timeout' : 'feed parse error on feedly.com'}`
        : CRON_OUTPUTS[jobId] || '✓ 完成',
    });
  }
  return { ok: true, jobId, job: def, runs };
}

// ── Signals（当前 + 历史归档）─────────────────────────────────
function mockSignals(sourceFilter = 'all') {
  const signals = buildSignalsForDay(0);
  const filtered = sourceFilter === 'all' ? signals : signals.filter((s) => s.source === sourceFilter);
  filtered.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  return { ok: true, signals: filtered, total: filtered.length };
}

function mockSignalsHistory(days = 7) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - i * 24 * 3600 * 1000);
    out.push({
      date: date.toISOString().slice(0, 10),
      signals: buildSignalsForDay(i),
    });
  }
  return { ok: true, days: out };
}

function buildSignalsForDay(dayOffset) {
  const base = Date.now() - dayOffset * 24 * 3600 * 1000;
  const hrs = (n) => new Date(base - n * 3600 * 1000).toISOString();
  const generatedAt = hrs(1);

  // 按日期偏移生成不同内容的信号（保证历史看起来真实）
  const pools = [
    // Day 0（今天）
    [
      { source: 'blog', sourceName: 'Simon Willison', title: 'Claude 的新 artifacts 模式：我用它搭了一个 SQLite 前端', url: 'https://simonwillison.net/2026/claude-artifacts-sqlite', summary: 'Anthropic 上线了 artifacts beta，可在对话中直接渲染完整交互式网页。我用它包了一个浏览器端 SQLite 查询工具，零后端。', reason: '切合 indie hacker 工具链，有复刻潜力', score: 92 },
      { source: 'blog', sourceName: 'Patrick Collison', title: 'Fast — 一份关于为什么速度复利的清单', url: 'https://patrickcollison.com/fast', summary: '从 Empire State Building 410 天建成到 CVS 疫苗流程，一份持续更新的"快"案例集。快不是奢侈，是世界观。', reason: '创始人必读，适合放日报', score: 88 },
      { source: 'blog', sourceName: 'Dan Abramov', title: 'React Server Components 两年回看：我们错在了哪里', url: 'https://overreacted.io/rsc-two-years', summary: 'Dan 少见地自我反思，承认 RSC 的 mental model 对普通开发者太重。', reason: '技术栈判断参考', score: 81 },
      { source: 'x', sourceName: '@levelsio', title: '$5k/mo MRR 新方法：把 Claude 当 SaaS 卖', url: 'https://x.com/levelsio/status/1800000000', summary: '我把一个不到 300 行的 Claude wrapper 部署上线，8 天跑到 5k 月收入。关键是垂直场景和 300 行的 prompt。', reason: '独立开发者收入案例', score: 85 },
      { source: 'x', sourceName: '@karpathy', title: 'agents.md 可能是 2026 年最被低估的协议', url: 'https://x.com/karpathy/status/1800000001', summary: '就像 robots.txt 之于爬虫，agents.md 是给 AI agent 看的。我赌它会比 OpenAPI spec 更快成为标准。', reason: 'agent 生态风向', score: 79 },
      { source: 'x', sourceName: '@jasonlk', title: 'vibe coding 之后，我们发现真正的瓶颈是测试', url: 'https://x.com/jasonlk/status/1800000002', summary: 'AI 生成代码速度是人的 10 倍，但审代码、写测试、debug 反而成瓶颈。团队效率只提高 2x 不是 10x。', reason: '工程管理观察', score: 74 },
      { source: 'podcast', sourceName: 'Lex Fridman', title: '#450 · Dario Amodei 谈 Claude 5 与对齐的未来', url: 'https://lexfridman.com/dario-amodei-2', summary: '3 小时长谈。Dario 首次详细披露 Claude 5 训练中的几个关键决定。', reason: '行业第一手信息', score: 83 },
      { source: 'podcast', sourceName: 'Acquired', title: 'Anthropic — 从 Claude 到 60B 估值的 4 年', url: 'https://acquired.fm/episodes/anthropic', summary: '从 OpenAI 出走、早期 Constitution AI 思路、到 Claude 3 商业化的完整时间线。', reason: '创业叙事 + 商业复盘', score: 76 },
      { source: 'podcast', sourceName: 'Latent Space', title: 'Mistral CEO：欧洲 AI 的第二次机会', url: 'https://latent.space/mistral-ceo', summary: '为什么 Mistral 坚持开源、拒绝 OpenAI 并购、以及下一个模型方向。', reason: '开源 vs 闭源对照', score: 70 },
    ],
    // Day 1（昨天）
    [
      { source: 'blog', sourceName: 'Fly.io', title: '我们为什么放弃 Kubernetes 转向 Firecracker', url: 'https://fly.io/blog/firecracker', summary: 'Fly.io 工程团队分享从 K8s 迁移到自研 Firecracker 编排的 18 个月历程，成本下降 62%。', reason: '基础设施降本案例', score: 86 },
      { source: 'blog', sourceName: 'Drew Breunig', title: '为什么 AI 公司都在争夺浏览器', url: 'https://dbreunig.com/ai-browsers', summary: 'Arc、Dia、Comet 都押注 browser as agent 入口。这是 Netscape 时刻 2.0。', reason: '赛道判断', score: 80 },
      { source: 'x', sourceName: '@sama', title: 'GPT-6 训练即将完成', url: 'https://x.com/sama/status/1799000000', summary: '不剧透能力细节，但会是 OpenAI 历史上最大的单次模型飞跃之一。', reason: '关注即可', score: 78 },
      { source: 'x', sourceName: '@shl', title: 'Designer 用 Claude 写代码 vs 工程师用 Claude 做设计', url: 'https://x.com/shl/status/1799000001', summary: '观察下来，前者产出更稳。设计师的品味是 prompt 的一部分。', reason: '团队协作启发', score: 72 },
      { source: 'podcast', sourceName: 'The Changelog', title: 'SQLite is the new Postgres', url: 'https://changelog.com/sqlite-future', summary: 'Turso、LiteFS、Cloudflare D1 都在押注 SQLite 变成分布式。访谈 Turso CEO。', reason: '数据库趋势', score: 75 },
    ],
    // Day 2
    [
      { source: 'blog', sourceName: 'Vercel', title: 'Edge runtime 的三年复盘：我们赢了什么又输了什么', url: 'https://vercel.com/blog/edge-retrospective', summary: 'Edge 不是万能的。回到 nodejs runtime 反而是最近很多团队的选择。', reason: 'serverless 反思', score: 77 },
      { source: 'x', sourceName: '@paulg', title: '创业者最容易犯的错：过度听 user', url: 'https://x.com/paulg/status/1798000000', summary: 'Focus group 是毒药。你要听的是忠诚用户用脚投票，不是嘴巴投票。', reason: 'YC 智慧', score: 82 },
      { source: 'podcast', sourceName: 'Invest Like the Best', title: 'Stripe 16 年回看：为什么没有上市', url: 'https://joincolossus.com/stripe-16', summary: 'Patrick & John 深度对谈。关于 Stripe 不急于 IPO 的战略选择。', reason: '长期主义案例', score: 79 },
    ],
    // Day 3+（简化）
    [
      { source: 'blog', sourceName: 'Matt Rickard', title: 'LLM 工作流不是 DAG 是 Actor Model', url: 'https://matt-rickard.com/actor-llm', summary: '为什么我们用 actor model 替代 DAG 重写了 agent 编排层。', reason: '架构思路', score: 73 },
      { source: 'x', sourceName: '@nat', title: 'GitHub Copilot Agent 体验报告', url: 'https://x.com/nat/status/1797000000', summary: '用了两周，已经可以提交 90% 的 chore PR。剩下 10% 是有意思的工作。', reason: 'dev tool 体验', score: 71 },
    ],
    [
      { source: 'blog', sourceName: 'Figma', title: 'Dev Mode 2.0：从 Figma 到代码的直路', url: 'https://figma.com/blog/dev-mode-2', summary: '设计到代码的闭环终于做扎实了。', reason: '设计工具演进', score: 68 },
      { source: 'podcast', sourceName: 'a16z', title: 'Vibe coding 是泡沫还是未来', url: 'https://a16z.com/vibe-coding-pod', summary: 'Marc Andreessen 和两位创始人辩论。', reason: '观点分歧', score: 69 },
    ],
    [
      { source: 'x', sourceName: '@swyx', title: 'AI engineer 岗位招聘季观察', url: 'https://x.com/swyx/status/1796000000', summary: '2026 Q1 AI engineer 岗位同比 +340%。但合格候选人只有 +40%。', reason: '人才市场', score: 76 },
    ],
    [
      { source: 'blog', sourceName: 'GitHub', title: 'Copilot 3.0 产品路线图', url: 'https://github.blog/copilot-3-roadmap', summary: '未来 6 个月的产品计划。', reason: '生态风向', score: 74 },
      { source: 'x', sourceName: '@pmarca', title: '为什么 AI 不会杀死 junior dev', url: 'https://x.com/pmarca/status/1795000000', summary: '恰恰相反，junior dev 会是 AI 最大受益者。', reason: '观点文', score: 70 },
    ],
  ];

  const pool = pools[Math.min(dayOffset, pools.length - 1)];
  return pool.map((item, i) => ({
    id: `d${dayOffset}-${i}`,
    ...item,
    publishedAt: hrs(i * 2 + 1),
    generatedAt,
  }));
}

// ── Token Usage ───────────────────────────────────────────────
function mockUsage() {
  return {
    ok: true,
    usage: {
      totalTokens: 1_284_500,
      todayTokens: 52_300,
      models: [
        { model: 'Claude Opus 4.6',   tokens: 642_250, pct: 50 },
        { model: 'Claude Sonnet 4.6', tokens: 385_350, pct: 30 },
        { model: 'Ling 2.6 1T',       tokens: 256_900, pct: 20 },
      ],
    },
  };
}

// ── Docs（会话日志 memory + 整理文档 docs）──────────────────
function mockDocs(type, filterBot) {
  if (type === 'memory') {
    const days = ['2026-05-04', '2026-05-03', '2026-05-02', '2026-05-01', '2026-04-30', '2026-04-29', '2026-04-28'];
    const list = days.map((d) => ({
      id: `memory-${d}`,
      type: 'memory',
      title: `${d} · 聊天底`,
      botId: null, // memory 跨 bot
      createdAt: new Date(d + 'T23:00:00').toISOString(),
      size: 8_400 + Math.floor(Math.random() * 4_000),
      preview: `# ${d} 聊天记录\n\n## 摘要\n- 老大处理了 5 个主线差事\n- 洗脑专家输出 3 篇文章草稿\n- 线人扫探 12 个来源`,
    }));
    return { ok: true, docs: filterBot ? [] : list };
  }

  if (type === 'docs') {
    const docs = [
      { id: 'd-weekly-review-w18',    title: '第 18 周复盘 · OpenClaw 产出分析', botId: 'main',     createdAt: new Date('2026-05-04T21:30:00').toISOString() },
      { id: 'd-content-plan-may',     title: '五月内容选题清单',                  botId: 'content',  createdAt: new Date('2026-05-04T14:20:00').toISOString() },
      { id: 'd-tech-debt-report',     title: 'OpenClaw 技术债务清单 Q2',          botId: 'tech',     createdAt: new Date('2026-05-03T18:00:00').toISOString() },
      { id: 'd-competitor-scan-0503', title: '5/3 竞品动态扫描',                  botId: 'intel',    createdAt: new Date('2026-05-03T16:00:00').toISOString() },
      { id: 'd-soul-q-archive',       title: '灵魂拷问主题归档 · 4 月',           botId: 'content',  createdAt: new Date('2026-05-01T22:00:00').toISOString() },
      { id: 'd-trip-checklist',       title: '出差物品清单',                      botId: 'assistant', createdAt: new Date('2026-04-29T10:30:00').toISOString() },
      { id: 'd-model-benchmark',      title: 'Claude vs Ling 内部评测',           botId: 'tech',     createdAt: new Date('2026-04-28T15:45:00').toISOString() },
      { id: 'd-viral-posts-apr',      title: '4 月爆款内容复盘',                  botId: 'content',  createdAt: new Date('2026-04-28T11:00:00').toISOString() },
    ];
    const list = (filterBot && filterBot !== 'all') ? docs.filter((d) => d.botId === filterBot) : docs;
    return {
      ok: true,
      docs: list.map((d) => ({
        ...d,
        type: 'docs',
        size: 3_200 + Math.floor(Math.random() * 6_000),
      })),
    };
  }

  return { ok: false, error: 'unknown doc type' };
}

const DOC_BODIES = {
  // 会话日志
  'memory-2026-05-04': `# 2026-05-04 · 会话日志

## 摘要

今日 OpenClaw 舰队整体运行平稳，共处理 47 条消息，产出 3 份文档，扫描 18 条高质量信号。

---

## 主线事件

### 09:12 · 老大 · 周计划讨论
用户提出本周重点：推进 Dashboard v3 视觉升级 + OpenClaw 更新策略。
老大协调了四个 bot 分工：
- 内容创作：准备一篇关于 vibe coding 的深度文
- 技术运维：调查 OpenClaw v2.7 更新是否稳定
- 情报收集：扫描竞品 Dashboard 设计
- 跟班：整理本周待办清单

### 14:32 · 情报收集 · 信号扫描完成
本次扫描识别 9 条高分信号：
1. Simon Willison 的 SQLite 前端（评分 92）
2. Patrick Collison 的 fast 清单（评分 88）
3. levelsio 的 5k MRR wrapper 方案（评分 85）

### 17:45 · 技术运维 · OpenClaw 更新检查失败
\`ConnectionError: github.com 请求超时\`
已登记到技术债清单，明日手动 retry。

### 21:00 · 内容创作 · 灵魂拷问
今日主题："如果把 OpenClaw 开源，你会怎样调整定位？"
用户回复较长（412 字），content bot 将其归档到灵魂拷问文档库。

---

## 指标

| 指标 | 今日 | 昨日 | 变化 |
|------|------|------|------|
| Token 用量 | 52.3K | 48.1K | +8.7% |
| Bot 激活次数 | 47 | 39 | +20% |
| 文档产出 | 3 | 2 | +1 |

`,

  'memory-2026-05-03': `# 2026-05-03 · 会话日志

## 摘要

周六轻量运行，主要是跟班 bot 处理周末杂事，以及情报扫描。

---

### 10:30 · 跟班 · 账单提醒
- 腾讯云轻量服务器续费（5/15 到期）
- 域名 indiehacker.fun 续费（7/31 到期）
- SSL 证书剩余 88 天

### 15:30 · 情报收集 · 周末信号扫描
本次扫描偏向 Twitter/X，识别出 Fly.io 放弃 K8s 的工程博客是本周热门。

### 18:00 · 技术运维 · 技术债盘点
完成 Q2 技术债清单，共 12 项，其中 3 项高优。产出 \`技术债务清单 Q2.md\`。

`,

  'memory-2026-05-02': `# 2026-05-02 · 会话日志

今日老大出差，bot 自主运行。

### 11:00 · 内容创作 · 热点跟进
针对昨日的 Claude artifacts 新闻，产出一篇 2000 字分析。待老大审阅后发布。

### 14:00 · 情报收集 · 竞品扫描
扫描了 5 个同类产品，产出对比报告。

### 21:00 · 内容创作 · 灵魂拷问
主题："为什么我们害怕被 AI 取代？"`,

  // 整理文档
  'd-weekly-review-w18': `# 第 18 周复盘 · OpenClaw 产出分析

> 周期：2026/04/28 - 2026/05/04
> 整理人：老大

## 一句话总结

本周是 OpenClaw 舰队跑起来以来**产出最密集**的一周，但同时暴露了 1 个关键风险（技术运维 bot 对外部网络的依赖）。

## 产出数据

| Bot | 消息数 | 文档产出 | 主要贡献 |
|-----|--------|----------|----------|
| 老大 | 12 | 1 | 周计划 + 本文复盘 |
| 内容创作 | 18 | 3 | vibe coding 深度文 + 灵魂拷问归档 |
| 技术运维 | 8 | 2 | 技术债清单 + 模型评测 |
| 情报收集 | 6 | 1 | 竞品扫描报告 |
| 跟班 | 23 | 0 | 账单/日程提醒、日志归档 |

## 亮点

1. **内容创作**上线了周级的"灵魂拷问归档"，用户反馈积极
2. **技术运维**产出的《模型评测》给出了清晰的模型切换建议

## 风险

1. **OpenClaw 更新检查任务**本周失败 3 次，均为 github.com 超时
   - 短期：加 retry + 延长 timeout
   - 长期：考虑镜像源或自建中继

## 下周重点

- [ ] 解决更新检查网络问题
- [ ] Dashboard v3 视觉升级上线
- [ ] 内容创作增加"爆款公式"训练`,

  'd-content-plan-may': `# 五月内容选题清单

> Bot: 洗脑专家 · 2026-05-04

## 主题布局

本月主攻 3 条内容线：

### 线 1：AI Dev Tool 深度测评（每周一篇）
- [x] W18: Claude vs Cursor vs Windsurf 横评
- [ ] W19: v0 / bolt / lovable 对比
- [ ] W20: GitHub Copilot Agent 实战
- [ ] W21: Codebuddy 体验报告

### 线 2：Indie Hacker 商业案例（每周一篇）
- [ ] levelsio 的 300 行 wrapper
- [ ] Marc Lou 的 ShipFast 模板生意
- [ ] Pieter Levels 的 photoai
- [ ] 被忽视的国内 indie 案例

### 线 3：Vibe Coding 系列（深度长文，两周一篇）
- [ ] 我用 Claude 写了 10 万行代码后的总结
- [ ] Vibe Coding 不是终点：真正的瓶颈

## KPI

- 单篇阅读 > 5000
- 月度涨粉 > 800
- 产生 1 条付费转化线索

## 产出时间表

每周一上午 10:00 发布主文
每周四下午 15:00 发布短内容`,

  'd-tech-debt-report': `# OpenClaw 技术债务清单 Q2

> Bot: 键盘杀手 · 2026-05-03

## 高优 (P0)

### T-001 更新检查网络不稳定
- 现象：3 天内失败 3 次，均为 github.com timeout
- 根因：服务器所在区域对 github 访问不稳定
- 方案：
  1. 加 retry + 延长 timeout（快速止血，1h）
  2. 切换 github proxy（根治，0.5d）

### T-002 Gateway token 轮换无自动化
- 风险：token 泄漏需手动改多处配置
- 方案：封装 token rotate 脚本 + secrets 统一管理

## 中优 (P1)

### T-003 Bot 日志没有统一搜索
- 当前 memory/*.md 只能按文件名找
- 方案：加全文索引（ripgrep or SQLite FTS5）

### T-004 Signal Radar 去重逻辑粗糙
- 仅按 URL 去重，相同内容不同 URL 会重复
- 方案：加标题 simhash

## 低优 (P2)

### T-005 Dashboard 无响应式优化（窄屏破版）
### T-006 cron 任务无重试队列
### T-007 bot 权限未隔离

## 统计

- 高优：2
- 中优：2
- 低优：3
- **预估总工时：12 人天**`,

  'd-competitor-scan-0503': `# 5/3 竞品动态扫描

> Bot: 线人 · 2026-05-03

## 今日重点

### 1. Lindy.ai 发布 v3
- 新增 "Teams" 功能，多 agent 协作
- 定价调整：基础版降价 30%
- 对我们启示：多 agent 协作是标配，我们领先但不多

### 2. Relevance AI 融资 1 亿美元
- Series C，估值 5 亿
- 赛道：agent + 数据分析
- 评估：赛道验证，但定位和我们不重合

### 3. CrewAI 开源版本 v0.5
- 新增 memory 持久化方案
- 可参考他们的 SQLite schema

## 扫描来源

- ProductHunt 每日榜
- YC companies 更新
- Twitter AI 账号 50 个
- Hacker News top 50

## 共 5 条，筛后 3 条
（另 2 条低价值，略）`,
};

function mockDocContent(id) {
  const body = DOC_BODIES[id];
  if (!body) return { ok: false, error: 'doc not found' };
  return { ok: true, id, body };
}

module.exports = {
  BOT_META,
  CRON_DEFS,
  mockBots,
  mockCron,
  mockCronRuns,
  mockSignals,
  mockSignalsHistory,
  mockUsage,
  mockDocs,
  mockDocContent,
};
