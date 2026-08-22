/**
 * Read live OpenClaw cron history through the supported CLI and normalize it
 * for DarkHQ's task-run timeline. Results are cached to avoid spawning one
 * CLI process per page refresh.
 */
'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');
const { normalizeRun } = require('./task-runs');

const execFileAsync = promisify(execFile);
const configuredCli = process.env.OPENCLAW_CLI;
const OPENCLAW_CLI = configuredCli && configuredCli.includes('/') ? configuredCli : '/usr/bin/openclaw';
const configuredNodeBin = process.env.OPENCLAW_NODE_BIN;
const NODE24_BIN = configuredNodeBin && configuredNodeBin.includes('/')
  ? configuredNodeBin
  : '/home/openclaw/.nvm/versions/node/v24.18.0/bin';
const CACHE_TTL_MS = 60 * 1000;
const CLI_TIMEOUT_MS = 15 * 1000;
const MAX_BUFFER = 8 * 1024 * 1024;
const HISTORY_CONCURRENCY = 4;

let cache = { expiresAt: 0, runs: [], jobs: 0, errors: [] };
let inFlight = null;

function openclawEnv(env = process.env) {
  return { ...env, PATH: `${NODE24_BIN}:${env.PATH || ''}` };
}

function listFromMaybe(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.jobs)) return raw.jobs;
  if (Array.isArray(raw?.list)) return raw.list;
  return [];
}

function entriesFromMaybe(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.entries)) return raw.entries;
  if (Array.isArray(raw?.runs)) return raw.runs;
  return [];
}

function nativeRunKey(run) {
  return `${run.jobId || ''}|${run.startedAt || ''}|${run.status || ''}`;
}

function normalizeNativeRun(entry, job) {
  if (!entry || typeof entry !== 'object' || !job?.id) return null;
  const startedMs = Number(entry.runAtMs || entry.startedAtMs || entry.ts);
  const startedAt = Number.isFinite(startedMs) ? new Date(startedMs).toISOString() : null;
  if (!startedAt) return null;
  const status = entry.action && entry.action !== 'finished' ? 'running' : entry.status;
  const summary = entry.summary || entry.error || '';
  const run = normalizeRun({
    id: `openclaw-cron-${entry.runId || entry.sessionId || `${job.id}-${startedMs}`}`,
    jobId: String(job.id),
    actor: job.agentId || 'main',
    taskType: 'openclaw_cron',
    title: job.name || 'OpenClaw Cron',
    status,
    summary,
    output: summary,
    startedAt,
    finishedAt: entry.action === 'finished' && Number.isFinite(Number(entry.ts))
      ? new Date(Number(entry.ts)).toISOString()
      : null,
    durationMs: entry.durationMs,
  });
  if (!run) return null;
  return {
    ...run,
    source: 'openclaw-cron',
    nativeRunId: entry.runId || null,
    sessionId: entry.sessionId || null,
    model: entry.model || null,
    provider: entry.provider || null,
    completionKnown: entry.action === 'finished' && Number.isFinite(Number(entry.ts)),
  };
}

function normalizeJobState(job) {
  if (!job || typeof job !== 'object' || !job.id) return null;
  const state = job.state || {};
  const runAtMs = Number(job.lastRunAtMs || state.lastRunAtMs || state.lastStartedAtMs);
  if (!Number.isFinite(runAtMs)) return null;
  const status = job.lastRunStatus || state.lastRunStatus || state.lastStatus || job.status || 'unknown';
  const error = state.lastError || state.error || job.lastError || '';
  return normalizeNativeRun({
    runAtMs,
    ts: Number.isFinite(Number(state.lastFinishedAtMs)) ? Number(state.lastFinishedAtMs) : runAtMs,
    action: 'finished',
    status,
    summary: error,
    error,
    durationMs: job.lastDurationMs || state.lastDurationMs,
  }, job);
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

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

async function fetchLiveCronRuns(options = {}) {
  // `cron list` only exposes lastRunAtMs (start time). The card's “收工” must
  // use the actual `finished` history entry, so look up each scheduled bot job.
  // Limit concurrency to avoid making refreshes a burst of Gateway RPCs.
  const jobsRaw = await runCli(['cron', 'list', '--all', '--json', '--timeout', '10000'], options);
  const jobs = listFromMaybe(jobsRaw).filter((job) => job?.id);
  const errors = [];
  const perJob = await mapWithConcurrency(jobs, HISTORY_CONCURRENCY, async (job) => {
    try {
      const raw = await runCli(['cron', 'runs', '--id', String(job.id), '--limit', '1', '--timeout', '10000'], options);
      const entry = entriesFromMaybe(raw)[0];
      const run = normalizeNativeRun(entry, job);
      if (run) return run;
      return normalizeJobState(job);
    } catch (error) {
      errors.push({ jobId: String(job.id), error: String(error.message || error).slice(0, 500) });
      return normalizeJobState(job);
    }
  });
  const seen = new Set();
  const runs = perJob.filter((run) => {
    if (!run) return false;
    const key = nativeRunKey(run);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  runs.sort((a, b) => (Date.parse(b.finishedAt || b.startedAt || '') || 0) - (Date.parse(a.finishedAt || a.startedAt || '') || 0));
  return { runs, jobs: jobs.length, errors };
}

async function readLiveCronRuns(options = {}) {
  const now = options.now == null ? Date.now() : Number(options.now);
  if (!options.force && cache.expiresAt > now) {
    return { ...cache, cached: true, stale: false };
  }
  if (inFlight && !options.force) return inFlight;
  const previous = cache;
  const work = fetchLiveCronRuns(options).then((result) => {
    cache = { ...result, expiresAt: now + CACHE_TTL_MS };
    return { ...cache, cached: false, stale: false };
  }).catch((error) => {
    if (previous.runs.length) {
      return {
        ...previous,
        cached: true,
        stale: true,
        errors: [...previous.errors, { jobId: null, error: String(error.message || error).slice(0, 500) }],
      };
    }
    throw error;
  }).finally(() => { inFlight = null; });
  if (!options.force) inFlight = work;
  return work;
}

function resetCache() {
  cache = { expiresAt: 0, runs: [], jobs: 0, errors: [] };
  inFlight = null;
}

module.exports = {
  CACHE_TTL_MS,
  HISTORY_CONCURRENCY,
  entriesFromMaybe,
  fetchLiveCronRuns,
  listFromMaybe,
  mapWithConcurrency,
  nativeRunKey,
  normalizeJobState,
  normalizeNativeRun,
  openclawEnv,
  readLiveCronRuns,
  resetCache,
};
