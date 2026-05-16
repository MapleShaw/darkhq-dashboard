/**
 * routes/cron.js
 * GET  /api/cron
 * GET  /api/cron/:jobId/runs
 * POST /api/cron/:jobId/runs
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const fetch   = require('node-fetch');
const router  = express.Router();

const {
  GATEWAY_URL,
  DATA_CRON_RUNS,
  safeReadJson,
  getGatewayToken,
  readGatewayRuns,
} = require('../lib/config');

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
