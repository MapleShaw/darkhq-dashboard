/**
 * routes/sources.js
 * GET    /api/sources         → 列出可用信息源及已禁用的 default 源
 * POST   /api/sources         → 添加自定义源
 * DELETE /api/sources/:type   → 删除 custom 源，或禁用 default 源
 * POST   /api/sources/enable  → 恢复已禁用的 default 源
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const router  = express.Router();
const homedir = require('os').homedir();

const CUSTOM_SOURCES_PATH = path.join(homedir, '.content-signal-radar', 'custom-sources.json');
const DISABLED_DEFAULTS_PATH = path.join(homedir, '.content-signal-radar', 'disabled-defaults.json');
const DEFAULT_SOURCES_CANDIDATES = [
  path.join(homedir, 'content-signal-radar', 'config', 'default-sources.json'),
  path.join(homedir, '.openclaw', 'workspace', 'content-signal-radar', 'config', 'default-sources.json')
];
const VALID_TYPES = ['x_accounts', 'blogs', 'podcasts', 'jike_accounts', 'bilibili_accounts'];
const IDENTITY_FIELDS = {
  x_accounts: ['handle', 'username', 'name'],
  blogs: ['indexUrl', 'rsshub', 'url', 'name'],
  podcasts: ['channelHandle', 'playlistId', 'url', 'name'],
  jike_accounts: ['uuid', 'rsshub', 'name'],
  bilibili_accounts: ['uid', 'rsshub', 'name']
};
const INTERNAL_FIELDS = new Set(['_type', '_layer', '_isDefault', '_id']);

function resolveDefaultSourcesPath() {
  return DEFAULT_SOURCES_CANDIDATES.find(file => fs.existsSync(file)) || DEFAULT_SOURCES_CANDIDATES[0];
}

function safeReadJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function safeWriteJson(file, data) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
    return true;
  } catch (e) { return false; }
}

function cleanItem(item, { keepProfile = false } = {}) {
  const cleaned = {};
  for (const [key, value] of Object.entries(item || {})) {
    if (INTERNAL_FIELDS.has(key) || (!keepProfile && key === '_profile')) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

function sourceIdentity(type, item) {
  const field = (IDENTITY_FIELDS[type] || ['name']).find(key => item && item[key] != null && String(item[key]).trim());
  const value = field ? String(item[field]).trim().toLowerCase().replace(type === 'x_accounts' ? /^@/ : /$^/, '') : JSON.stringify(cleanItem(item));
  const profile = item && item._profile ? String(item._profile).trim().toLowerCase() : '';
  return `${type}:${profile}:${field || 'json'}:${value}`;
}

function normalizeDisabled(raw) {
  const result = {};
  for (const type of VALID_TYPES) result[type] = Array.isArray(raw[type]) ? raw[type] : [];
  return result;
}

function getAllSources() {
  const defaults = safeReadJson(resolveDefaultSourcesPath(), { profiles: {} });
  const custom = safeReadJson(CUSTOM_SOURCES_PATH, {});
  const disabled = normalizeDisabled(safeReadJson(DISABLED_DEFAULTS_PATH, {}));
  const disabledIds = new Set();
  for (const type of VALID_TYPES) {
    for (const item of disabled[type]) disabledIds.add(sourceIdentity(type, item));
  }

  const result = {
    defaultProfiles: Object.keys(defaults.profiles || {}),
    default: {},
    custom: {},
    disabled: {}
  };
  for (const type of VALID_TYPES) {
    result.default[type] = [];
    result.custom[type] = Array.isArray(custom[type]) ? custom[type] : [];
    result.disabled[type] = disabled[type];
  }

  for (const [profileName, profile] of Object.entries(defaults.profiles || {})) {
    for (const type of VALID_TYPES) {
      for (const source of profile[type] || []) {
        const item = { ...source, _profile: profileName, _isDefault: true };
        if (!disabledIds.has(sourceIdentity(type, item))) result.default[type].push(item);
      }
    }
  }
  return result;
}

router.get('/api/sources', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ok: true, data: getAllSources() });
});

router.post('/api/sources', (req, res) => {
  const { type, item } = req.body || {};
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ ok: false, error: `Invalid type: ${type}` });
  if (!item || typeof item !== 'object' || Array.isArray(item)) return res.status(400).json({ ok: false, error: 'item is required' });

  const custom = safeReadJson(CUSTOM_SOURCES_PATH, {});
  if (!Array.isArray(custom[type])) custom[type] = [];
  const clean = cleanItem(item);
  const identity = sourceIdentity(type, clean);
  if (custom[type].some(existing => sourceIdentity(type, existing) === identity)) {
    return res.status(409).json({ ok: false, error: 'Item already exists' });
  }

  custom[type].push(clean);
  if (!safeWriteJson(CUSTOM_SOURCES_PATH, custom)) return res.status(500).json({ ok: false, error: 'Failed to write' });
  res.json({ ok: true, data: clean });
});

router.delete('/api/sources/:type', (req, res) => {
  const { type } = req.params;
  const { item, layer = 'custom' } = req.body || {};
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ ok: false, error: `Invalid type: ${type}` });
  if (!item || typeof item !== 'object' || Array.isArray(item)) return res.status(400).json({ ok: false, error: 'item is required' });

  if (layer === 'default') {
    if (!item._profile) return res.status(400).json({ ok: false, error: '_profile is required for default items' });
    const defaults = getAllSources().default[type];
    const identity = sourceIdentity(type, item);
    if (!defaults.some(existing => sourceIdentity(type, existing) === identity)) {
      return res.status(404).json({ ok: false, error: 'Default item not found or already disabled' });
    }
    const disabled = normalizeDisabled(safeReadJson(DISABLED_DEFAULTS_PATH, {}));
    const record = cleanItem(item, { keepProfile: true });
    if (!disabled[type].some(existing => sourceIdentity(type, existing) === identity)) disabled[type].push(record);
    if (!safeWriteJson(DISABLED_DEFAULTS_PATH, disabled)) return res.status(500).json({ ok: false, error: 'Failed to write disabled defaults' });
    return res.json({ ok: true, disabled: 1 });
  }

  if (layer !== 'custom') return res.status(400).json({ ok: false, error: `Invalid layer: ${layer}` });
  const custom = safeReadJson(CUSTOM_SOURCES_PATH, {});
  if (!Array.isArray(custom[type])) return res.status(404).json({ ok: false, error: 'Type not found' });
  const identity = sourceIdentity(type, item);
  const beforeLen = custom[type].length;
  custom[type] = custom[type].filter(existing => sourceIdentity(type, existing) !== identity);
  if (custom[type].length === beforeLen) return res.status(404).json({ ok: false, error: 'Item not found' });
  if (!safeWriteJson(CUSTOM_SOURCES_PATH, custom)) return res.status(500).json({ ok: false, error: 'Failed to write' });
  res.json({ ok: true, removed: beforeLen - custom[type].length });
});

router.post('/api/sources/enable', (req, res) => {
  const { type, item } = req.body || {};
  if (!VALID_TYPES.includes(type)) return res.status(400).json({ ok: false, error: `Invalid type: ${type}` });
  if (!item || typeof item !== 'object' || Array.isArray(item)) return res.status(400).json({ ok: false, error: 'item is required' });

  const disabled = normalizeDisabled(safeReadJson(DISABLED_DEFAULTS_PATH, {}));
  const identity = sourceIdentity(type, item);
  const beforeLen = disabled[type].length;
  disabled[type] = disabled[type].filter(existing => sourceIdentity(type, existing) !== identity);
  if (disabled[type].length === beforeLen) return res.status(404).json({ ok: false, error: 'Disabled item not found' });
  if (!safeWriteJson(DISABLED_DEFAULTS_PATH, disabled)) return res.status(500).json({ ok: false, error: 'Failed to write disabled defaults' });
  res.json({ ok: true, enabled: beforeLen - disabled[type].length });
});

module.exports = router;
