/**
 * routes/docs.js
 * GET /api/docs
 * GET /api/docs/:id
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const {
  MEMORY_DIR,
  DOCS_DIR,
  readGatewayRuns,
} = require('../lib/config');

const CRON_DOC_DEFS = [
  { jobId: 'daily-english', botId: 'content', label: '每日地道美语' },
  { jobId: 'soul-check',    botId: 'content', label: '每日灵魂拷问' },
  { jobId: 'daily-brief',   botId: 'main',    label: '每日简报'     },
  { jobId: 'signal-radar',  botId: 'intel',   label: 'Signal Radar' },
  { jobId: 'update-check',  botId: 'tech',    label: '更新检查'     },
];

const JOB_IDS = ['daily-english', 'soul-check', 'daily-brief', 'signal-radar', 'update-check', 'daily-log'];

// ─── GET /api/docs ────────────────────────────────────────
router.get('/api/docs', (req, res) => {
  const type = req.query.type || 'memory';
  const bot  = req.query.bot  || null;
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockDocs(type, bot));

  if (type === 'memory') {
    const list = [];
    try {
      const files = fs.readdirSync(MEMORY_DIR).filter((f) => f.endsWith('.md')).sort().reverse();
      for (const f of files) {
        const full = path.join(MEMORY_DIR, f);
        const st = fs.statSync(full);
        list.push({
          id: 'memory-' + f.replace('.md', ''),
          type: 'memory',
          title: f.replace('.md', '') + ' · 聊天底',
          botId: null,
          createdAt: st.mtime.toISOString(),
          size: st.size,
        });
      }
    } catch (e) {}
    // 分页
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
    const total = list.length;
    const totalPages = Math.ceil(total / size);
    const sliced = list.slice((page - 1) * size, page * size);
    res.json({ ok: true, docs: sliced, total, page, size, totalPages });
    return;
  }

  if (type === 'docs') {
    const list = [];
    try {
      // 1. 静态文档文件
      if (fs.existsSync(DOCS_DIR)) {
        const botDirs = bot && bot !== 'all' ? [bot] : fs.readdirSync(DOCS_DIR);
        for (const bid of botDirs) {
          const dir = path.join(DOCS_DIR, bid);
          if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
          const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
          for (const f of files) {
            const full = path.join(dir, f);
            const st = fs.statSync(full);
            list.push({
              id: `d-${bid}-${f.replace('.md', '')}`,
              type: 'docs',
              title: f.replace('.md', ''),
              botId: bid,
              createdAt: st.mtime.toISOString(),
              size: st.size,
            });
          }
        }
      }

      // 2. Cron runs 虚拟文档
      const targetDefs = (bot && bot !== 'all')
        ? CRON_DOC_DEFS.filter((d) => d.botId === bot)
        : CRON_DOC_DEFS;

      for (const def of targetDefs) {
        const runs = readGatewayRuns(def.jobId, 50);
        for (const run of runs) {
          if (!run.output || run.output.length < 5) continue;
          const date = run.startedAt.slice(0, 10);
          list.push({
            id: `run-${def.jobId}-${run.startedAt.replace(/[:.]/g, '-')}`,
            type: 'docs',
            title: `${def.label} · ${date}`,
            botId: def.botId,
            createdAt: run.startedAt,
            size: run.output.length,
            _runOutput: run.output,
            _runStatus: run.status,
          });
        }
      }

      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } catch (e) {}
    const cleaned = list.map(({ _runOutput, _runStatus, ...rest }) => rest);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
    const total = cleaned.length;
    const totalPages = Math.ceil(total / size);
    const sliced = cleaned.slice((page - 1) * size, page * size);
    res.json({ ok: true, docs: sliced, total, page, size, totalPages });
    return;
  }

  res.status(400).json({ ok: false, error: 'unknown type' });
});

// ─── GET /api/docs/:id ────────────────────────────────────
router.get('/api/docs/:id', (req, res) => {
  const { id } = req.params;
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockDocContent(id));

  try {
    if (id.startsWith('memory-')) {
      const date = id.replace('memory-', '');
      const full = path.join(MEMORY_DIR, `${date}.md`);
      const body = fs.readFileSync(full, 'utf8');
      return res.json({ ok: true, id, body });
    }
    if (id.startsWith('d-')) {
      const rest = id.slice(2);
      const sepIdx = rest.indexOf('-');
      const botId = rest.slice(0, sepIdx);
      const fname = rest.slice(sepIdx + 1);
      const full = path.join(DOCS_DIR, botId, `${fname}.md`);
      const body = fs.readFileSync(full, 'utf8');
      return res.json({ ok: true, id, body });
    }
    if (id.startsWith('run-')) {
      const withoutPrefix = id.slice(4);
      let matched = null;
      for (const jid of JOB_IDS) {
        if (withoutPrefix.startsWith(jid + '-')) {
          const runs = readGatewayRuns(jid, 50);
          matched = runs.find((r) =>
            id === `run-${jid}-${r.startedAt.replace(/[:.]/g, '-')}`
          );
          if (matched) break;
        }
      }
      if (matched) return res.json({ ok: true, id, body: matched.output });
      return res.status(404).json({ ok: false, error: 'run not found' });
    }
    res.status(404).json({ ok: false, error: 'not found' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
