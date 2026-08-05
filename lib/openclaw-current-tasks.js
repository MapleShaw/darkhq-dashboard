/**
 * Read authoritative in-flight work from supported OpenClaw CLI commands.
 * The short cache and in-flight de-duplication keep dashboard refreshes from
 * spawning repeated CLI processes. Partial failures degrade to the source
 * that is still available instead of failing /api/bots.
 */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const configuredCli = process.env.OPENCLAW_CLI;
const OPENCLAW_CLI = configuredCli && configuredCli.includes('/') ? configuredCli : '/usr/bin/openclaw';
const configuredNodeBin = process.env.OPENCLAW_NODE_BIN;
const NODE24_BIN = configuredNodeBin && configuredNodeBin.includes('/')
  ? configuredNodeBin
  : '/home/openclaw/.nvm/versions/node/v24.18.0/bin';
const CACHE_TTL_MS = 30 * 1000;
// CLI reads run only in the background. This timeout is long enough for the
// current host (tasks list is ~9s) while still guaranteeing process cleanup.
const CLI_TIMEOUT_MS = 12 * 1000;
const MAX_BUFFER = 8 * 1024 * 1024;

let cache = { expiresAt: 0, tasks: {}, sources: {}, warnings: [] };
let inFlight = null;

function openclawEnv(env = process.env) {
  return { ...env, PATH: `${NODE24_BIN}:${env.PATH || ''}` };
}

function listFromMaybe(raw, key) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.[key])) return raw[key];
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}

