/**
 * routes/bots.js
 * GET  /api/bots
 * POST /api/bots/status
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const os      = require('os');
const fetch   = require('node-fetch');
const router  = express.Router();
const { normalizeStatus, readTaskRuns } = require('../lib/task-runs');
const { readCurrentTasks } = require('../lib/openclaw-current-tasks');
const { readLiveCronRuns } = require('../lib/openclaw-task-runs');

const {
  OPENCLAW_ROOT,
  MEMORY_DIR,
  GATEWAY_URL,
  DATA_BOTS_STATUS,
  safeReadJson,
  getGatewayToken,
  gatewayHealth,
} = require('../lib/config');

// ─── GET /api/bots ────────────────────────────────────────
router.get('/api/bots', async (req, res) => {
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockBots());

  const bots = [
    { id: 'main',      name: '老大',       codename: 'main',      model: 'Claude Opus 4.6',    role: '总指挥',   channel: 'telegram' },
    { id: 'content',   name: '洗脑专家',   codename: 'content',   model: 'Claude Opus 4.6',    role: '内容创作', channel: 'telegram' },
    { id: 'tech',      name: '键盘杀手',   codename: 'tech',      model: 'Claude Sonnet 4.6',  role: '技术运维', channel: 'telegram' },
    { id: 'intel',     name: '线人',       codename: 'intel',     model: 'Claude Sonnet 4.6',  role: '情报收集', channel: 'telegram' },
    { id: 'assistant', name: '跟班',       codename: 'assistant', model: 'Ling 2.6 1T',        role: '杂活',     channel: 'telegram' },
  ];

  // Task discovery is stale-while-revalidate: this read returns immediately
  // while a bounded background refresh updates the shared snapshot.
  const currentTasksData = readCurrentTasks();
  const gatewayOnline = await gatewayHealth();

  // 从最近日志推断 lastSeen
  let sessionMap = {};
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md')).sort().reverse().slice(0, 3);
    for (const f of files) {
      const content = fs.readFileSync(require('path').join(MEMORY_DIR, f), 'utf8');
      bots.forEach((b) => {
        if (!sessionMap[b.id] && content.toLowerCase().includes(b.codename)) {
          sessionMap[b.id] = f.replace('.md', '');
        }
      });
    }
  } catch (e) {}

  // 读 OpenClaw 推送过来的运行时状态
  const runtimeMap = {};
  const runtimeData = safeReadJson(DATA_BOTS_STATUS, null);
  if (runtimeData && Array.isArray(runtimeData.bots)) {
    runtimeData.bots.forEach((b) => { runtimeMap[b.id] = b; });
  }

  // 标准任务流水是“上一单结果”的事实源；runtime 仅兼容旧数据。
  try {
    const { DATA_CRON_RUNS } = require('../lib/config');
    const { runs } = readTaskRuns(DATA_CRON_RUNS, { limit: 200 });
    for (const run of runs) {
      if (!run.actor) continue;
      const when = Date.parse(run.finishedAt || run.startedAt || '') || 0;
      const current = runtimeMap[run.actor] || {};
      const currentWhen = Date.parse(current.lastTaskTime || '') || 0;
      if (when >= currentWhen) runtimeMap[run.actor] = { ...current, lastTaskName: run.title, lastTaskTitle: run.title, lastTaskSummary: run.summary, lastTaskType: run.taskType, lastTaskTime: run.finishedAt || run.startedAt, lastTaskStatus: run.status };
    }
  } catch (e) { /* no task archive: keep legacy runtime */ }

  // Gateway 迁移后 cron 状态不再落在旧的本地 JSON 文件；用受支持的
  // OpenClaw CLI 读取实时状态。它与任务时间线共用同一 60 秒缓存。
  try {
    const live = await readLiveCronRuns();
    for (const run of live.runs) {
      if (!run.actor) continue;
      // Never label the scheduler's start timestamp as “收工”.
      if (!run.completionKnown || !run.finishedAt) continue;
      const finishedAt = run.finishedAt;
      const finishedMs = Date.parse(finishedAt) || 0;
      const current = runtimeMap[run.actor] || {};
      const currentMs = Date.parse(current.lastTaskTime || '') || 0;
      if (finishedMs < currentMs) continue;
      runtimeMap[run.actor] = {
        ...current,
        lastTaskName: run.title || current.lastTaskName || null,
        lastTaskTitle: run.title || current.lastTaskTitle || null,
        lastTaskSummary: run.summary || current.lastTaskSummary || null,
        lastTaskType: run.taskType || current.lastTaskType || null,
        lastTaskTime: finishedAt,
        lastTaskStatus: run.status || current.lastTaskStatus || null,
      };
      if (!runtimeMap[run.actor].lastSeen) runtimeMap[run.actor].lastSeen = finishedAt;
    }
  } catch (e) { /* live cron unavailable: retain task archive / legacy state */ }

  // 顺手拉一次 usage，把 per-bot 的 todayTokens 合并到每张卡
  const tokenMap = {};
  try {
    const token = getGatewayToken();
    if (token) {
      const r = await fetch(`${GATEWAY_URL}/api/usage`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 2000,
      });
      if (r.ok) {
        const j = await r.json();
        const botsArr = (j.usage && j.usage.bots) || j.bots || [];
        botsArr.forEach((b) => { tokenMap[b.id] = b; });
      }
    }
  } catch (e) {}

  const result = bots.map((b) => {
    const rt = runtimeMap[b.id] || {};
    const tk = tokenMap[b.id] || {};
    const current = currentTasksData.tasks[b.id] || null;
    return {
      ...b,
      avatarUrl: `/avatars/bot-${b.id}.png`,
      online: gatewayOnline,
      status: current?.status === 'running' ? 'running' : (rt.status || (gatewayOnline ? 'online' : 'offline')),
      currentTask: current?.title || null,
      currentTaskStatus: current?.status || null,
      currentTaskStartedAt: current?.startedAt || null,
      currentTaskSource: current?.source || null,
      lastTaskName: rt.lastTaskName || null,
      lastTaskTitle: rt.lastTaskTitle || rt.lastTaskName || null,
      lastTaskSummary: rt.lastTaskSummary || null,
      lastTaskType: rt.lastTaskType || null,
      lastTaskTime: rt.lastTaskTime || null,
      lastTaskStatus: normalizeStatus(rt.lastTaskStatus),
      weekTasks: rt.weekTasks || 0,
      todayTokens: tk.todayTokens != null ? tk.todayTokens : null,
      lastSeen: rt.lastSeen || (sessionMap[b.id] ? sessionMap[b.id] + ' (log)' : (gatewayOnline ? '活跃中' : '离线')),
      statusUpdatedAt: runtimeData ? runtimeData.updatedAt : null,
    };
  });

  const uptimeSec = os.uptime();
  const uptimeStr = (() => {
    const d = Math.floor(uptimeSec / 86400);
    const h = Math.floor((uptimeSec % 86400) / 3600);
    const m = Math.floor((uptimeSec % 3600) / 60);
    if (d > 0) return `${d}天 ${h}小时`;
    if (h > 0) return `${h}小时 ${m}分钟`;
    return `${m}分钟`;
  })();
  res.json({
    ok: true,
    bots: result,
    gatewayOnline,
    host: os.hostname(),
    uptime: uptimeStr,
    currentTasks: {
      sources: currentTasksData.sources,
      cached: Boolean(currentTasksData.cached),
      stale: Boolean(currentTasksData.stale),
      warnings: currentTasksData.warnings,
      refreshing: Boolean(currentTasksData.refreshing),
    },
  });
});

// ─── POST /api/bots/status ────────────────────────────────
router.post('/api/bots/status', (req, res) => {
  const { bots: incoming } = req.body || {};
  if (!Array.isArray(incoming)) return res.status(400).json({ ok: false, error: 'bots array required' });
  const record = {
    updatedAt: new Date().toISOString(),
    bots: incoming,
  };
  try {
    fs.writeFileSync(DATA_BOTS_STATUS, JSON.stringify(record, null, 2), 'utf8');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
