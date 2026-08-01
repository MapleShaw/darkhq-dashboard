#!/usr/bin/env node
'use strict';

/**
 * DarkHQ unified task write-back adapter.
 *
 * Input: standard result JSON from any fleet bot.
 * Output: one cron run record + a merged bot runtime status update.
 *
 * Auth: Authorization: Bearer $DASHBOARD_TOKEN (or $DARKHQ_TOKEN).
 * Never prints tokens; all thrown errors are sanitized by cli().
 */

const fs = require('fs');

const ACTORS = new Set(['main', 'assistant', 'content', 'intel', 'tech']);
const STATUSES = new Set(['success', 'failed', 'needs_confirmation']);
const DEFAULT_BASE_URL = 'http://127.0.0.1:9700';

function parseArgs(argv) {
  const out = { baseUrl: DEFAULT_BASE_URL, input: null, jobId: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--input') out.input = argv[++i];
    else if (arg === '--base-url') out.baseUrl = argv[++i];
    else if (arg === '--job-id') out.jobId = argv[++i];
    else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function usage() {
  return [
    'Usage: DASHBOARD_TOKEN=... node scripts/darkhq-report.js --input result.json [--base-url http://127.0.0.1:9700] [--job-id actor-task-type]',
    '',
    'Required result fields: taskId, actor, taskType, status, summary, evidence[], artifacts[], blockers[], nextAction, startedAt, finishedAt or durationMs',
    'Allowed actors: main, assistant, content, intel, tech',
    'Allowed statuses: success, failed, needs_confirmation',
  ].join('\n');
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function deriveJobId(result) {
  return `${slugify(result.actor)}-${slugify(result.taskType)}`;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !value) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function requireArray(result, key) {
  if (!Array.isArray(result[key])) throw new Error(`Invalid result JSON: ${key} must be an array`);
}

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Invalid result JSON: root must be an object');
  }
  for (const key of ['taskId', 'actor', 'taskType', 'status', 'summary', 'nextAction', 'startedAt']) {
    if (typeof result[key] !== 'string' || result[key].trim() === '') {
      throw new Error(`Invalid result JSON: ${key} is required`);
    }
  }
  if (!ACTORS.has(result.actor)) throw new Error(`Invalid actor: ${result.actor}`);
  if (!STATUSES.has(result.status)) throw new Error(`Invalid status: ${result.status}`);
  for (const key of ['evidence', 'artifacts', 'blockers']) requireArray(result, key);
  if (!isIsoDate(result.startedAt)) throw new Error('Invalid result JSON: startedAt must be an ISO-8601 date');
  if (result.finishedAt != null && !isIsoDate(result.finishedAt)) {
    throw new Error('Invalid result JSON: finishedAt must be an ISO-8601 date when present');
  }
  if (result.durationMs != null && (!Number.isFinite(Number(result.durationMs)) || Number(result.durationMs) < 0)) {
    throw new Error('Invalid result JSON: durationMs must be a non-negative number when present');
  }
  if (!result.finishedAt && result.durationMs == null) {
    throw new Error('Invalid result JSON: either finishedAt or durationMs is required');
  }
  if (result.title != null && (typeof result.title !== 'string' || !result.title.trim())) {
    throw new Error('Invalid result JSON: title must be a non-empty string when present');
  }
  if (result.resolvedAt != null) {
    if (!isIsoDate(result.resolvedAt)) throw new Error('Invalid result JSON: resolvedAt must be an ISO-8601 date');
    if (!['success', 'failed'].includes(result.status)) throw new Error('Invalid result JSON: a resolution must end in success or failed');
    if (typeof result.resolutionSummary !== 'string' || !result.resolutionSummary.trim()) throw new Error('Invalid result JSON: resolutionSummary is required when resolvedAt is present');
  }
  return result;
}

function computeDurationMs(result) {
  if (result.durationMs != null) return Number(result.durationMs);
  return Math.max(0, Date.parse(result.finishedAt) - Date.parse(result.startedAt));
}

function toRunPayload(result) {
  const output = {
    taskId: result.taskId,
    actor: result.actor,
    taskType: result.taskType,
    title: result.title || null,
    summary: result.summary,
    evidence: result.evidence,
    artifacts: result.artifacts,
    blockers: result.blockers,
    nextAction: result.nextAction,
    finishedAt: result.finishedAt || null,
    resolvedAt: result.resolvedAt || null,
    resolutionSummary: result.resolutionSummary || null,
  };
  return {
    status: result.status,
    output: JSON.stringify(output, null, 2),
    startedAt: new Date(result.startedAt).toISOString(),
    durationMs: computeDurationMs(result),
  };
}

function taskTitle(result) {
  const labels = { darkhq_task_flow: '修复 DarkHQ 任务卡片', readonly_audit: '幽灵任务审计' };
  const base = String(result.title || labels[result.taskType] || result.taskType || '未命名任务').replace(/\s+/g, ' ').trim();
  return base.slice(0, 160);
}

function toRuntimeBot(bot, result, finishedIso) {
  return {
    ...bot,
    id: result.actor,
    lastTaskName: taskTitle(result),
    lastTaskTitle: taskTitle(result),
    lastTaskSummary: String(result.summary || '').slice(0, 4000),
    lastTaskType: result.taskType,
    lastTaskTime: finishedIso,
    lastTaskStatus: result.status,
    lastSeen: finishedIso,
    weekTasks: Number.isFinite(Number(bot && bot.weekTasks)) ? Number(bot.weekTasks) + 1 : 1,
  };
}

function mergeBots(existingBots, result) {
  if (!Array.isArray(existingBots)) throw new Error('GET /api/bots did not return bots array; refusing to overwrite status');
  const finishedIso = new Date(result.finishedAt || (Date.parse(result.startedAt) + computeDurationMs(result))).toISOString();
  let found = false;
  const merged = existingBots.map((bot) => {
    if (bot && bot.id === result.actor) {
      found = true;
      return toRuntimeBot(bot, result, finishedIso);
    }
    return bot;
  });
  if (!found) throw new Error(`GET /api/bots did not include actor ${result.actor}; refusing to overwrite status`);
  return merged;
}

function authToken(env = process.env) {
  return env.DASHBOARD_TOKEN || env.DARKHQ_TOKEN || '';
}

function redactSecrets(message, env = process.env) {
  let text = String(message == null ? '' : message);
  const secrets = [env.DASHBOARD_TOKEN, env.DARKHQ_TOKEN].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const secret of secrets) text = text.split(secret).join('[REDACTED]');
  text = text.replace(/Bearer\s+[^\s,}]+/gi, 'Bearer [REDACTED]');
  return text;
}