function cleanLabel(value, fallback = 'OpenClaw 任务') {
  const text = String(value || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  return (text || fallback).slice(0, 60);
}

function normalizeTask(task) {
  if (!task || !['queued', 'running'].includes(task.status)) return null;
  const agentId = task.agentId || inferAgentId(task.childSessionKey || task.requesterSessionKey) || 'main';
  return {
    agentId,
    title: cleanLabel(task.label || task.task),
    status: task.status,
    startedAt: toIso(task.startedAt || task.createdAt),
    source: 'openclaw-task',
    sourceId: task.taskId || task.runId || null,
    cronJobId: task.runtime === 'cron' ? (task.sourceId || null) : null,
    runtime: task.runtime || null,
    runId: task.runId || task.sourceId || task.taskId || null,
    hasLabel: Boolean(String(task.label || '').trim()),
  };
}

function normalizeCron(job) {
  const state = job?.state || {};
  const startedAtMs = Number(state.runningAtMs || job?.runningAtMs);
  if (!job?.id || (job.status !== 'running' && !Number.isFinite(startedAtMs))) return null;
  return {
    agentId: job.agentId || 'main',
    title: cleanLabel(job.name, 'OpenClaw Cron'),
    status: 'running',
    startedAt: toIso(startedAtMs),
    source: 'openclaw-cron',
    sourceId: String(job.id),
    cronJobId: String(job.id),
  };
}

function inferAgentId(sessionKey) {
  const match = String(sessionKey || '').match(/^agent:([^:]+):/);
  return match ? match[1] : null;
}

function toIso(value) {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function deduplicateTasks(items) {
  const unique = new Map();
  const score = (item) => (item.hasLabel ? 4 : 0) +
    (item.runtime === 'subagent' ? 3 : item.runtime === 'cron' ? 2 : item.runtime === 'cli' ? 0 : 1);
  for (const item of items.filter(Boolean)) {
    const key = item.runId || item.sourceId || `${item.agentId}:${item.title}:${item.startedAt || ''}`;
    const current = unique.get(key);
    if (!current || score(item) > score(current)) unique.set(key, item);
  }
  return [...unique.values()];
}

function pickCurrent(items) {
  const result = {};
  const rank = { running: 2, queued: 1 };
  for (const item of items.filter(Boolean)) {
    const current = result[item.agentId];
    const itemTime = Date.parse(item.startedAt || '') || 0;
    const currentTime = Date.parse(current?.startedAt || '') || 0;
    if (!current || rank[item.status] > rank[current.status] ||
        (rank[item.status] === rank[current.status] && itemTime > currentTime)) {
      result[item.agentId] = item;
    }
  }
  return result;
}

async function runCli(args, options = {}) {
  const runner = options.execFileAsync || execFileAsync;
  const { stdout } = await runner(OPENCLAW_CLI, args, {
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    env: openclawEnv(options.env),
  });
  return JSON.parse(stdout);
}

async function fetchCurrentTasks(options = {}) {
  const [tasksResult, cronResult] = await Promise.allSettled([
    runCli(['tasks', 'list', '--json'], options),
    runCli(['cron', 'list', '--all', '--json', '--timeout', '10000'], options),
  ]);
  const warnings = [];
  let taskItems = [];
  let cronItems = [];

  if (tasksResult.status === 'fulfilled') {
    taskItems = deduplicateTasks(listFromMaybe(tasksResult.value, 'tasks').map(normalizeTask).filter(Boolean));
  } else {
    warnings.push(`tasks: ${String(tasksResult.reason?.message || tasksResult.reason).slice(0, 300)}`);
  }
  if (cronResult.status === 'fulfilled') {
    cronItems = listFromMaybe(cronResult.value, 'jobs').map(normalizeCron).filter(Boolean);
  } else {
    warnings.push(`cron: ${String(cronResult.reason?.message || cronResult.reason).slice(0, 300)}`);
  }
  if (warnings.length === 2) throw new Error(warnings.join('; '));

  // Cron tasks can appear in both ledgers. Prefer TaskFlow's richer record and
  // only use cron list as a gap-filling source.
  const taskCronIds = new Set(taskItems.map((item) => item.cronJobId).filter(Boolean));
  const items = [...taskItems, ...cronItems.filter((item) => !taskCronIds.has(item.cronJobId))];
  return {
    tasks: pickCurrent(items),
    sources: {
      tasks: { available: tasksResult.status === 'fulfilled', active: taskItems.length },
      cron: { available: cronResult.status === 'fulfilled', active: cronItems.length },
    },
    warnings,
  };
}

async function refreshCurrentTasks(options = {}) {
  if (inFlight) return inFlight;
  const now = options.now == null ? Date.now() : Number(options.now);
  const previous = cache;
  inFlight = fetchCurrentTasks(options).then((result) => {
    cache = { ...result, expiresAt: now + CACHE_TTL_MS, stale: false };
    return cache;
  }).catch((error) => {
    cache = {
      ...previous,
      expiresAt: now + CACHE_TTL_MS,
      stale: Boolean(previous.expiresAt || Object.keys(previous.tasks).length),
      warnings: [...(previous.warnings || []), String(error.message || error).slice(0, 500)],
    };
    return cache;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

function readCurrentTasks(options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  const expired = options.force || cache.expiresAt <= now;
  // Stale-while-revalidate: /api/bots always receives the current snapshot
  // immediately. Slow or unhealthy OpenClaw CLI calls never sit on its request
  // path; at worst currentTask is briefly absent or marked stale.
  if (expired && !inFlight) void refreshCurrentTasks(options);
  return {
    ...cache,
    cached: Boolean(cache.expiresAt),
    stale: Boolean(cache.stale),
    refreshing: Boolean(inFlight),
  };
}

function resetCache() {
  cache = { expiresAt: 0, tasks: {}, sources: {}, warnings: [] };
  inFlight = null;
}

module.exports = {
  CACHE_TTL_MS,
  cleanLabel,
  deduplicateTasks,
  fetchCurrentTasks,
  inferAgentId,
  listFromMaybe,
  normalizeCron,
  normalizeTask,
  openclawEnv,
  pickCurrent,
  readCurrentTasks,
  refreshCurrentTasks,
  resetCache,
};
