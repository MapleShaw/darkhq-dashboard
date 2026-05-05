/**
 * 老巢控制台 · server
 * ─────────────────────────────────────────────────────────
 * 本地开发：MOCK=1 npm run dev
 * 服务器部署：NODE_ENV=production npm start
 * 详见 PROJECT.md
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

// ── 手动加载 .env（不依赖 dotenv 包）─────────────────────
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    });
  }
} catch (e) { /* .env 不存在也无所谓 */ }
const fetch = require('node-fetch');

let multer = null;
try { multer = require('multer'); } catch (e) { /* avatar 上传可选，不装也能跑 */ }

// ── Mock 开关 ─────────────────────────────────────────────
// 规则：
// 1. 显式指定 MOCK=1 → 开
// 2. 非 production 且服务器目录 /home/openclaw/.openclaw 不存在（本地 Mac）→ 开
// 3. production → 关，从真实 workspace 读
const USE_MOCK = process.env.MOCK === '1'
  || (process.env.NODE_ENV !== 'production' && !fs.existsSync('/home/openclaw/.openclaw'));
const mockData = USE_MOCK ? require('./mock-data') : null;
if (USE_MOCK) console.log('🧪  MOCK mode ON — 本地开发数据生效（线上请设置 NODE_ENV=production）');

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 9700;
const HOST = '0.0.0.0';

// ── OpenClaw Workspace Paths ──────────────────────────────
const OPENCLAW_ROOT = process.env.OPENCLAW_ROOT || '/home/openclaw/.openclaw';
const SIGNAL_DIR   = path.join(OPENCLAW_ROOT, 'workspace', 'content-signal-radar');
const MEMORY_DIR   = path.join(OPENCLAW_ROOT, 'workspace', 'memory');
const DOCS_DIR     = path.join(OPENCLAW_ROOT, 'workspace', 'docs'); // 整理文档目录（可选）
const GATEWAY_URL  = process.env.GATEWAY_URL || 'http://localhost:18789';

// Dashboard 自维护的归档目录（简化方案，不污染 OpenClaw workspace）
const DATA_DIR               = path.join(__dirname, 'data');
const DATA_SIGNALS_ARCHIVE   = path.join(DATA_DIR, 'signals-archive');
const DATA_CRON_RUNS         = path.join(DATA_DIR, 'cron-runs');
const DATA_BOTS_STATUS       = path.join(DATA_DIR, 'bots-status.json');
[DATA_DIR, DATA_SIGNALS_ARCHIVE, DATA_CRON_RUNS].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Helpers ───────────────────────────────────────────────
function getGatewayToken() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(OPENCLAW_ROOT, 'openclaw.json'), 'utf8'));
    return cfg?.gateway?.auth?.token || null;
  } catch (e) { return null; }
}

async function gatewayHealth() {
  try {
    const r = await fetch(`${GATEWAY_URL}/health`, { timeout: 2000 });
    const j = await r.json();
    return j.ok === true;
  } catch (e) { return false; }
}

function safeReadJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// Static & JSON
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));

