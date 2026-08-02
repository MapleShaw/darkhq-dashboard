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

// 卷宗采用“白名单”而不是扫描整个工作区：
// - 团队文件：跨 Agent 的系统关键文件 + 项目总账中标为 Paused 的项目摘要
// - 档案：各 Agent 的个人设定、专属资料与产出记录
// memory/ 始终只属于“聊天记录”，不会从这里穿透展示。
const VIEWABLE_MAX_SIZE = 2 * 1024 * 1024;
const SEARCH_QUERY_MAX_LENGTH = 120;
const CORE_TEAM_FILES = [
  { botId: 'main', rel: 'docs/main/project-registry.md', title: '项目总账 · Project Registry', category: '项目治理' },
  { botId: 'main', rel: 'AGENTS.md', title: 'OpenClaw 团队协作规则', category: '系统关键' },
  { botId: 'tech', sourceBotId: 'main', rel: 'darkhq-dashboard/PROJECT.md', title: '老巢控制台 · 项目说明', category: '关键项目 · tech维护', tags: ['tech', 'canonical:main'] },
  { botId: 'main', rel: 'content-signal-radar/README.md', title: 'Content Signal Radar · 系统说明', category: '关键项目' },
  { botId: 'main', rel: 'content-signal-radar/TODO.md', title: 'Content Signal Radar · 待办', category: '关键项目' },
  { botId: 'tech', rel: 'docs/tech/运维知识-darkhq-wewerss.md', title: 'OpenClaw 运维知识 · DarkHQ / WeWeRSS', category: '系统关键' },
];
const CORE_MANUAL_FILES = [
  {
    botId: 'main',
    rel: 'docs/main/ai-image-video-399-1v1-sop-v0.1.md',
    title: '核心手册 · AI 图片/视频 399 元 1V1 SOP',
    category: '核心手册',
    tags: ['置顶', '客户交付', '1V1'],
    pinned: true,
  },
];
const CURATED_FILE_DEFS = [...CORE_TEAM_FILES, ...CORE_MANUAL_FILES];
const PERSONAL_ARCHIVE_NAMES = ['SOUL.md', 'IDENTITY.md', 'TOOLS.md', 'TODO.md'];

function workspaceFor(botId) {
  return TEAM_WORKSPACES.find(([id]) => id === botId)?.[1] || null;
}

function makeFileEntry({ botId, sourceBotId = botId, rel, title, category, type = 'team', tags = [], pinned = false }) {
  const root = workspaceFor(sourceBotId);
  if (!root || rel.split('/').includes('memory')) return null;
  const full = path.resolve(root, rel);
  const safeRoot = path.resolve(root);
  if (full !== safeRoot && !full.startsWith(safeRoot + path.sep)) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile() || st.size > VIEWABLE_MAX_SIZE) return null;
    return {
      id: `${type}-file-${sourceBotId}-${Buffer.from(rel).toString('base64url')}`,
      type, title, botId, sourceBotId, category, tags, pinned,
      maintainerBotId: botId, createdAt: st.mtime.toISOString(), size: st.size,
    };
  } catch (e) { return null; }
}

function readProjectRegistry() {
  const root = workspaceFor('main');
  const full = root && path.join(root, 'docs', 'main', 'project-registry.md');
  try { return fs.readFileSync(full, 'utf8'); } catch (e) { return ''; }
}

