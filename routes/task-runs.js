/**
 * routes/task-runs.js
 * GET /api/task-runs
 */

'use strict';

const express = require('express');
const router = express.Router();
const { DATA_CRON_RUNS } = require('../lib/config');
const { readTaskRuns, normalizeStatus } = require('../lib/task-runs');

router.get('/api/task-runs', (req, res) => {
  try {
    const { runs, errors } = readTaskRuns(DATA_CRON_RUNS, {
      limit: req.query.limit,
      actor: req.query.actor,
      status: req.query.status ? normalizeStatus(req.query.status) : '',
    });
    res.json({ ok: true, runs, errors: errors.length, skipped: errors.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
