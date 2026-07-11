/**
 * routes/headroom.js
 * 本地代理 Headroom proxy 状态与 dashboard，供 headroom.html 使用。
 *
 * 只访问 127.0.0.1，避免把 Headroom proxy 直接暴露到公网。
 */
'use strict';

const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const HEADROOM_BASE = process.env.HEADROOM_BASE || 'http://127.0.0.1:8787';
const JSON_ENDPOINTS = new Set([
  'health',
  'livez',
  'readyz',
  'stats',
  'stats-history',
  'quota',
  'subscription-window',
  'transformations/feed',
]);

function endpointUrl(endpoint, query = '') {
  const safeEndpoint = String(endpoint || '').replace(/^\/+|\/+$/g, '');
  const base = `${HEADROOM_BASE}/${safeEndpoint}`;
  return query ? `${base}?${query}` : base;
}

async function fetchText(endpoint, query = '') {
  const url = endpointUrl(endpoint, query);
  const r = await fetch(url, { timeout: 5000 });
  const text = await r.text();
  return { status: r.status, ok: r.ok, text, contentType: r.headers.get('content-type') || 'text/plain' };
}

router.get('/api/headroom', (req, res) => {
  res.json({ ok: true, base: HEADROOM_BASE, endpoints: Array.from(JSON_ENDPOINTS) });
});

router.get(/^\/api\/headroom\/(.+)$/, async (req, res) => {
  const endpoint = String(req.params[0] || '');
  if (!JSON_ENDPOINTS.has(endpoint) && endpoint !== 'metrics') {
    return res.status(404).json({ ok: false, error: 'unknown endpoint' });
  }

  try {
    const query = new URLSearchParams(req.query).toString();
    const upstream = await fetchText(endpoint, query);

    if (endpoint === 'metrics') {
      res.status(upstream.status).type(upstream.contentType.includes('text') ? upstream.contentType : 'text/plain');
      return res.send(upstream.text);
    }

    try {
      const data = JSON.parse(upstream.text);
      return res.status(upstream.status).json({ ok: upstream.ok, endpoint, data });
    } catch (e) {
      return res.status(502).json({ ok: false, endpoint, error: 'invalid json from headroom', raw: upstream.text.slice(0, 500) });
    }
  } catch (e) {
    return res.status(502).json({ ok: false, endpoint, error: e.message, offline: true });
  }
});


async function proxyDashboardEndpoint(req, res, endpoint) {
  try {
    const query = new URLSearchParams(req.query).toString();
    const upstream = await fetchText(endpoint, query);
    res.status(upstream.status).type(upstream.contentType.includes('json') ? 'application/json' : upstream.contentType);
    return res.send(upstream.text);
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message, offline: true });
  }
}

router.get('/api/headroom-dashboard/stats', (req, res) => proxyDashboardEndpoint(req, res, 'stats'));
router.get('/api/headroom-dashboard/health', (req, res) => proxyDashboardEndpoint(req, res, 'health'));
router.get('/api/headroom-dashboard/stats-history', (req, res) => proxyDashboardEndpoint(req, res, 'stats-history'));
router.get('/api/headroom-dashboard/transformations/feed', (req, res) => proxyDashboardEndpoint(req, res, 'transformations/feed'));

// 同源 dashboard 代理，方便从 darkhq iframe 打开；Headroom 本身仍只监听 127.0.0.1。
router.get('/api/headroom-dashboard', async (req, res) => {
  try {
    const upstream = await fetchText('dashboard');
    const basePath = '/api/headroom-dashboard';
    const html = upstream.text
      .replace(/fetch\(['"]\//g, (match) => match.replace('/', `${basePath}/`))
      .replace(/fetch\(`\//g, (match) => match.replace('/', `${basePath}/`));
    res.status(upstream.status).type('html').send(html);
  } catch (e) {
    res.status(502).type('html').send(`<!doctype html><meta charset="utf-8"><body style="background:#0a0a0c;color:#e6e6eb;font-family:sans-serif;padding:24px"><h2>Headroom dashboard unavailable</h2><p>${String(e.message)}</p></body>`);
  }
});

module.exports = router;