function collectPausedProjects(botFilter) {
  if (botFilter && botFilter !== 'all' && botFilter !== 'main') return [];
  const body = readProjectRegistry();
  const sections = body.split(/(?=^###\s+)/m);
  const list = [];
  for (const section of sections) {
    const heading = section.match(/^###\s+(.+)$/m)?.[1]?.trim();
    const status = section.match(/^\s*-?\s*\*\*状态\*\*[：:]\s*(.+)$/mi)?.[1]?.trim();
    if (!heading || !status || !/^Paused\b/i.test(status)) continue;
    const id = `team-paused-${Buffer.from(heading).toString('base64url')}`;
    list.push({
      id, type: 'team', title: `暂停 · ${heading.replace(/^\d+\.\s*/, '')}`,
      botId: 'main', category: '暂停项目', createdAt: null,
      size: Buffer.byteLength(section), _body: section.trim(),
    });
  }
  return list;
}

function collectTeamFiles(botFilter) {
  const files = CORE_TEAM_FILES
    .filter((d) => !botFilter || botFilter === 'all' || d.botId === botFilter)
    .map(makeFileEntry).filter(Boolean);
  return [...collectPausedProjects(botFilter), ...files]
    .sort((a, b) => (a.category === '暂停项目' ? -1 : 0) - (b.category === '暂停项目' ? -1 : 0));
}

function collectCoreManuals(botFilter) {
  return CORE_MANUAL_FILES
    .filter((d) => !botFilter || botFilter === 'all' || d.botId === botFilter)
    .map((d) => makeFileEntry({ ...d, type: 'manual' }))
    .filter(Boolean)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.createdAt) - new Date(a.createdAt));
}

function collectPersonalArchives(botFilter) {
  const roots = botFilter && botFilter !== 'all'
    ? TEAM_WORKSPACES.filter(([botId]) => botId === botFilter)
    : TEAM_WORKSPACES;
  const list = [];
  for (const [botId, root] of roots) {
    for (const name of PERSONAL_ARCHIVE_NAMES) {
      const item = makeFileEntry({
        botId, rel: name, title: name.replace('.md', ''), category: '成员专属', type: 'archive',
      });
      if (item) list.push(item);
    }
    // 每个成员 workspace/docs 下的专属文档；明确排除 memory。
    const docsRoot = path.join(root, 'docs');
    if (!fs.existsSync(docsRoot)) continue;
    const stack = [docsRoot];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== 'memory') stack.push(full); continue; }
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        const rel = path.relative(root, full).split(path.sep).join('/');
        // 已进入“团队文件”白名单的关键资料，不在个人档案重复展示。
        if (CURATED_FILE_DEFS.some((d) => (d.sourceBotId || d.botId) === botId && d.rel === rel)) continue;
        const item = makeFileEntry({ botId, rel, title: rel.replace(/^docs\//, ''), category: '成员文档', type: 'archive' });
        if (item) list.push(item);
      }
    }
  }
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function readCuratedFile(id, expectedType) {
  const prefix = `${expectedType}-file-`;
  if (!id.startsWith(prefix)) return null;
  const rest = id.slice(prefix.length);
  const sep = rest.indexOf('-');
  if (sep < 1) return null;
  const botId = rest.slice(0, sep);
  const root = workspaceFor(botId);
  if (!root) return null;
  let rel;
  try { rel = Buffer.from(rest.slice(sep + 1), 'base64url').toString('utf8'); } catch (e) { return null; }
  if (rel.split('/').includes('memory')) return null;
  const safeRoot = path.resolve(root);
  const full = path.resolve(root, rel);
  if (full !== safeRoot && !full.startsWith(safeRoot + path.sep)) return null;
  const st = fs.statSync(full);
  if (!st.isFile() || st.size > VIEWABLE_MAX_SIZE) return null;
  return fs.readFileSync(full, 'utf8');
}

// ─── GET /api/docs ────────────────────────────────────────
router.get('/api/docs', (req, res) => {
  const type = req.query.type || 'memory';
  const bot  = req.query.bot || null;
  const query = normalizeSearchQuery(req.query.q);
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
          id: 'memory-' + f.replace('.md', ''), type: 'memory',
          title: f.replace('.md', '') + ' · 聊天记录', botId: null,
          category: '聊天记录', createdAt: st.mtime.toISOString(), size: st.size,
        });
      }
    } catch (e) {}
    return sendPage(res, searchDocuments(list, query), req.query.page, req.query.size, query);
  }

  if (type === 'manuals' || type === 'team' || type === 'docs') {
    const list = type === 'manuals' ? collectCoreManuals(bot) : (type === 'team' ? collectTeamFiles(bot) : collectPersonalArchives(bot));
    if (type === 'docs') {
      const targetDefs = (bot && bot !== 'all')
        ? CRON_DOC_DEFS.filter((d) => d.botId === bot)
        : CRON_DOC_DEFS;
      for (const def of targetDefs) {
        for (const run of readGatewayRuns(def.jobId, 50)) {
          if (!run.output || run.output.length < 5) continue;
          const date = run.startedAt.slice(0, 10);
          list.push({
            id: `run-${def.jobId}-${run.startedAt.replace(/[:.]/g, '-')}`,
            type: 'docs', title: `${def.label} · ${date}`, botId: def.botId,
            category: '成员产出', createdAt: run.startedAt, size: run.output.length,
          });
        }
      }
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
    return sendPage(res, searchDocuments(list, query), req.query.page, req.query.size, query);
  }

  res.status(400).json({ ok: false, error: 'unknown type' });
});

