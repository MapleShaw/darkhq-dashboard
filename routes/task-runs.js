/**
 * routes/task-runs.js
 * GET /api/task-runs
 */
'use strict';

const express = require('express');
const router = express.Router();
const { DATA_CRON_RUNS } = require('../lib/config');
const { ACTORS, clampLimit, readTaskRuns, normalizeStatus } = require('../lib/task-runs');
const { readLiveCronRuns } = require('../lib/openclaw-task-runs');

function filterRuns(runs, { actor, status }) {
  const actorFilter = actor ? String(actor).trim().toLowerCase() : '';
  const statusFilter = status ? normalizeStatus(status) : '';
  return runs.filter((run) => {
    if (actorFilter && (!ACTORS.has(actorFilter) || run.actor !== actorFilter)) return false;
    if (statusFilter && run.status !== statusFilter) return false;
    return true;
  });
}

function mergeRuns(structured, native) {
  const seen = new Set();
  return [...structured, ...native].filter((run) => {
    const key = `${run.source || 'structured'}|${run.id || ''}|${run.jobId || ''}|${run.startedAt || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (Date.parse(b.startedAt || '') || 0) - (Date.parse(a.startedAt || '') || 0));
}

router.get('/api/task-runs', async (req, res) => {
  try {
    const limit = clampLimit(req.query.limit);
    const structured = readTaskRuns(DATA_CRON_RUNS, { limit: 200 });
    let native = { runs: [], jobs: 0, errors: [], cached: false, stale: false };
    let nativeUnavailable = null;
    try {
      native = await readLiveCronRuns();
    } catch (error) {
      nativeUnavailable = String(error.message || error).slice(0, 500);
    }
    const runs = filterRuns(mergeRuns(
      structured.runs.map((run) => ({ ...run, source: 'darkhq-writeback' })),
      native.runs,
    ), { actor: req.query.actor, status: req.query.status }).slice(0, limit);
    const errors = structured.errors.length + native.errors.length + (nativeUnavailable ? 1 : 0);
    res.json({
      ok: true,
      runs,
      errors,
      skipped: errors,
      sources: {
        writeback: { runs: structured.runs.length, errors: structured.errors.length },
        openclawCron: {
          runs: native.runs.length,
          jobs: native.jobs,
          errors: native.errors.length,
          cached: native.cached,
          stale: native.stale,
          available: !nativeUnavailable,
        },
      },
      warning: nativeUnavailable ? `OpenClaw Cron 历史暂不可用：${nativeUnavailable}` : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
module.exports._test = { filterRuns, mergeRuns };
