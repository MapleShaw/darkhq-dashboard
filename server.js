const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// multer is optional — avatar upload degrades gracefully if not installed
let multer = null;
try { multer = require('multer'); } catch(e) {}

const app = express();
const PORT = 9700;
const HOST = '0.0.0.0';

// Read gateway token
function getGatewayToken() {
  try {
    const cfg = JSON.parse(fs.readFileSync('/home/openclaw/.openclaw/openclaw.json', 'utf8'));
    return cfg?.gateway?.auth?.token || null;
  } catch (e) {
    return null;
  }
}

const SIGNAL_DIR = '/home/openclaw/.openclaw/workspace/content-signal-radar';

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Ensure avatars directory exists
const AVATARS_DIR = path.join(__dirname, 'public', 'avatars');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });

// ─── API: Bots ───────────────────────────────────────────────────────────────
app.get('/api/bots', async (req, res) => {
  const bots = [
    { id: 'main',      name: '老大',       codename: 'main',      model: 'Claude Opus 4.6',    role: '总指挥',   channel: 'telegram' },
    { id: 'content',   name: '洗脑专家',   codename: 'content',   model: 'Claude Opus 4.6',    role: '内容创作', channel: 'telegram' },
    { id: 'tech',      name: '键盘杀手',   codename: 'tech',      model: 'Claude Sonnet 4.6',  role: '技术运维', channel: 'telegram' },
    { id: 'intel',     name: '线人',       codename: 'intel',     model: 'Claude Sonnet 4.6',  role: '情报收集', channel: 'telegram' },
    { id: 'assistant', name: '跟班',       codename: 'assistant', model: 'Ling 2.6 1T',        role: '杂活',     channel: 'telegram' },
  ];

  // Try to get gateway health to determine if system is live
  const token = getGatewayToken();
  let gatewayOnline = false;
  try {
    const r = await fetch('http://localhost:18789/health', { timeout: 2000 });
    const j = await r.json();
    gatewayOnline = j.ok === true;
  } catch (e) {}

  // Read session logs to get last active times
  const logDir = '/home/openclaw/.openclaw/workspace/memory';
  let sessionMap = {};
  try {
    const files = fs.readdirSync(logDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 3);
    for (const f of files) {
      const content = fs.readFileSync(path.join(logDir, f), 'utf8');
      // Look for bot mentions
      bots.forEach(b => {
        if (!sessionMap[b.id] && content.toLowerCase().includes(b.codename)) {
          sessionMap[b.id] = f.replace('.md', '');
        }
      });
    }
  } catch (e) {}

  const result = bots.map(b => ({
    ...b,
    online: gatewayOnline,
    lastSeen: sessionMap[b.id] ? sessionMap[b.id] + ' (log)' : (gatewayOnline ? '活跃中' : '离线'),
  }));

  res.json({ ok: true, bots: result, gatewayOnline });
});

