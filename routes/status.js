/**
 * routes/status.js
 * GET /api/status  — 服务健康总览
 */
'use strict';

const express  = require('express');
const { execSync } = require('child_process');
const path     = require('path');
const router   = express.Router();

const { OPENCLAW_ROOT, safeReadJson, gatewayHealth } = require('../lib/config');

function serviceStatus(name) {
  try {
    const out = execSync(`systemctl is-active ${name}`, { timeout: 3000, encoding: 'utf8' }).trim();
    return out === 'active' ? 'active' : out;
  } catch (e) {
    return ((e.stdout || '').trim()) || 'inactive';
  }
}

function diskUsage() {
  try {
    const out = execSync("df / | tail -1 | awk '{print $3,$4,$5}'", { timeout: 3000, encoding: 'utf8' }).trim();
    const [used, avail, pct] = out.split(' ');
    return { used: used || '?', avail: avail || '?', pct: parseInt(pct) || 0 };
  } catch (e) { return { used: '?', avail: '?', pct: 0 }; }
}

function memUsage() {
  try {
    const out = execSync("free -m | grep '^Mem' | awk '{print $2,$3,$7}'", { timeout: 3000, encoding: 'utf8' }).trim();
    const [total, used, available] = out.split(' ').map(Number);
    return { total, used, available, pct: Math.round((used / total) * 100) };
  } catch (e) { return { total: 0, used: 0, available: 0, pct: 0 }; }
}

function cronSummary() {
  try {
    const CRON_DIR  = path.join(OPENCLAW_ROOT, 'cron');
    const jobsDef   = safeReadJson(path.join(CRON_DIR, 'jobs.json'), {});
    const jobsState = safeReadJson(path.join(CRON_DIR, 'jobs-state.json'), {});
    const jobs = Array.isArray(jobsDef)
      ? jobsDef
      : (jobsDef.jobs ? Object.entries(jobsDef.jobs).map(([id, v]) => ({ id, ...v })) : []);
    const stateMap = jobsState.jobs || {};

    let ok = 0, error = 0;
    const failed = [];
    jobs.forEach((job) => {
      const st = (stateMap[job.id] || {}).state || job.state || {};
      if (st.lastRunStatus === 'error') {
        error++;
        failed.push({ name: job.name || job.id, consecutiveErrors: st.consecutiveErrors || 1 });
      } else if (st.lastRunStatus === 'ok') { ok++; }
    });
    return { total: jobs.length, ok, error, failed };
  } catch (e) { return { total: 0, ok: 0, error: 0, failed: [] }; }
}

function monitorState() {
  const p = path.join(OPENCLAW_ROOT, 'workspace-tech', 'monitor-state.json');
  return safeReadJson(p, { lastAlertTime: {}, failCount: {}, lastCheck: null });
}

router.get('/api/status', async (req, res) => {
  const { USE_MOCK } = req.app.locals;
  if (USE_MOCK) {
    return res.json({
      ok: true, ts: new Date().toISOString(),
      gateway: { online: true },
      services: [
        { name: 'darkhq',   label: 'DarkHQ 控制台', status: 'active', port: 9700 },
        { name: 'wewe-rss', label: 'wewe-rss',       status: 'active', port: 4000 },
        { name: 'rsshub',   label: 'RSSHub',          status: 'active', port: 1200 },
        { name: 'nginx',    label: 'Nginx',           status: 'active', port: 80   },
      ],
      disk: { used: '12G', avail: '18G', pct: 40 },
      mem:  { total: 3686, used: 1843, available: 1843, pct: 50 },
      cron: { total: 10, ok: 9, error: 1, failed: [{ name: '每日简报', consecutiveErrors: 1 }] },
      monitor: { lastCheck: new Date().toISOString(), alertCount: 0 },
    });
  }

  const [gatewayOnline, disk, mem, cron, monitor] = await Promise.all([
    gatewayHealth(),
    Promise.resolve(diskUsage()),
    Promise.resolve(memUsage()),
    Promise.resolve(cronSummary()),
    Promise.resolve(monitorState()),
  ]);

  const SERVICES = [
    { name: 'darkhq',   label: 'DarkHQ 控制台', port: 9700 },
    { name: 'wewe-rss', label: 'wewe-rss',       port: 4000 },
    { name: 'rsshub',   label: 'RSSHub',          port: 1200 },
    { name: 'nginx',    label: 'Nginx',           port: 80   },
  ];

  const services = SERVICES.map((s) => ({
    ...s, status: serviceStatus(`${s.name}.service`),
  }));

  res.json({
    ok: true, ts: new Date().toISOString(),
    gateway: { online: gatewayOnline },
    services,
    disk, mem, cron,
    monitor: { lastCheck: monitor.lastCheck, alertCount: Object.keys(monitor.lastAlertTime || {}).length },
  });
});

module.exports = router;
