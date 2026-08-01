/**
 * routes/cron.js
 * GET  /api/cron
 * GET  /api/cron/:jobId/runs
 * POST /api/cron/:jobId/runs
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const fetch   = require('node-fetch');
const { execFile } = require('child_process');
const { promisify } = require('util');
const router  = express.Router();
const execFileAsync = promisify(execFile);

const {
  GATEWAY_URL,
  OPENCLAW_ROOT,
  DATA_CRON_RUNS,
  safeReadJson,
  getGatewayToken,
  readGatewayRuns,
} = require('../lib/config');

const BOT_LABELS = {
  main: '老大',
  content: '洗脑专家',
  tech: '键盘杀手',
  intel: '线人',
  assistant: '跟班',
};

const NODE24_BIN = '/home/openclaw/.nvm/versions/node/v24.18.0/bin';
const OPENCLAW_CLI = process.env.OPENCLAW_CLI || '/usr/bin/openclaw';

function openclawEnv() {
  const pathParts = [NODE24_BIN, process.env.PATH || ''].filter(Boolean);
  return {
    ...process.env,
    HOME: process.env.HOME || '/home/openclaw',
    USER: process.env.USER || 'openclaw',
    PATH: pathParts.join(':'),
  };
}

function firstExisting(files) {
  return files.find((file) => fs.existsSync(file)) || null;
}

function listFromMaybe(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.list)) return raw.list;
  if (raw?.jobs && typeof raw.jobs === 'object') {
    return Object.entries(raw.jobs).map(([id, value]) => ({ id, ...value }));
  }
  return [];
}

function normalizeModelValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.primary || value.model || value.id || value.name || null;
  return String(value);
}

function readOpenClawConfig() {
  return safeReadJson(path.join(OPENCLAW_ROOT, 'openclaw.json'), {}) || {};
}

function resolveAgentDefaultModel(agentId, cfg = readOpenClawConfig()) {
  const agents = cfg.agents || {};
  const agentList = Array.isArray(agents.list) ? agents.list : [];
  const agent = agentList.find((a) => a && a.id === agentId) || null;
  const agentModel = normalizeModelValue(agent?.model || agent?.defaultModel || agent?.defaults?.model);
  if (agentModel) return { model: agentModel, source: 'agent', sourceLabel: BOT_LABELS[agentId] || agentId || 'Agent' };

  const defaultModel = normalizeModelValue(agents.defaults?.model || cfg.defaults?.model || cfg.model);
  if (defaultModel) return { model: defaultModel, source: 'global', sourceLabel: '全局默认' };

  return { model: null, source: 'unknown', sourceLabel: '默认' };
}

function modelMeta(job, cfg) {
  const explicit = normalizeModelValue(job?.payload?.model || job?.model);
  if (explicit) {
    return {
      model: explicit,
      modelLabel: explicit,
      modelSource: 'explicit',
      modelInherited: false,
    };
  }

  const inherited = resolveAgentDefaultModel(job?.agentId || job?.botId, cfg);
  return {
    model: inherited.model,
    modelLabel: inherited.model ? `继承默认 · ${inherited.model}` : '继承默认',
    modelSource: inherited.source,
    modelInherited: true,
  };
}

function shortIdForJob(job) {
  const name = String(job?.name || '').toLowerCase();
  if (name.includes('地道美语') || name.includes('english')) return 'daily-english';
  if (name.includes('灵魂拷问')) return 'soul-check';
  if (name.includes('每日简报') || name.includes('日报')) return 'daily-brief';
  if (name.includes('会话') && name.includes('日志')) return 'daily-log';
  if (name.includes('signal radar') || name.includes('雷达')) return 'signal-radar';
  if (name.includes('rsshub')) return 'rsshub-warmup';
  if (name.includes('更新检查')) return 'update-check';
  if (name.includes('bot 状态') || name.includes('bot-status')) return 'bot-status';
  if (name.includes('系统健康')) return 'system-health';
  if (name.includes('ssl') || name.includes('证书')) return 'ssl-check';
  if (name.includes('cos') || name.includes('备份')) return 'cos-backup';
  if (name.includes('memory dreaming')) return 'memory-dreaming-promotion';
  if (name.includes('内容流水线')) return 'content-pipeline-draft';
  return job?.slug || job?.shortId || job?.id || name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cron-job';
}

function scheduleLabel(schedule) {
  if (!schedule) return '—';
  if (typeof schedule === 'string') return schedule;
  if (schedule.kind === 'cron') return schedule.expr || 'cron';
  if (schedule.kind === 'every' && schedule.everyMs) {
    const mins = Math.round(schedule.everyMs / 60000);
    if (mins < 60) return `每 ${mins} 分钟`;
    if (mins % 60 === 0) return `每 ${mins / 60} 小时`;
    return `每 ${mins} 分钟`;
  }
  return schedule.expr || schedule.kind || '—';
}

function inferEmoji(name = '') {
  const m = String(name).trim().match(/^\p{Extended_Pictographic}/u);
  if (m) return m[0];
  if (/brief|简报|日报/i.test(name)) return '📊';
  if (/update|更新/i.test(name)) return '🔄';
  if (/signal|雷达/i.test(name)) return '📡';
  if (/english|美语/i.test(name)) return '🇺🇸';
  if (/灵魂|soul/i.test(name)) return '🧠';
  if (/ssl|证书/i.test(name)) return '🔐';
  if (/backup|备份|cos/i.test(name)) return '☁️';
  if (/health|健康/i.test(name)) return '🔔';
  return '⚙';
}

function stateForJob(job, stateMap) {
  return stateMap[job.id]?.state || stateMap[job.id] || job.state || {};
}

function dateIsoFromMs(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function normalizeCronJobs(jobs, stateMap = {}, cfg = readOpenClawConfig()) {
  return jobs.map((job) => {
    const state = stateForJob(job, stateMap);
    const id = job.id || shortIdForJob(job);
    return {
      id,
      shortId: shortIdForJob(job),
      name: job.name || id,
      schedule: scheduleLabel(job.schedule),
      scheduleRaw: job.schedule || null,
      timezone: job.schedule?.tz || null,
      emoji: job.emoji || inferEmoji(job.name),
      botId: job.agentId || job.botId || null,
      status: state.lastRunStatus || state.lastStatus || job.lastRunStatus || job.lastStatus || job.status || 'unknown',
      lastRunStatus: state.lastRunStatus || state.lastStatus || job.lastRunStatus || job.lastStatus || job.status || 'unknown',
      runtimeStatus: job.status || state.status || null,
      lastRun: job.lastRun || dateIsoFromMs(job.lastRunAtMs || state.lastRunAtMs || state.lastStartedAtMs),
      nextRun: job.nextRun || dateIsoFromMs(job.nextRunAtMs || state.nextRunAtMs),
      enabled: job.enabled !== false,
      ...modelMeta(job, cfg),
    };
  });
}

async function loadLiveCronJobs() {
  try {
    const { stdout } = await execFileAsync(OPENCLAW_CLI, ['cron', 'list', '--all', '--json', '--timeout', '10000'], {
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
      env: openclawEnv(),
    });
    const raw = JSON.parse(stdout);
    const jobs = listFromMaybe(raw);
    return { jobs: jobs.length ? normalizeCronJobs(jobs) : [], error: null };
  } catch (err) {
    console.warn(`[cron] live list unavailable: ${err.message}`);
    return { jobs: [], error: err.message };
  }
}

function loadLocalCronJobs() {
  const jobsFile = firstExisting([
    path.join(OPENCLAW_ROOT, 'cron', 'jobs.json'),
    path.join(OPENCLAW_ROOT, 'cron', 'jobs.json.migrated'),
    path.join(OPENCLAW_ROOT, 'cron', 'jobs.json.bak'),
  ]);
  if (!jobsFile) return { jobs: [], files: [], stale: false };
  const jobs = listFromMaybe(safeReadJson(jobsFile, []));
  const stateFile = firstExisting([
    path.join(OPENCLAW_ROOT, 'cron', 'jobs-state.json'),
    path.join(OPENCLAW_ROOT, 'cron', 'jobs-state.json.migrated'),
  ]);
  const stateRaw = stateFile ? safeReadJson(stateFile, {}) : {};
  const stateMap = stateRaw.jobs || stateRaw || {};
  const files = [jobsFile, stateFile].filter(Boolean);
  const stale = files.some((file) => /\.(migrated|bak)$/.test(file));
  return { jobs: normalizeCronJobs(jobs, stateMap), files, stale };
}

// ─── GET /api/cron ────────────────────────────────────────
router.get('/api/cron', async (req, res) => {
  const { USE_MOCK, mockData } = req.app.locals;
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

  // Gateway/CLI 是当前 cron 配置的事实源；磁盘 migrated/bak 只作为显式陈旧快照兜底。
  const live = await loadLiveCronJobs();
  if (live.jobs.length) return res.json({ ok: true, jobs: live.jobs, source: 'gateway-cli', stale: false });

  // 尝试从 gateway HTTP 获取实时数据
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
          if (list.length) {
            return res.json({ ok: true, jobs: normalizeCronJobs(list), source: `gateway-http:${ep}`, stale: false });
          }
          list.forEach((job) => { gatewayJobs[job.id || job.name] = job; });
          break;
        }
      }
    } catch (e) {}
  }

  const local = loadLocalCronJobs();
  if (local.jobs.length) {
    return res.json({
      ok: true,
      jobs: local.jobs,
      source: 'local-stale-fallback',
      stale: true,
      sourceFiles: local.files,
      warning: `实时 Gateway/CLI 不可用，当前显示磁盘快照${local.stale ? '（migrated/bak，可能陈旧）' : ''}。${live.error ? `CLI: ${live.error}` : ''}`,
    });
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
    const merged = { ...def, ...gw, payload: gw.payload || def.payload || {} };
    return {
      ...def,
      status:  gw.lastRunStatus || gw.lastStatus || gw.status || 'unknown',
      lastRunStatus: gw.lastRunStatus || gw.lastStatus || gw.status || 'unknown',
      runtimeStatus: gw.status || null,
      lastRun: gw.lastRun || gw.last_run || null,
      nextRun: gw.nextRun || gw.next_run || null,
      enabled: gw.enabled !== false,
      ...modelMeta(merged, readOpenClawConfig()),
    };
  });

  res.json({
    ok: true,
    jobs,
    source: 'static-fallback',
    stale: true,
    warning: `实时 Gateway/CLI 和本地 cron 快照均不可用，当前仅显示 Dashboard 内置静态定义。${live.error ? `CLI: ${live.error}` : ''}`,
  });
});

// ─── GET /api/cron/:jobId/runs ────────────────────────────
router.get('/api/cron/:jobId/runs', (req, res) => {
  const { jobId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockCronRuns(jobId, limit));

  // 优先从 Gateway cron/runs/*.jsonl 读取
  const gwRuns = readGatewayRuns(jobId, limit);
  if (gwRuns.length > 0) {
    return res.json({ ok: true, jobId, runs: gwRuns });
  }

  // 兜底：读 Dashboard 自维护的 data/cron-runs/{jobId}/*.json 归档
  const jobDir = require('path').join(DATA_CRON_RUNS, jobId);
  if (!fs.existsSync(jobDir)) return res.json({ ok: true, jobId, runs: [] });

  try {
    const files = fs.readdirSync(jobDir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, limit);
    const runs = files.map((f) => safeReadJson(require('path').join(jobDir, f))).filter(Boolean);
    res.json({ ok: true, jobId, runs });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── POST /api/cron/:jobId/runs ───────────────────────────
router.post('/api/cron/:jobId/runs', (req, res) => {
  const { jobId } = req.params;
  const { status = 'unknown', output = '', startedAt, durationMs } = req.body || {};
  const path = require('path');
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

module.exports = router;
module.exports._test = { listFromMaybe, normalizeCronJobs, loadLocalCronJobs, openclawEnv };
