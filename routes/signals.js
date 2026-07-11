/**
 * routes/signals.js
 * GET /api/signals
 * GET /api/signals/history
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const {
  SIGNAL_DIR,
  DATA_SIGNALS_ARCHIVE,
  safeReadJson,
  todayKey,
} = require('../lib/config');

// ── 共用函数：读取当前所有信号 ────────────────────────────
function liveSignalsAll() {
  const all = [];
  const covered = new Set();

  const dashData = safeReadJson(path.join(SIGNAL_DIR, 'dashboard-signals.json'), null);
  if (dashData && Array.isArray(dashData.signals)) {
    dashData.signals.forEach((item) => {
      all.push({
        id: item.id || item.url,
        source: item.source,
        sourceName: item.sourceName || item.handle || '',
        title: item.title,
        url: item.url,
        summary: item.summary || '',
        reason: item.reviewNote || (item.topic ? `[${item.topic}]` : '高信号内容'),
        score: item.score || 70,
        publishedAt: item.publishedAt || dashData.generatedAt,
        generatedAt: dashData.generatedAt,
        needsReview: item.needsReview || false,
      });
      if (item.source) covered.add(item.source);
    });
  }

  const readFallback = (src, fname, key, mapFn) => {
    if (covered.has(src)) return;
    const data = safeReadJson(path.join(SIGNAL_DIR, fname), null);
    if (!data || !Array.isArray(data[key])) return;
    data[key].forEach((item) => all.push(mapFn(item, data)));
  };

  readFallback('blog', 'feed-blogs.json', 'blogs', (item, data) => ({
    id: item.url, source: 'blog', sourceName: item.name || 'Blog',
    title: item.title, url: item.url,
    summary: item.description || (item.content ? item.content.slice(0, 200) + '...' : ''),
    reason: item.aiReason || '高质量技术内容', score: item.score || 70,
    publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));
  readFallback('x', 'feed-x.json', 'x', (item, data) => ({
    id: item.id || item.url, source: 'x', sourceName: item.author || 'X',
    title: (item.text || 'Tweet').slice(0, 80), url: item.url,
    summary: item.text || '', reason: item.aiReason || '热门讨论',
    score: item.score || 65, publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));
  readFallback('podcast', 'feed-podcasts.json', 'podcasts', (item, data) => ({
    id: item.url || item.title, source: 'podcast', sourceName: item.show || 'Podcast',
    title: item.title, url: item.url,
    summary: item.description ? item.description.slice(0, 200) + '...' : '',
    reason: item.aiReason || '深度内容', score: item.score || 70,
    publishedAt: item.publishedAt || data.generatedAt,
    generatedAt: data.generatedAt,
  }));

  all.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  return all;
}

// ─── GET /api/signals ─────────────────────────────────────
router.get('/api/signals', (req, res) => {
  const source = req.query.source || 'all';
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockSignals(source));

  const all = liveSignalsAll();

  // 归档当日全量
  if (all.length) {
    const key = todayKey();
    const archiveFile = path.join(DATA_SIGNALS_ARCHIVE, `${key}.json`);
    try {
      fs.writeFileSync(archiveFile, JSON.stringify({ date: key, signals: all }, null, 2), 'utf8');
    } catch (e) {}
  }

  const filtered = source === 'all' ? all : all.filter((s) => s.source === source);
  const generatedAt = all.length ? (all[0].generatedAt || null) : null;
  res.json({ ok: true, signals: filtered, total: filtered.length, generatedAt });
});

// ─── GET /api/signals/history ─────────────────────────────
router.get('/api/signals/history', async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 30);
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockSignalsHistory(days));

  try {
    const files = fs.readdirSync(DATA_SIGNALS_ARCHIVE)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    const byDate = new Map();
    for (const f of files) {
      const data = safeReadJson(path.join(DATA_SIGNALS_ARCHIVE, f));
      if (!data || !Array.isArray(data.signals)) continue;
      const seen = new Set();
      const uniq = data.signals.filter((s) => {
        const k = s.id || s.url || s.title;
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      byDate.set(data.date || f.replace('.json', ''), uniq);
    }

    // 今日实时
    const today = todayKey();
    try {
      const live = liveSignalsAll();
      if (live.length) {
        const existing = byDate.get(today) || [];
        byDate.set(today, live.length >= existing.length ? live : existing);
      }
    } catch (e) {}

    const list = [...byDate.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, days)
      .map(([date, signals]) => ({ date, signals }));

    res.json({ ok: true, days: list });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