// ─── API: Cron Jobs ──────────────────────────────────────────────────────────
app.get('/api/cron', async (req, res) => {
  const token = getGatewayToken();

  // Static cron definitions
  const cronDefs = [
    { id: 'daily-log',     name: '每日会话自动日志',      schedule: '01:00', emoji: '📝' },
    { id: 'daily-brief',   name: '📊 每日简报',           schedule: '10:00', emoji: '📊' },
    { id: 'update-check',  name: 'OpenClaw 更新检查',     schedule: '10:00', emoji: '🔄' },
    { id: 'signal-radar',  name: '📡 Content Signal Radar', schedule: '15:30', emoji: '📡' },
    { id: 'soul-check',    name: '每日灵魂拷问',           schedule: '21:00', emoji: '🧠' },
    { id: 'daily-english', name: '🇺🇸 每日地道美语',       schedule: '21:10', emoji: '🇺🇸' },
  ];

  // Try gateway API (may return 404 for cron endpoint — handle gracefully)
  let gatewayJobs = {};
  if (token) {
    try {
      const endpoints = [
        '/api/cron/jobs',
        '/api/crons',
        '/api/schedule',
      ];
      for (const ep of endpoints) {
        const r = await fetch(`http://localhost:18789${ep}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 2000
        });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j)) {
            j.forEach(job => { gatewayJobs[job.id || job.name] = job; });
          } else if (j.jobs) {
            j.jobs.forEach(job => { gatewayJobs[job.id || job.name] = job; });
          }
          break;
        }
      }
    } catch (e) {}
  }

  // Calculate next run times
  function getNextRun(scheduleTime) {
    const now = new Date();
    const [h, m] = scheduleTime.split(':').map(Number);
    const next = new Date(now);
    next.setHours(h, m, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }

  function getLastRun(scheduleTime) {
    const now = new Date();
    const [h, m] = scheduleTime.split(':').map(Number);
    const last = new Date(now);
    last.setHours(h, m, 0, 0);
    if (last > now) last.setDate(last.getDate() - 1);
    return last.toISOString();
  }

  const jobs = cronDefs.map(def => {
    const gw = gatewayJobs[def.id] || gatewayJobs[def.name] || {};
    return {
      ...def,
      status: gw.lastStatus || gw.status || 'unknown',
      lastRun: gw.lastRun || gw.last_run || getLastRun(def.schedule),
      nextRun: gw.nextRun || gw.next_run || getNextRun(def.schedule),
      enabled: gw.enabled !== false,
    };
  });

  res.json({ ok: true, jobs });
});

// ─── API: Signals ────────────────────────────────────────────────────────────
app.get('/api/signals', (req, res) => {
  const source = req.query.source || 'all';
  const signals = [];

  // Read blogs feed
  try {
    const blogs = JSON.parse(fs.readFileSync(path.join(SIGNAL_DIR, 'feed-blogs.json'), 'utf8'));
    if (blogs.blogs) {
      blogs.blogs.forEach(item => {
        signals.push({
          id: item.url,
          source: 'blog',
          sourceName: item.name || 'Blog',
          title: item.title,
          url: item.url,
          summary: item.description || item.content?.slice(0, 200) + '...' || '',
          reason: item.aiReason || '高质量技术内容，值得跟踪',
          score: item.score || Math.floor(Math.random() * 30) + 70,
          publishedAt: item.publishedAt || blogs.generatedAt,
          generatedAt: blogs.generatedAt,
        });
      });
    }
  } catch (e) {}

  // Read X/Twitter feed
  try {
    const xfeed = JSON.parse(fs.readFileSync(path.join(SIGNAL_DIR, 'feed-x.json'), 'utf8'));
    if (xfeed.x) {
      xfeed.x.forEach(item => {
        signals.push({
          id: item.id || item.url,
          source: 'x',
          sourceName: item.author || 'X',
          title: item.text?.slice(0, 80) || 'Tweet',
          url: item.url,
          summary: item.text || '',
          reason: item.aiReason || '热门讨论，值得关注',
          score: item.score || Math.floor(Math.random() * 30) + 60,
          publishedAt: item.publishedAt || xfeed.generatedAt,
          generatedAt: xfeed.generatedAt,
        });
      });
    }
  } catch (e) {}

  // Read podcast feed
  try {
    const pods = JSON.parse(fs.readFileSync(path.join(SIGNAL_DIR, 'feed-podcasts.json'), 'utf8'));
    if (pods.podcasts) {
      pods.podcasts.forEach(item => {
        signals.push({
          id: item.url || item.title,
          source: 'podcast',
          sourceName: item.show || 'Podcast',
          title: item.title,
          url: item.url,
          summary: item.description?.slice(0, 200) + '...' || '',
          reason: item.aiReason || '深度内容，建议收听',
          score: item.score || Math.floor(Math.random() * 20) + 65,
          publishedAt: item.publishedAt || pods.generatedAt,
          generatedAt: pods.generatedAt,
        });
      });
    }
  } catch (e) {}

  // Filter by source if requested
  let filtered = signals;
  if (source !== 'all') {
    filtered = signals.filter(s => s.source === source);
  }

  // Sort by publishedAt desc
  filtered.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  res.json({ ok: true, signals: filtered, total: filtered.length });
});

// ─── API: Usage ─────────────────────────────────────────────────────────────
app.get('/api/usage', async (req, res) => {
  const MOCK = {
    ok: true,
    usage: {
      totalTokens: 284500,
      todayTokens: 12300,
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
      const r = await fetch('http://localhost:18789/api/usage', {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 2000,
      });
      if (r.ok) {
        const j = await r.json();
        if (j && (j.usage || j.totalTokens)) return res.json({ ok: true, usage: j.usage || j });
      }
    } catch (e) {}
  }

  return res.json(MOCK);
});

// ─── API: Settings – Save Bot Config ─────────────────────────────────────────
app.post('/api/settings/bots', (req, res) => {
  try {
    const { bots } = req.body || {};
    if (!Array.isArray(bots)) return res.status(400).json({ ok: false, error: 'invalid payload' });
    const dest = path.join(__dirname, 'public', 'bot-settings.json');
    fs.writeFileSync(dest, JSON.stringify({ bots }, null, 2), 'utf8');
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── API: Settings – Avatar Upload ───────────────────────────────────────────
if (multer) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATARS_DIR),
    filename: (req, _file, cb) => cb(null, `${req.params.botId}.jpg`),
  });
  const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

  app.post('/api/settings/avatar/:botId', upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'no file' });
    return res.json({ ok: true, path: `/avatars/${req.params.botId}.jpg` });
  });
} else {
  app.post('/api/settings/avatar/:botId', (_req, res) => {
    res.json({ ok: false, error: 'multer not available' });
  });
}

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, HOST, () => {
  console.log(`🏴‍☠️  老巢控制台 running at http://${HOST}:${PORT}`);
});