async function httpJson(fetchImpl, url, options, env) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (err) {
    throw new Error(`Request failed for ${url}: ${redactSecrets(err.message, env)}`);
  }
  const text = await response.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch (err) { json = { raw: text.slice(0, 500) }; }
  }
  if (!response.ok) {
    const detail = json && (json.error || json.message || json.raw) ? `: ${json.error || json.message || json.raw}` : '';
    throw new Error(`HTTP ${response.status} ${response.statusText || ''} for ${url}${redactSecrets(detail, env)}`.trim());
  }
  return json;
}

async function reportResult(result, options = {}) {
  validateResult(result);
  const env = options.env || process.env;
  const token = options.token || authToken(env);

  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation available (Node 18+ required)');

  const baseUrl = String(options.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const jobId = options.jobId || deriveJobId(result);
  const runPayload = toRunPayload(result);

  if (options.dryRun) {
    return { ok: true, dryRun: true, jobId, runPayload, botsPayload: null };
  }

  if (!token) throw new Error('Missing DASHBOARD_TOKEN or DARKHQ_TOKEN');
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const runResponse = await httpJson(fetchImpl, `${baseUrl}/api/cron/${encodeURIComponent(jobId)}/runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(runPayload),
  }, env);

  const botsResponse = await httpJson(fetchImpl, `${baseUrl}/api/bots`, { method: 'GET', headers }, env);
  const mergedBots = mergeBots(botsResponse && botsResponse.bots, result);
  const statusResponse = await httpJson(fetchImpl, `${baseUrl}/api/bots/status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ bots: mergedBots }),
  }, env);

  return {
    ok: true,
    jobId,
    run: runResponse && runResponse.record ? runResponse.record : runResponse,
    botsUpdated: mergedBots.length,
    actor: result.actor,
    statusResponse,
  };
}

async function cli(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (args.help || !args.input) {
    console.log(usage());
    return args.help ? 0 : 2;
  }
  const raw = fs.readFileSync(args.input, 'utf8');
  const result = validateResult(JSON.parse(raw));
  const response = await reportResult(result, {
    baseUrl: args.baseUrl,
    jobId: args.jobId,
    dryRun: args.dryRun,
    env,
  });
  console.log(JSON.stringify({ ok: true, jobId: response.jobId, actor: response.actor || result.actor, botsUpdated: response.botsUpdated || 0 }, null, 2));
  return 0;
}

if (require.main === module) {
  cli().then((code) => process.exit(code)).catch((err) => {
    console.error(redactSecrets(err && err.message ? err.message : err));
    process.exit(1);
  });
}

module.exports = {
  ACTORS,
  STATUSES,
  DEFAULT_BASE_URL,
  parseArgs,
  slugify,
  deriveJobId,
  validateResult,
  computeDurationMs,
  taskTitle,
  toRunPayload,
  mergeBots,
  redactSecrets,
  reportResult,
};