const AVATARS_DIR = path.join(__dirname, 'public', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

// ─── API: Bots ────────────────────────────────────────────
app.get('/api/bots', async (req, res) => {
  if (USE_MOCK) return res.json(mockData.mockBots());

  const bots = [
    { id: 'main',      name: '老大',       codename: 'main',      model: 'Claude Opus 4.6',    role: '总指挥',   channel: 'telegram' },
    { id: 'content',   name: '洗脑专家',   codename: 'content',   model: 'Claude Opus 4.6',    role: '内容创作', channel: 'telegram' },
    { id: 'tech',      name: '键盘杀手',   codename: 'tech',      model: 'Claude Sonnet 4.6',  role: '技术运维', channel: 'telegram' },
    { id: 'intel',     name: '线人',       codename: 'intel',     model: 'Claude Sonnet 4.6',  role: '情报收集', channel: 'telegram' },
    { id: 'assistant', name: '跟班',       codename: 'assistant', model: 'Ling 2.6 1T',        role: '杂活',     channel: 'telegram' },
  ];

  const gatewayOnline = await gatewayHealth();

  // 从最近日志推断 lastSeen
  let sessionMap = {};
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, 3);
    for (const f of files) {
      const content = fs.readFileSync(path.join(MEMORY_DIR, f), 'utf8');
      bots.forEach((b) => {
        if (!sessionMap[b.id] && content.toLowerCase().includes(b.codename)) {
          sessionMap[b.id] = f.replace('.md', '');
        }
      });
    }
  } catch (e) {}

  // 读 OpenClaw 推送过来的运行时状态（由 cron job 主动 POST /api/bots/status 写入）
  const runtimeMap = {};
  const runtimeData = safeReadJson(DATA_BOTS_STATUS, null);
  if (runtimeData && Array.isArray(runtimeData.bots)) {
    runtimeData.bots.forEach((b) => { runtimeMap[b.id] = b; });
  }

  // 顺手拉一次 usage，把 per-bot 的 todayTokens 合并到每张卡（失败不影响主流程）
  const tokenMap = {};
  try {
    const token = getGatewayToken();
    if (token) {
      const r = await fetch(`${GATEWAY_URL}/api/usage`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 2000,
      });
      if (r.ok) {
        const j = await r.json();
        const botsArr = (j.usage && j.usage.bots) || j.bots || [];
        botsArr.forEach((b) => { tokenMap[b.id] = b; });
      }
    }
  } catch (e) {}

  const result = bots.map((b) => {
    const rt = runtimeMap[b.id] || {};
    const tk = tokenMap[b.id] || {};
    return {
      ...b,
      avatarUrl: `/avatars/bot-${b.id}.png`,
      online: gatewayOnline,
      status: rt.status || (gatewayOnline ? 'online' : 'offline'),
      currentTask: rt.currentTask || null,
      lastTaskName: rt.lastTaskName || null,
      lastTaskTime: rt.lastTaskTime || null,
      lastTaskStatus: rt.lastTaskStatus || 'unknown',
      weekTasks: rt.weekTasks || 0,
      todayTokens: tk.todayTokens != null ? tk.todayTokens : null,
      lastSeen: rt.lastSeen || (sessionMap[b.id] ? sessionMap[b.id] + ' (log)' : (gatewayOnline ? '活跃中' : '离线')),
      statusUpdatedAt: runtimeData ? runtimeData.updatedAt : null,
    };
  });

  res.json({ ok: true, bots: result, gatewayOnline });
});

