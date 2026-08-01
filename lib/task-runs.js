/**
 * Dynamic task-run aggregation for DarkHQ.
 * Reads only Dashboard-owned task run archives under data/cron-runs.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ACTORS = new Set(['main', 'assistant', 'content', 'intel', 'tech']);
const STATUSES = new Set(['success', 'failed', 'needs_confirmation', 'running', 'unknown']);
const STATUS_ALIASES = {
  ok: 'success',
  done: 'success',
  completed: 'success',
  complete: 'success',
  error: 'failed',
  fail: 'failed',
  failure: 'failed',
  need_confirmation: 'needs_confirmation',
  'needs-confirmation': 'needs_confirmation',
  pending_confirmation: 'needs_confirmation',
  confirm: 'needs_confirmation',
  pending: 'running',
  in_progress: 'running',
};
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_FIELD = 4000;
const MAX_ITEM = 1000;
const TASK_TITLES = {
  darkhq_task_flow: '修复 DarkHQ 任务卡片',
  readonly_audit: '幽灵任务审计',
};

function safeJsonParse(text, fallback = null) {
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

function safeReadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(Math.floor(n), MAX_LIMIT));
}

function normalizeFilter(value) {
  if (value == null || value === '') return null;
  return String(value).trim().toLowerCase();
}

function normalizeActor(value, fallback = null) {
  const actor = normalizeFilter(value);
  return actor && ACTORS.has(actor) ? actor : fallback;
}

function normalizeStatus(value) {
  const raw = normalizeFilter(value);
  if (!raw) return 'unknown';
  const mapped = STATUS_ALIASES[raw] || raw;
  return STATUSES.has(mapped) ? mapped : 'unknown';
}

function resolveInside(baseDir, ...parts) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...parts);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

function splitJobId(jobId) {
  const raw = String(jobId || '');
  const dash = raw.indexOf('-');
  if (dash <= 0) return { actor: null, taskType: raw || null };
  const actor = raw.slice(0, dash);
  if (!ACTORS.has(actor)) return { actor: null, taskType: raw || null };
  return { actor, taskType: raw.slice(dash + 1) || null };
}

function parseOutput(output) {
  if (output == null) return { parsed: null, summary: '' };
  if (typeof output === 'object' && !Array.isArray(output)) return { parsed: output, summary: output.summary || '' };
  const text = String(output);
  const parsed = safeJsonParse(text, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return { parsed, summary: parsed.summary || '' };
  }
  return { parsed: null, summary: text };
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).slice(0, MAX_ITEM)).filter((v) => v.trim());
  if (value == null || value === '') return [];
  return [String(value).slice(0, MAX_ITEM)].filter((v) => v.trim());
}

function normalizeString(value, max = MAX_FIELD) {
  if (value == null) return '';
  return String(value).slice(0, max);
}

function normalizeIso(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

function normalizeDuration(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function deriveTitle(value, taskType, summary) {
  const explicit = normalizeString(value, 160).replace(/\s+/g, ' ').trim();
  if (explicit) return explicit;
  const type = String(taskType || '').trim();
  if (TASK_TITLES[type]) return TASK_TITLES[type];
  const text = normalizeString(summary, 160).replace(/\s+/g, ' ').trim();
  if (!text) return type || '未命名任务';
  return (text.split(/[。；;！!？?：:]/)[0].trim() || text).slice(0, 48);
}

function normalizeRun(record, context = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const jobId = String(record.jobId || context.jobId || '').trim();
  if (!jobId) return null;

  const { parsed, summary: fallbackSummary } = parseOutput(record.output);
  const fromJob = splitJobId(jobId);
  const startedAt = normalizeIso(record.startedAt || record.startTime || record.ts, context.mtimeIso || null);
  const status = normalizeStatus(record.status || record.lastTaskStatus || (parsed && parsed.status));

  const taskType = normalizeString((parsed && parsed.taskType) || record.taskType || fromJob.taskType || jobId, 300);
  const summary = normalizeString((parsed && parsed.summary) || record.summary || fallbackSummary || '');
  return {
    id: normalizeString(record.id || `${jobId}-${startedAt || context.fileName || 'unknown'}`, 300),
    jobId,
    taskId: normalizeString((parsed && parsed.taskId) || record.taskId || record.id || '', 300) || null,
    actor: normalizeActor((parsed && parsed.actor) || record.actor, fromJob.actor || null),
    taskType,
    title: deriveTitle((parsed && parsed.title) || record.title, taskType, summary),
    status,
    summary,
    evidence: normalizeArray(parsed && parsed.evidence),
    artifacts: normalizeArray(parsed && parsed.artifacts),
    blockers: normalizeArray(parsed && parsed.blockers),
    nextAction: normalizeString((parsed && parsed.nextAction) || record.nextAction || '', 1000) || null,
    startedAt,
    finishedAt: normalizeIso((parsed && parsed.finishedAt) || record.finishedAt, null),
    resolvedAt: normalizeIso((parsed && parsed.resolvedAt) || record.resolvedAt, null),
    resolutionSummary: normalizeString((parsed && parsed.resolutionSummary) || record.resolutionSummary || '', 1000) || null,
    durationMs: normalizeDuration(record.durationMs),
  };
}

function listJsonFiles(baseDir) {
  const root = path.resolve(baseDir);
  if (!fs.existsSync(root)) return [];
  const files = [];
  let jobDirs = [];
  try {
    jobDirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    return [];
  }

  for (const dirent of jobDirs) {
    const jobId = dirent.name;
    const jobDir = resolveInside(root, jobId);
    if (!jobDir) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(jobDir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = resolveInside(jobDir, entry.name);
      if (!filePath) continue;
      files.push({ jobId, fileName: entry.name, filePath });
    }
  }
  return files;
}

function readTaskRuns(baseDir, options = {}) {
  const limit = clampLimit(options.limit);
  const actorFilter = normalizeFilter(options.actor);
  const statusFilter = normalizeFilter(options.status);
  const runs = [];
  const errors = [];

  for (const file of listJsonFiles(baseDir)) {
    let stat = null;
    try { stat = fs.statSync(file.filePath); } catch (e) {}
    const record = safeReadJson(file.filePath);
    if (!record) {
      errors.push({ jobId: file.jobId, fileName: file.fileName, error: 'invalid_json' });
      continue;
    }
    const run = normalizeRun(record, {
      jobId: file.jobId,
      fileName: file.fileName,
      mtimeIso: stat ? stat.mtime.toISOString() : null,
    });
    if (!run) {
      errors.push({ jobId: file.jobId, fileName: file.fileName, error: 'invalid_record' });
      continue;
    }
    if (actorFilter && (!ACTORS.has(actorFilter) || String(run.actor || '').toLowerCase() !== actorFilter)) continue;
    if (statusFilter && String(run.status || '').toLowerCase() !== normalizeStatus(statusFilter)) continue;
    runs.push(run);
  }

  runs.sort((a, b) => {
    const bt = Date.parse(b.startedAt || '') || 0;
    const at = Date.parse(a.startedAt || '') || 0;
    return bt - at;
  });

  return { runs: runs.slice(0, limit), errors };
}

module.exports = {
  ACTORS,
  STATUSES,
  STATUS_ALIASES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  normalizeRun,
  normalizeStatus,
  parseOutput,
  readTaskRuns,
  splitJobId,
  deriveTitle,
};
