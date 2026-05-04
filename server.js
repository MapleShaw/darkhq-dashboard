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

  const result = bots.map((b) => ({
    ...b,
    avatarUrl: `/avatars/bot-${b.id}.png`,
    online: gatewayOnline,
    status: gatewayOnline ? 'online' : 'offline',
    currentTask: null,                    // 线上：由 OpenClaw gateway 填入
    lastTaskName: null,
    lastTaskTime: null,
    lastTaskStatus: 'unknown',
    weekTasks: 0,
    lastSeen: sessionMap[b.id] ? sessionMap[b.id] + ' (log)' : (gatewayOnline ? '活跃中' : '离线'),
  }));

  res.json({ ok: true, bots: result, gatewayOnline });
});

// ─── API: Cron Jobs ───────────────────────────────────────
app.get('/api/cron', async (req, res) => {
  if (USE_MOCK) return res.json(mockData.mockCron());

  const token = getGatewayToken();
  const cronDefs = [
    { id: 'daily-log',     name: '每日会话自动日志',       schedule: '01:00', emoji: '📝', botId: 'assistant' },
    { id: 'daily-brief',   name: '📊 每日简报',            schedule: '10:00', emoji: '📊', botId: 'main' },
    { id: 'update-check',  name: 'OpenClaw 更新检查',      schedule: '10:00', emoji: '🔄', botId: 'tech' },
    { id: 'signal-radar',  name: '📡 Content Signal Radar', schedule: '15:30', emoji: '📡', botId: 'intel' },
    { id: 'soul-check',    name: '每日灵魂拷问',            schedule: '21:00', emoji: '🧠', botId: 'content' },
    { id: 'daily-english', name: '🇺🇸 每日地道美语',        schedule: '21:10', emoji: '🇺🇸', botId: 'content' },
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
app.get('/api/signals', (req, res) => {
  const source = req.query.source || 'all';
  if (USE_MOCK) return res.json(mockData.mockSignals(source));

  const signals = [];
  const readFeed = (fname, key, mapFn) => {
    try {
      const data = safeReadJson(path.join(SIGNAL_DIR, fname), null);
      if (data && data[key]) data[key].forEach((item) => signals.push(mapFn(item, data)));
    } catch (e) {}
  };

  readFeed('feed-blogs.json', 'blogs', (item, data) => ({
    id: item.url, source: 'blog', sourceName: item.name || 'Blog',
    title: item.title, url: item.url,
    summary: item.description || (item.content ? item.content.slice(0, 200) + '...' : ''),
    reason: item.aiReason || '高质量技术内容', score: item.score || 70,
    publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));
  readFeed('feed-x.json', 'x', (item, data) => ({
    id: item.id || item.url, source: 'x', sourceName: item.author || 'X',
    title: (item.text || 'Tweet').slice(0, 80), url: item.url,
    summary: item.text || '', reason: item.aiReason || '热门讨论',
    score: item.score || 65, publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));
  readFeed('feed-podcasts.json', 'podcasts', (item, data) => ({
    id: item.url || item.title, source: 'podcast', sourceName: item.show || 'Podcast',
    title: item.title, url: item.url,
    summary: item.description ? item.description.slice(0, 200) + '...' : '',
    reason: item.aiReason || '深度内容', score: item.score || 70,
    publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));

  let filtered = source === 'all' ? signals : signals.filter((s) => s.source === source);
  filtered.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  // 简化归档方案：每次读到新快照就存一份（按日）
  if (filtered.length) {
    const key = todayKey();
    const archiveFile = path.join(DATA_SIGNALS_ARCHIVE, `${key}.json`);
    try {
      fs.writeFileSync(archiveFile, JSON.stringify({ date: key, signals: filtered }, null, 2), 'utf8');
    } catch (e) {}
  }

  res.json({ ok: true, signals: filtered, total: filtered.length });
});

// ─── API: Signals 历史归档 ────────────────────────────────
app.get('/api/signals/history', (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 30);
  if (USE_MOCK) return res.json(mockData.mockSignalsHistory(days));

  try {
    const files = fs.readdirSync(DATA_SIGNALS_ARCHIVE)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, days);
    const list = files.map((f) => safeReadJson(path.join(DATA_SIGNALS_ARCHIVE, f))).filter(Boolean);
    res.json({ ok: true, days: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── API: Usage ───────────────────────────────────────────
app.get('/api/usage', async (req, res) => {
  if (USE_MOCK) return res.json(mockData.mockUsage());

  const fallback = {
    ok: true,
    usage: {
      totalTokens: 284500, todayTokens: 12300,
      models: [
        { model: 'Claude Opus 4.6',   tokens: 142000, pct: 50 },
        { model: 'Claude Sonnet 4.6', tokens: 85350,  pct: 30 },
        { model: 'Ling 2.6 1T',       tokens: 57150,  pct: 20 },
      ],
    },
  };

  const token = getGatewayToken();
  if (token) {
    try {
      const r = await fetch(`${GATEWAY_URL}/api/usage`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 2000,
      });
      if (r.ok) {
        const j = await r.json();
        if (j && (j.usage || j.totalTokens)) return res.json({ ok: true, usage: j.usage || j });
      }
    } catch (e) {}
  }
  res.json(fallback);
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
