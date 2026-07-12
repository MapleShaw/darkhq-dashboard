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
  TEAM_WORKSPACES,
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

const TEAM_FILE_EXTS = new Set([
  '.md', '.txt', '.json', '.json5', '.yaml', '.yml', '.js', '.mjs', '.cjs', '.ts', '.tsx',
  '.jsx', '.py', '.sh', '.css', '.html', '.xml', '.toml', '.ini', '.conf', '.csv', '.sql',
]);
const TEAM_FILE_NAMES = new Set(['Dockerfile', 'Makefile', 'Procfile', 'LICENSE']);
const TEAM_SKIP_DIRS = new Set([
  '.git', 'node_modules', '.cache', '.npm', '.pnpm-store', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'coverage', '.next', '.openclaw',
]);
const TEAM_MAX_LISTED_SIZE = 2 * 1024 * 1024;

function isTeamTextFile(name) {
  return TEAM_FILE_NAMES.has(name) || TEAM_FILE_EXTS.has(path.extname(name).toLowerCase());
}

function collectTeamFiles(botFilter) {
  const list = [];
  const roots = botFilter && botFilter !== 'all'
    ? TEAM_WORKSPACES.filter(([botId]) => botId === botFilter)
    : TEAM_WORKSPACES;

  for (const [botId, root] of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [{ dir: root, depth: 0 }];
    while (stack.length) {
      const { dir, depth } = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (depth < 8 && !TEAM_SKIP_DIRS.has(entry.name)) stack.push({ dir: full, depth: depth + 1 });
          continue;
        }
        if (!entry.isFile() || !isTeamTextFile(entry.name)) continue;
        try {
          const st = fs.statSync(full);
          if (st.size > TEAM_MAX_LISTED_SIZE) continue;
          const rel = path.relative(root, full).split(path.sep).join('/');
          list.push({
            id: `team-${botId}-${Buffer.from(rel).toString('base64url')}`,
            type: 'team', title: rel, botId,
            createdAt: st.mtime.toISOString(), size: st.size,
          });
        } catch (e) {}
      }
    }
  }
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ─── GET /api/docs ────────────────────────────────────────
router.get('/api/docs', (req, res) => {
  const type = req.query.type || 'memory';
  const bot  = req.query.bot  || null;
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockDocs(type, bot));

  if (type === 'team') {
    const list = collectTeamFiles(bot);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const size = Math.min(100, Math.max(1, parseInt(req.query.size) || 20));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / size));
    return res.json({ ok: true, docs: list.slice((page - 1) * size, page * size), total, page, size, totalPages });
  }

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
    if (id.startsWith('team-')) {
      const match = id.match(/^team-([a-z]+)-(.+)$/);
      if (!match) return res.status(404).json({ ok: false, error: 'not found' });
      const [, botId, encoded] = match;
      const rootEntry = TEAM_WORKSPACES.find(([id]) => id === botId);
      if (!rootEntry) return res.status(404).json({ ok: false, error: 'workspace not found' });
      const root = path.resolve(rootEntry[1]);
      let rel;
      try { rel = Buffer.from(encoded, 'base64url').toString('utf8'); } catch (e) { return res.status(400).json({ ok: false, error: 'bad file id' }); }
      const full = path.resolve(root, rel);
      if (full !== root && !full.startsWith(root + path.sep)) return res.status(403).json({ ok: false, error: 'invalid path' });
      const st = fs.statSync(full);
      if (!st.isFile() || st.size > TEAM_MAX_LISTED_SIZE || !isTeamTextFile(path.basename(full))) {
        return res.status(400).json({ ok: false, error: 'file is not viewable' });
      }
      return res.json({ ok: true, id, body: fs.readFileSync(full, 'utf8') });
    }
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
