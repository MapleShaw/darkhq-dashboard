/**
 * lib/config.js
 * 路径常量、共享 helpers，供各 routes/ 模块 require
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── OpenClaw Workspace Paths ──────────────────────────────
const OPENCLAW_ROOT = process.env.OPENCLAW_ROOT || '/home/openclaw/.openclaw';
const SIGNAL_DIR    = path.join(OPENCLAW_ROOT, 'workspace', 'content-signal-radar');
const MEMORY_DIR    = path.join(OPENCLAW_ROOT, 'workspace', 'memory');
const DOCS_DIR      = path.join(OPENCLAW_ROOT, 'workspace', 'docs');
const GATEWAY_URL   = process.env.GATEWAY_URL || 'http://localhost:18789';

// Dashboard 自维护的归档目录
const DATA_DIR             = path.join(__dirname, '..', 'data');
const DATA_SIGNALS_ARCHIVE = path.join(DATA_DIR, 'signals-archive');
const DATA_CRON_RUNS       = path.join(DATA_DIR, 'cron-runs');
const DATA_BOTS_STATUS     = path.join(DATA_DIR, 'bots-status.json');
const GW_CRON_RUNS_DIR     = path.join(OPENCLAW_ROOT, 'cron', 'runs');

// ZenMux API
const ZENMUX_MGMT_KEY         = process.env.ZENMUX_MGMT_KEY;
const ZENMUX_SUBSCRIPTION_URL = 'https://zenmux.ai/api/v1/management/subscription/detail';
const ZENMUX_TIMESERIES_URL   = 'https://zenmux.ai/api/v1/management/statistics/timeseries';

// 确保数据目录存在
[DATA_DIR, DATA_SIGNALS_ARCHIVE, DATA_CRON_RUNS].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ── Helpers ───────────────────────────────────────────────
function safeReadJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getGatewayToken() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(OPENCLAW_ROOT, 'openclaw.json'), 'utf8'));
    return cfg?.gateway?.auth?.token || null;
  } catch (e) { return null; }
}

async function gatewayHealth() {
  const fetch = require('node-fetch');
  try {
    const r = await fetch(`${GATEWAY_URL}/health`, { timeout: 2000 });
    const j = await r.json();
    return j.ok === true;
  } catch (e) { return false; }
}

// cron job 短名 → Gateway UUID 映射（从 jobs.json 动态加载）
function getJobUuidMap() {
  const jobsFile = path.join(OPENCLAW_ROOT, 'cron', 'jobs.json');
  const raw = safeReadJson(jobsFile, []);
  const jobs = Array.isArray(raw) ? raw : (raw.jobs ? Object.entries(raw.jobs).map(([id, v]) => ({ id, ...v })) : []);
  const nameKeywords = {
    'daily-english': ['地道美语', '每日地道', 'english'],
    'soul-check':    ['灵魂拷问'],
    'daily-brief':   ['每日简报', '日报'],
    'daily-log':     ['会话', '日志', 'daily-log'],
    'signal-radar':  ['Signal Radar', 'signal-radar'],
    'update-check':  ['更新检查'],
    'bot-status':    ['bot-status'],
  };
  const result = {};
  for (const [shortId, keywords] of Object.entries(nameKeywords)) {
    const matched = jobs.find((j) =>
      (j.id && j.id === shortId) ||
      keywords.some((kw) => (j.name || '').toLowerCase().includes(kw.toLowerCase()))
    );
    if (matched && matched.id) result[shortId] = matched.id;
  }
  return result;
}

// 从 Gateway cron/runs/{uuid}.jsonl 读取真实运行历史
function readGatewayRuns(shortId, limit) {
  const uuidMap = getJobUuidMap();
  const uuid = uuidMap[shortId];
  if (!uuid) return [];
  const runsFile = path.join(GW_CRON_RUNS_DIR, `${uuid}.jsonl`);
  if (!fs.existsSync(runsFile)) return [];
  try {
    const lines = fs.readFileSync(runsFile, 'utf8').trim().split('\n').filter(Boolean);
    const finished = lines
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.action === 'finished')
      .reverse()
      .slice(0, limit);
    return finished.map((r) => ({
      id:         `${shortId}-${new Date(r.ts).toISOString().slice(0, 10)}`,
      jobId:      shortId,
      startedAt:  new Date(r.runAtMs || r.ts).toISOString(),
      durationMs: r.durationMs || null,
      status:     r.status === 'ok' ? 'success' : (r.status || 'unknown'),
      output:     r.summary || '',
    }));
  } catch (e) {
    return [];
  }
}

module.exports = {
  OPENCLAW_ROOT,
  SIGNAL_DIR,
  MEMORY_DIR,
  DOCS_DIR,
  GATEWAY_URL,
  DATA_DIR,
  DATA_SIGNALS_ARCHIVE,
  DATA_CRON_RUNS,
  DATA_BOTS_STATUS,
  GW_CRON_RUNS_DIR,
  ZENMUX_MGMT_KEY,
  ZENMUX_SUBSCRIPTION_URL,
  ZENMUX_TIMESERIES_URL,
  safeReadJson,
  todayKey,
  getGatewayToken,
  gatewayHealth,
  getJobUuidMap,
  readGatewayRuns,
};