// ─── API: Bots Status（OpenClaw 主动推送，只写不读）────────
app.post('/api/bots/status', (req, res) => {
  const { bots: incoming } = req.body || {};
  if (!Array.isArray(incoming)) return res.status(400).json({ ok: false, error: 'bots array required' });
  const record = {
    updatedAt: new Date().toISOString(),
    bots: incoming,
  };
  try {
    fs.writeFileSync(DATA_BOTS_STATUS, JSON.stringify(record, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── API: Cron Jobs ───────────────────────────────────────
app.get('/api/cron', async (req, res) => {
  if (USE_MOCK) return res.json(mockData.mockCron());

  const token = getGatewayToken();
  const cronDefs = [
    { id: 'daily-log',     name: '每日会话自动日志',      schedule: '01:00', emoji: '📝', botId: 'assistant' },
    { id: 'daily-brief',   name: '每日简报',               schedule: '10:00', emoji: '📊', botId: 'main' },
    { id: 'update-check',  name: 'OpenClaw 更新检查',      schedule: '10:00', emoji: '🔄', botId: 'tech' },
    { id: 'signal-radar',  name: 'Content Signal Radar',  schedule: '15:30', emoji: '📡', botId: 'intel' },
    { id: 'soul-check',    name: '每日灵魂拷问',            schedule: '21:00', emoji: '🧠', botId: 'content' },
    { id: 'daily-english', name: '每日地道美语',            schedule: '21:10', emoji: '🇺🇸', botId: 'content' },
  ];

  // 尝试从 gateway 获取
  let gatewayJobs = {};
  if (token) {
    try {
      for (const ep of ['/api/cron/jobs', '/api/crons', '/api/schedule']) {
        const r = await fetch(`${GATEWAY_URL}${ep}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 2000,
        });
        if (r.ok) {
          const j = await r.json();
          const list = Array.isArray(j) ? j : (j.jobs || []);
          list.forEach((job) => { gatewayJobs[job.id || job.name] = job; });
          break;
        }
      }
    } catch (e) {}
  }

  const scheduleTime = (t) => {
    const [h, m] = t.split(':').map(Number);
    const now = new Date();
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const getLastRun = (t) => { const d = scheduleTime(t); if (d > new Date()) d.setDate(d.getDate() - 1); return d.toISOString(); };
  const getNextRun = (t) => { const d = scheduleTime(t); if (d <= new Date()) d.setDate(d.getDate() + 1); return d.toISOString(); };

  const jobs = cronDefs.map((def) => {
    const gw = gatewayJobs[def.id] || gatewayJobs[def.name] || {};
    return {
      ...def,
      status:  gw.lastStatus || gw.status   || 'unknown',
      lastRun: gw.lastRun    || gw.last_run || getLastRun(def.schedule),
      nextRun: gw.nextRun    || gw.next_run || getNextRun(def.schedule),
      enabled: gw.enabled !== false,
    };
  });

  res.json({ ok: true, jobs });
});

// ─── API: Cron 运行历史 ────────────────────────────────────
app.get('/api/cron/:jobId/runs', (req, res) => {
  const { jobId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 10, 50);

  if (USE_MOCK) return res.json(mockData.mockCronRuns(jobId, limit));

  // 真实：读 Dashboard 自维护的 data/cron-runs/{jobId}/*.json 归档
  const jobDir = path.join(DATA_CRON_RUNS, jobId);
  if (!fs.existsSync(jobDir)) return res.json({ ok: true, jobId, runs: [] });

  try {
    const files = fs.readdirSync(jobDir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit);
    const runs = files.map((f) => safeReadJson(path.join(jobDir, f))).filter(Boolean);
    res.json({ ok: true, jobId, runs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST 接口：OpenClaw gateway 跑完任务后回写到这里归档（简化方案的入口）
app.post('/api/cron/:jobId/runs', (req, res) => {
  const { jobId } = req.params;
  const { status = 'unknown', output = '', startedAt, durationMs } = req.body || {};
  const jobDir = path.join(DATA_CRON_RUNS, jobId);
  if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });

  const ts = (startedAt && new Date(startedAt).toISOString()) || new Date().toISOString();
  const fileName = ts.replace(/[:]/g, '-') + '.json';
  const record = {
    id: `${jobId}-${ts.slice(0, 10)}`,
    jobId,
    startedAt: ts,
    durationMs: durationMs || null,
    status,
    output,
  };
  try {
    fs.writeFileSync(path.join(jobDir, fileName), JSON.stringify(record, null, 2), 'utf8');
    res.json({ ok: true, record });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── API: Signals（当前）─────────────────────────────────
//
// 数据源优先级（见 PROJECT.md §7.3）：
//   1. 主源 dashboard-signals.json（prepare-digest.js 产出）
//      - 含 blog + x + podcast 的高信号，无需 API key
//      - 只要文件存在，对应的 source 就不再读兜底
//   2. 兜底 feed-{blogs,x,podcasts}.json（generate-feed.js 产出）
//      - 只在"主源里这个 source 没数据"时补位
//      - 例如主源只有 blog+x，podcast 就会从 feed-podcasts.json 读

// 抽成共用函数，方便 /api/signals 和 /api/signals/history 的"今日实时"复用
function liveSignalsAll() {
  const all = [];
  const covered = new Set();

  const dashData = safeReadJson(path.join(SIGNAL_DIR, 'dashboard-signals.json'), null);
  if (dashData && Array.isArray(dashData.signals)) {
    dashData.signals.forEach((item) => {
      all.push({
        id: item.id || item.url,
        source: item.source,
        sourceName: item.sourceName || item.handle || '',
        title: item.title,
        url: item.url,
        summary: item.summary || '',
        reason: item.reviewNote || (item.topic ? `[${item.topic}]` : '高信号内容'),
        score: item.score || 70,
        publishedAt: item.publishedAt || dashData.generatedAt,
        generatedAt: dashData.generatedAt,
        needsReview: item.needsReview || false,
      });
      if (item.source) covered.add(item.source);
    });
  }

  const readFallback = (src, fname, key, mapFn) => {
    if (covered.has(src)) return;
    const data = safeReadJson(path.join(SIGNAL_DIR, fname), null);
    if (!data || !Array.isArray(data[key])) return;
    data[key].forEach((item) => all.push(mapFn(item, data)));
  };

  readFallback('blog', 'feed-blogs.json', 'blogs', (item, data) => ({
    id: item.url, source: 'blog', sourceName: item.name || 'Blog',
    title: item.title, url: item.url,
    summary: item.description || (item.content ? item.content.slice(0, 200) + '...' : ''),
    reason: item.aiReason || '高质量技术内容', score: item.score || 70,
    publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));
  readFallback('x', 'feed-x.json', 'x', (item, data) => ({
    id: item.id || item.url, source: 'x', sourceName: item.author || 'X',
    title: (item.text || 'Tweet').slice(0, 80), url: item.url,
    summary: item.text || '', reason: item.aiReason || '热门讨论',
    score: item.score || 65, publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));
  readFallback('podcast', 'feed-podcasts.json', 'podcasts', (item, data) => ({
    id: item.url || item.title, source: 'podcast', sourceName: item.show || 'Podcast',
    title: item.title, url: item.url,
    summary: item.description ? item.description.slice(0, 200) + '...' : '',
    reason: item.aiReason || '深度内容', score: item.score || 70,
    publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));

  all.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return all;
}

app.get('/api/signals', (req, res) => {
  const source = req.query.source || 'all';
  if (USE_MOCK) return res.json(mockData.mockSignals(source));

  const all = liveSignalsAll();

  // ── 归档用全量（不被 source 过滤影响）──────────────────
  if (all.length) {
    const key = todayKey();
    const archiveFile = path.join(DATA_SIGNALS_ARCHIVE, `${key}.json`);
    try {
      fs.writeFileSync(archiveFile, JSON.stringify({ date: key, signals: all }, null, 2), 'utf8');
    } catch (e) {}
  }

  // ── 应用 source 过滤后返给前端 ─────────────────────────
  const filtered = source === 'all' ? all : all.filter((s) => s.source === source);
  res.json({ ok: true, signals: filtered, total: filtered.length });
});

// ─── API: Signals 历史归档 ────────────────────────────────
// 从 data/signals-archive/*.json 读近 N 天。
// 兼容历史脏数据：按 id 去重一次（旧版本双读 bug 可能导致重复入库）。
// 今日实时：尝试调自身 /api/signals 拿"今日最新快照"作为第一天，这样"今日"不必依赖当天是否被访问过。
app.get('/api/signals/history', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 30);
  if (USE_MOCK) return res.json(mockData.mockSignalsHistory(days));

  try {
    const files = fs.readdirSync(DATA_SIGNALS_ARCHIVE)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    const byDate = new Map();
    for (const f of files) {
      const data = safeReadJson(path.join(DATA_SIGNALS_ARCHIVE, f));
      if (!data || !Array.isArray(data.signals)) continue;
      // 按 id 去重（防御旧脏数据）
      const seen = new Set();
      const uniq = data.signals.filter((s) => {
        const k = s.id || s.url || s.title;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      byDate.set(data.date || f.replace('.json', ''), uniq);
    }

    // 今日实时拼进去（如果归档里没有今天或今天条数少于最新）
    const today = todayKey();
    try {
      const live = await liveSignalsAll();
      if (live.length) {
        const existing = byDate.get(today) || [];
        // 取最多的那一份作为今日
        byDate.set(today, live.length >= existing.length ? live : existing);
      }
    } catch (e) {}

    const list = [...byDate.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, days)
      .map(([date, signals]) => ({ date, signals }));

    res.json({ ok: true, days: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── API: Usage / Subscription ───────────────────────────
// /api/subscription  → ZenMux subscription/detail（配额窗口+计费周期）
// /api/usage         → ZenMux timeseries（模型分布，按计费周期）

const ZENMUX_MGMT_KEY = process.env.ZENMUX_MGMT_KEY;
const ZENMUX_SUBSCRIPTION_URL = 'https://zenmux.ai/api/v1/management/subscription/detail';
const ZENMUX_TIMESERIES_URL   = 'https://zenmux.ai/api/v1/management/statistics/timeseries';

async function fetchSubscription() {
  if (!ZENMUX_MGMT_KEY) throw new Error('ZENMUX_MGMT_KEY not set');
  const r = await fetch(ZENMUX_SUBSCRIPTION_URL, {
    headers: { Authorization: `Bearer ${ZENMUX_MGMT_KEY}` },
    timeout: 5000,
  });
  if (!r.ok) throw new Error(`ZenMux subscription API error: ${r.status}`);
  const j = await r.json();
  if (!j.success) throw new Error('ZenMux subscription API returned success=false');
  return j.data; // { plan, quota_5_hour, quota_7_day, quota_monthly, ... }
}

async function fetchZenMuxUsage() {
  if (!ZENMUX_MGMT_KEY) throw new Error('ZENMUX_MGMT_KEY not set');

  // 先拿 subscription 获取计费周期起点
  const sub = await fetchSubscription();

  const expiresAt = new Date(sub.plan.expires_at);

  // 计费周期起点：expires_at 往前推一个月再往前 1 天（避免 T+1 延迟导致起始当天数据空）
  const periodStart = new Date(expiresAt);
  periodStart.setMonth(periodStart.getMonth() - 1);
  periodStart.setDate(periodStart.getDate() - 1);
  const periodStartISO = periodStart.toISOString();
  // ending_at 用明天，确保当天数据都纳入
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nowISO = tomorrow.toISOString();

  const headers = { Authorization: `Bearer ${ZENMUX_MGMT_KEY}` };

  // ZenMux 的 tokens metric 返回空；改用 cost（值单位 millicents，/100000 = USD）
  const tsRes = await fetch(
    `${ZENMUX_TIMESERIES_URL}?metric=cost&bucket_width=1d&starting_at=${encodeURIComponent(periodStartISO)}&ending_at=${encodeURIComponent(nowISO)}`,
    { headers, timeout: 5000 }
  );
  if (!tsRes.ok) throw new Error(`ZenMux timeseries API error: ${tsRes.status}`);
  const tsData = await tsRes.json();

  // ZenMux 格式: { success, data: { series: [{ period, date, models: [{ model, label, value }] }] } }
  const getSeries = (resp) =>
    (resp && resp.data && Array.isArray(resp.data.series)) ? resp.data.series : [];

  // value = millicents → USD = / 100000
  const MC_TO_USD = 100000;

  const totalRaw = getSeries(tsData).reduce((acc, bucket) =>
    acc + (bucket.models || []).reduce((s, m) => s + (m.value || 0), 0), 0);
  const totalUSD = (totalRaw / MC_TO_USD).toFixed(2);

  // 按 model 拆分
  const modelMap = {};
  getSeries(tsData).forEach((bucket) => {
    (bucket.models || []).forEach((m) => {
      const slug = m.model === '__others__' ? 'others' : m.model;
      if (!modelMap[slug]) modelMap[slug] = { raw: 0, label: m.label || slug };
      modelMap[slug].raw += (m.value || 0);
    });
  });

  const models = Object.entries(modelMap)
    .map(([id, { raw, label }]) => ({
      id,
      model: label,
      costUSD: parseFloat((raw / MC_TO_USD).toFixed(4)),
      pct: Math.round((raw / (totalRaw || 1)) * 100),
    }))
    .sort((a, b) => b.costUSD - a.costUSD)
    .slice(0, 10);

  // 格式化计费周期标签（Asia/Shanghai 展示）
  const fmtDate = (d) => {
    const sh = new Date(d.getTime() + 8 * 3600 * 1000);
    return `${sh.getUTCFullYear()}-${String(sh.getUTCMonth()+1).padStart(2,'0')}-${String(sh.getUTCDate()).padStart(2,'0')}`;
  };
  const statPeriod = `${fmtDate(periodStart)} → ${fmtDate(expiresAt)}`;

  return {
    totalUSD,
    statPeriod,
    timezone: 'Asia/Shanghai',
    models,
    bots: [],
    subscription: sub,
  };
}

// /api/subscription：单独暴露配额窗口数据（前端迷你卡直接调）
app.get('/api/subscription', async (req, res) => {
  if (USE_MOCK) {
    return res.json({ ok: true, data: mockData.mockSubscription ? mockData.mockSubscription() : null });
  }
  try {
    const data = await fetchSubscription();
    return res.json({ ok: true, data });
  } catch (e) {
    console.warn('[subscription] failed:', e.message);
    return res.json({ ok: false, error: e.message });
  }
});

app.get('/api/usage', async (req, res) => {
  if (USE_MOCK) return res.json(mockData.mockUsage());

  try {
    const usage = await fetchZenMuxUsage();
    return res.json({ ok: true, usage, source: 'zenmux' });
  } catch (e) {
    console.warn('[usage] ZenMux API failed:', e.message);
  }

  return res.json({
    ok: true,
    notConnected: true,
    reason: 'ZenMux API 调用失败，请检查 ZENMUX_MGMT_KEY 配置',
  });
});

// ─── API: Docs ────────────────────────────────────────────
// type=memory（会话日志，来自 workspace/memory/*.md）
// type=docs  （整理文档，来自 workspace/docs/*.md；可按 bot 过滤）
app.get('/api/docs', (req, res) => {
  const type = req.query.type || 'memory';
  const bot  = req.query.bot  || null;

  if (USE_MOCK) return res.json(mockData.mockDocs(type, bot));

  if (type === 'memory') {
    // memory: 按日期命名的 md 文件
    const list = [];
    try {
      const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md')).sort().reverse();
      for (const f of files) {
        const full = path.join(MEMORY_DIR, f);
        const st = fs.statSync(full);
        list.push({
          id: 'memory-' + f.replace('.md', ''),
          type: 'memory',
          title: f.replace('.md', '') + ' · 聊天底',
          botId: null,
          createdAt: st.mtime.toISOString(),
          size: st.size,
        });
      }
    } catch (e) {}
    res.json({ ok: true, docs: list });
    return;
  }

  if (type === 'docs') {
    // docs: 约定 workspace/docs/{botId}/*.md
    const list = [];
    try {
      if (!fs.existsSync(DOCS_DIR)) { res.json({ ok: true, docs: [] }); return; }
      const botDirs = bot && bot !== 'all' ? [bot] : fs.readdirSync(DOCS_DIR);
      for (const bid of botDirs) {
        const dir = path.join(DOCS_DIR, bid);
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
        for (const f of files) {
          const full = path.join(dir, f);
          const st = fs.statSync(full);
          list.push({
            id: `d-${bid}-${f.replace('.md', '')}`,
            type: 'docs',
            title: f.replace('.md', ''),
            botId: bid,
            createdAt: st.mtime.toISOString(),
            size: st.size,
            _path: full, // 用于后续读取
          });
        }
      }
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {}
    res.json({ ok: true, docs: list.map(({ _path, ...rest }) => rest) });
    return;
  }

  res.status(400).json({ ok: false, error: 'unknown type' });
});

// 读单个文档内容
app.get('/api/docs/:id', (req, res) => {
  const { id } = req.params;
  if (USE_MOCK) return res.json(mockData.mockDocContent(id));

  try {
    if (id.startsWith('memory-')) {
      const date = id.replace('memory-', '');
      const full = path.join(MEMORY_DIR, `${date}.md`);
      const body = fs.readFileSync(full, 'utf8');
      return res.json({ ok: true, id, body });
    }
    if (id.startsWith('d-')) {
      // d-{botId}-{filename}
      const rest = id.slice(2);
      const sepIdx = rest.indexOf('-');
      const botId = rest.slice(0, sepIdx);
      const fname = rest.slice(sepIdx + 1);
      const full = path.join(DOCS_DIR, botId, `${fname}.md`);
      const body = fs.readFileSync(full, 'utf8');
      return res.json({ ok: true, id, body });
    }
    res.status(404).json({ ok: false, error: 'not found' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Settings ─────────────────────────────────────────────
app.post('/api/settings/bots', (req, res) => {
  try {
    const { bots } = req.body || {};
    if (!Array.isArray(bots)) return res.status(400).json({ ok: false, error: 'invalid payload' });
    fs.writeFileSync(path.join(__dirname, 'public', 'bot-settings.json'), JSON.stringify({ bots }, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Avatar upload — 保留兼容，但现在头像主要靠固定文件
if (multer) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
    filename: (req, _file, cb) => cb(null, `bot-${req.params.botId}.png`),
  });
  const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });
  app.post('/api/settings/avatar/:botId', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    res.json({ ok: true, path: `/avatars/bot-${req.params.botId}.png` });
  });
}

// ─── Health ───────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, mock: USE_MOCK }));

app.listen(PORT, HOST, () => {
  console.log(`🏴‍☠️  老巢控制台 running at http://${HOST}:${PORT}`);
});
