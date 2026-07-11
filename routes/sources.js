/**
 * routes/sources.js
 * GET /api/sources    → 列出所有信息源（default + custom）
 * POST /api/sources   → 添加自定义源到 custom-sources.json
 * DELETE /api/sources/:type → 删除自定义源
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();

const CUSTOM_SOURCES_PATH = path.join(
  require('os').homedir(), '.content-signal-radar', 'custom-sources.json'
);
const DEFAULT_SOURCES_CANDIDATES = [
  path.join(require('os').homedir(), 'content-signal-radar', 'config', 'default-sources.json'),
  path.join(require('os').homedir(), '.openclaw', 'workspace', 'content-signal-radar', 'config', 'default-sources.json')
];

function resolveDefaultSourcesPath() {
  return DEFAULT_SOURCES_CANDIDATES.find(file => fs.existsSync(file)) || DEFAULT_SOURCES_CANDIDATES[0];
}

function safeReadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function safeWriteJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

function getAllSources() {
  const defaults = safeReadJson(resolveDefaultSourcesPath(), { profiles: {} });
  const custom = safeReadJson(CUSTOM_SOURCES_PATH, {});

  const result = {
    defaultProfiles: Object.keys(defaults.profiles || {}),
    default: {},
    custom: {
      x_accounts: custom.x_accounts || [],
      blogs: custom.blogs || [],
      podcasts: custom.podcasts || [],
      jike_accounts: custom.jike_accounts || [],
      bilibili_accounts: custom.bilibili_accounts || []
    }
  };

  const typeKeys = ['x_accounts', 'blogs', 'podcasts', 'jike_accounts', 'bilibili_accounts'];
  for (const t of typeKeys) result.default[t] = [];

  for (const [name, profile] of Object.entries(defaults.profiles || {})) {
    for (const type of typeKeys) {
      const items = profile[type] || [];
      for (const item of items) {
        result.default[type].push({ ...item, _profile: name, _isDefault: true });
      }
    }
  }

  return result;
}

router.get('/api/sources', (req, res) => {
  res.json({ ok: true, data: getAllSources() });
});

router.post('/api/sources', (req, res) => {
  const { type, item } = req.body || {};
  const validTypes = ['x_accounts', 'blogs', 'podcasts', 'jike_accounts', 'bilibili_accounts'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ ok: false, error: `Invalid type: ${type}` });
  }
  if (!item || typeof item !== 'object') {
    return res.status(400).json({ ok: false, error: 'item is required' });
  }

  const custom = safeReadJson(CUSTOM_SOURCES_PATH, {});
  if (!custom[type]) custom[type] = [];

  const exists = custom[type].find(
    existing => JSON.stringify(existing) === JSON.stringify(item)
  );
  if (exists) {
    return res.status(409).json({ ok: false, error: 'Item already exists' });
  }

  custom[type].push(item);
  if (!safeWriteJson(CUSTOM_SOURCES_PATH, custom)) {
    return res.status(500).json({ ok: false, error: 'Failed to write' });
  }
  res.json({ ok: true, data: item });
});

router.delete('/api/sources/:type', (req, res) => {
  const { type } = req.params;
  const { item } = req.body || {};
  const validTypes = ['x_accounts', 'blogs', 'podcasts', 'jike_accounts', 'bilibili_accounts'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ ok: false, error: `Invalid type: ${type}` });
  }

  const custom = safeReadJson(CUSTOM_SOURCES_PATH, {});
  if (!custom[type] || !Array.isArray(custom[type])) {
    return res.status(404).json({ ok: false, error: 'Type not found' });
  }

  const beforeLen = custom[type].length;
  custom[type] = custom[type].filter(
    existing => JSON.stringify(existing) !== JSON.stringify(item)
  );

  if (custom[type].length === beforeLen) {
    return res.status(404).json({ ok: false, error: 'Item not found' });
  }

  if (!safeWriteJson(CUSTOM_SOURCES_PATH, custom)) {
    return res.status(500).json({ ok: false, error: 'Failed to write' });
  }
  res.json({ ok: true, removed: beforeLen - custom[type].length });
});

module.exports = router;