function normalizeSearchQuery(value) {
  return String(value || '').trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
}

function bodyForSearch(item) {
  if (typeof item._body === 'string') return item._body;
  try {
    if (item.id.startsWith('manual-file-')) return readCuratedFile(item.id, 'manual') || '';
    if (item.id.startsWith('team-file-')) return readCuratedFile(item.id, 'team') || '';
    if (item.id.startsWith('archive-file-')) return readCuratedFile(item.id, 'archive') || '';
    if (item.id.startsWith('memory-')) {
      const name = item.id.slice('memory-'.length);
      if (!/^[^/\\]+$/.test(name)) return '';
      return fs.readFileSync(path.join(MEMORY_DIR, `${name}.md`), 'utf8');
    }
    if (item.id.startsWith('run-')) {
      const withoutPrefix = item.id.slice(4);
      for (const jid of JOB_IDS) {
        if (!withoutPrefix.startsWith(jid + '-')) continue;
        const matched = readGatewayRuns(jid, 50).find((r) =>
          item.id === `run-${jid}-${r.startedAt.replace(/[:.]/g, '-')}`
        );
        return matched?.output || '';
      }
    }
  } catch (e) {}
  return '';
}

function makeSearchSnippet(body, query) {
  const normalizedBody = String(body || '').replace(/\s+/g, ' ').trim();
  const at = normalizedBody.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (at < 0) return '';
  const start = Math.max(0, at - 48);
  const end = Math.min(normalizedBody.length, at + query.length + 72);
  return `${start ? '…' : ''}${normalizedBody.slice(start, end)}${end < normalizedBody.length ? '…' : ''}`;
}

function searchDocuments(list, query) {
  if (!query) return list;
  const needle = query.toLocaleLowerCase();
  return list.reduce((matched, item) => {
    const metadata = [item.title, item.category, item.botId, ...(item.tags || [])]
      .filter(Boolean).join(' ').toLocaleLowerCase();
    const body = bodyForSearch(item);
    if (!metadata.includes(needle) && !body.toLocaleLowerCase().includes(needle)) return matched;
    matched.push({ ...item, searchSnippet: makeSearchSnippet(body, query) });
    return matched;
  }, []);
}

function sendPage(res, list, pageRaw, sizeRaw, query = '') {
  const page = Math.max(1, parseInt(pageRaw) || 1);
  const size = Math.min(100, Math.max(1, parseInt(sizeRaw) || 20));
  const total = list.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const docs = list.slice((page - 1) * size, page * size)
    .map(({ _body, ...item }) => item);
  return res.json({ ok: true, docs, total, page, size, totalPages, query });
}

// ─── GET /api/docs/:id ────────────────────────────────────
router.get('/api/docs/:id', (req, res) => {
  const { id } = req.params;
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockDocContent(id));

  try {
    if (id.startsWith('team-paused-')) {
      const item = collectPausedProjects('all').find((d) => d.id === id);
      if (!item) return res.status(404).json({ ok: false, error: 'paused project not found' });
      return res.json({ ok: true, id, body: item._body });
    }
    if (id.startsWith('manual-file-')) {
      const body = readCuratedFile(id, 'manual');
      if (body == null) return res.status(404).json({ ok: false, error: 'manual file not found' });
      return res.json({ ok: true, id, body });
    }
    if (id.startsWith('team-file-')) {
      const body = readCuratedFile(id, 'team');
      if (body == null) return res.status(404).json({ ok: false, error: 'team file not found' });
      return res.json({ ok: true, id, body });
    }
    if (id.startsWith('archive-file-')) {
      const body = readCuratedFile(id, 'archive');
      if (body == null) return res.status(404).json({ ok: false, error: 'archive file not found' });
      return res.json({ ok: true, id, body });
    }
    if (id.startsWith('memory-')) {
      const date = id.replace('memory-', '');
      const full = path.join(MEMORY_DIR, `${date}.md`);
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
module.exports._test = { normalizeSearchQuery, makeSearchSnippet, searchDocuments };
