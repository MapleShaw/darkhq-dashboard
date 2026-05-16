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

  // 从 Gateway cron 文件直接读取各 bot 的最后任务时间
  try {
    const path = require('path');
    const CRON_DIR      = require('path').join(OPENCLAW_ROOT, 'cron');
    const cronJobsDef   = safeReadJson(path.join(CRON_DIR, 'jobs.json'), {});
    const cronJobsState = safeReadJson(path.join(CRON_DIR, 'jobs-state.json'), {});
    const jobsDef  = Array.isArray(cronJobsDef) ? cronJobsDef : (cronJobsDef.jobs ? Object.entries(cronJobsDef.jobs).map(([id, v]) => ({ id, ...v })) : []);
    const stateMap = cronJobsState.jobs || {};

    const botJobMap = {};
    jobsDef.forEach((job) => {
      const aid = job.agentId;
      if (!aid) return;
      const st = stateMap[job.id] || {};
      const stateObj = st.state || job.state || {};
      const lastRunAtMs = stateObj.lastRunAtMs;
      if (!lastRunAtMs) return;
      if (!botJobMap[aid] || lastRunAtMs > botJobMap[aid].lastRunAtMs) {
        botJobMap[aid] = {
          lastRunAtMs,
          name: (job.name || '').replace(/^[\p{Emoji}\u200d\ufe0f\s]+/u, '').trim().slice(0, 30),
          status: stateObj.lastRunStatus === 'ok' ? 'success' : (stateObj.lastRunStatus === 'error' ? 'failed' : 'unknown'),
        };
      }
    });

    Object.entries(botJobMap).forEach(([aid, info]) => {
      if (!runtimeMap[aid]) runtimeMap[aid] = {};
      const existingTime = runtimeMap[aid].lastTaskTime ? new Date(runtimeMap[aid].lastTaskTime).getTime() : 0;
      if (info.lastRunAtMs > existingTime) {
        runtimeMap[aid].lastTaskName   = info.name || runtimeMap[aid].lastTaskName || null;
        runtimeMap[aid].lastTaskTime   = new Date(info.lastRunAtMs).toISOString();
        runtimeMap[aid].lastTaskStatus = info.status;
        if (!runtimeMap[aid].lastSeen) runtimeMap[aid].lastSeen = new Date(info.lastRunAtMs).toISOString();
      }
    });
  } catch (e) { /* cron 文件读取失败不影响主流程 */ }

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
    return {
      ...b,
      avatarUrl: `/avatars/bot-${b.id}.png`,
      online: gatewayOnline,
      status: rt.status || (gatewayOnline ? 'online' : 'offline'),
      currentTask: null,
      lastTaskName: rt.lastTaskName || null,
      lastTaskTime: rt.lastTaskTime || null,
      lastTaskStatus: rt.lastTaskStatus || 'unknown',
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
  res.json({ ok: true, bots: result, gatewayOnline, host: os.hostname(), uptime: uptimeStr });
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
