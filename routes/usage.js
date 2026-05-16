/**
 * routes/usage.js
 * GET /api/usage
 * GET /api/subscription
 */

'use strict';

const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

const {
  ZENMUX_MGMT_KEY,
  ZENMUX_SUBSCRIPTION_URL,
  ZENMUX_TIMESERIES_URL,
} = require('../lib/config');

// 5 分钟服务端缓存
const ZENMUX_CACHE_TTL_MS = 5 * 60 * 1000;
let _zenmuxUsageCache   = null;
let _zenmuxUsageCacheAt = 0;
let _zenmuxSubCache     = null;
let _zenmuxSubCacheAt   = 0;

async function fetchSubscription() {
  if (!ZENMUX_MGMT_KEY) throw new Error('ZENMUX_MGMT_KEY not set');
  if (_zenmuxSubCache && Date.now() - _zenmuxSubCacheAt < ZENMUX_CACHE_TTL_MS) return _zenmuxSubCache;
  const r = await fetch(ZENMUX_SUBSCRIPTION_URL, {
    headers: { Authorization: `Bearer ${ZENMUX_MGMT_KEY}` },
    timeout: 5000,
  });
  if (!r.ok) throw new Error(`ZenMux subscription API error: ${r.status}`);
  const j = await r.json();
  if (!j.success) throw new Error('ZenMux subscription API returned success=false');
  _zenmuxSubCache = j.data;
  _zenmuxSubCacheAt = Date.now();
  return j.data;
}

// ZenMux timeseries API 单位常量
const MC_TO_USD   = 100000;  // cost raw → USD
const TOK_TO_REAL = 1000;    // tokens raw → actual tokens

/**
 * 取订阅周期的起止时间
 * 返回 { periodStart: Date, expiresAt: Date, sub, tomorrowISO: string }
 */
async function getPeriodRange() {
  const sub = await fetchSubscription();
  const expiresAt = new Date(sub.plan.expires_at);
  const periodStart = new Date(expiresAt);
  periodStart.setMonth(periodStart.getMonth() - 1);
  periodStart.setDate(periodStart.getDate() - 1);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { periodStart, expiresAt, sub, tomorrowISO: tomorrow.toISOString() };
}

/** 从 timeseries 响应里取 series 数组 */
const getSeries = (resp) =>
  (resp && resp.data && Array.isArray(resp.data.series)) ? resp.data.series : [];

/**
 * 取最后一个有数据的 bucket（= 最近计费日）
 * ZenMux 今日数据约延迟 1 天，series 最后一条是「最近计费日」
 */
function extractLatestDay(series, metric) {
  if (!series.length) return { date: null, value: 0 };
  const last = series[series.length - 1];
  const raw = (last.models || []).reduce((s, m) => s + (m.value || 0), 0);
  const value = metric === 'tokens'
    ? Math.round(raw / TOK_TO_REAL)
    : parseFloat((raw / MC_TO_USD).toFixed(4));
  return { date: last.date || null, value };
}

async function fetchZenMuxUsage() {
  if (!ZENMUX_MGMT_KEY) throw new Error('ZENMUX_MGMT_KEY not set');
  if (_zenmuxUsageCache && Date.now() - _zenmuxUsageCacheAt < ZENMUX_CACHE_TTL_MS) return _zenmuxUsageCache;

  const { periodStart, expiresAt, sub, tomorrowISO } = await getPeriodRange();
  const headers = { Authorization: `Bearer ${ZENMUX_MGMT_KEY}` };
  const periodStartISO = periodStart.toISOString();

  // 并行拉取 cost + tokens 两条 timeseries
  const [costRes, tokRes] = await Promise.all([
    fetch(
      `${ZENMUX_TIMESERIES_URL}?metric=cost&bucket_width=1d&starting_at=${encodeURIComponent(periodStartISO)}&ending_at=${encodeURIComponent(tomorrowISO)}`,
      { headers, timeout: 8000 }
    ),
    fetch(
      `${ZENMUX_TIMESERIES_URL}?metric=tokens&bucket_width=1d&starting_at=${encodeURIComponent(periodStartISO)}&ending_at=${encodeURIComponent(tomorrowISO)}`,
      { headers, timeout: 8000 }
    ),
  ]);
  if (!costRes.ok) throw new Error(`ZenMux cost timeseries error: ${costRes.status}`);
  if (!tokRes.ok)  throw new Error(`ZenMux tokens timeseries error: ${tokRes.status}`);

  const [costData, tokData] = await Promise.all([costRes.json(), tokRes.json()]);
  const costSeries = getSeries(costData);
  const tokSeries  = getSeries(tokData);

  // ── 周期总计 ──────────────────────────────────────────────────
  const totalRaw = costSeries.reduce(
    (acc, b) => acc + (b.models || []).reduce((s, m) => s + (m.value || 0), 0), 0
  );
  const totalUSD = (totalRaw / MC_TO_USD).toFixed(2);

  const totalTokRaw = tokSeries.reduce(
    (acc, b) => acc + (b.models || []).reduce((s, m) => s + (m.value || 0), 0), 0
  );
  const totalTokens = Math.round(totalTokRaw / TOK_TO_REAL);

  // ── 模型分布（按花费排序，取 top 10）──────────────────────────
  const modelMap = {};
  costSeries.forEach((bucket) => {
    (bucket.models || []).forEach((m) => {
      const slug = m.model === '__others__' ? 'others' : m.model;
      if (!modelMap[slug]) modelMap[slug] = { raw: 0, label: m.label || slug };
      modelMap[slug].raw += (m.value || 0);
    });
  });
  const models = Object.entries(modelMap)
    .map(([id, { raw, label }]) => ({
      id,
      model: label,
      costUSD: parseFloat((raw / MC_TO_USD).toFixed(4)),
      pct: Math.round((raw / (totalRaw || 1)) * 100),
    }))
    .sort((a, b) => b.costUSD - a.costUSD)
    .slice(0, 10);

  // ── 最近计费日（ZenMux 今日数据约延迟 1 天）─────────────────
  const latestCost = extractLatestDay(costSeries, 'cost');
  const latestTok  = extractLatestDay(tokSeries,  'tokens');
  const latestDay = {
    date:    latestCost.date,   // 'YYYY-MM-DD'
    costUSD: latestCost.value,
    tokens:  latestTok.value,
    note:    'ZenMux 数据约延迟 1 天，此为最近有数据的计费日',
  };

  // ── 日期范围文字 ───────────────────────────────────────────────
  const fmtDate = (d) => {
    const sh = new Date(d.getTime() + 8 * 3600 * 1000);
    return `${sh.getUTCFullYear()}-${String(sh.getUTCMonth() + 1).padStart(2, '0')}-${String(sh.getUTCDate()).padStart(2, '0')}`;
  };
  const statPeriod = `${fmtDate(periodStart)} → ${fmtDate(expiresAt)}`;

  const result = {
    totalUSD,
    totalTokens,
    statPeriod,
    timezone: 'Asia/Shanghai',
    models,
    latestDay,
    // bots[] 留空：ZenMux API 无 per-agent 维度，需 gateway 侧自行统计
    bots: [],
    subscription: sub,
  };
  _zenmuxUsageCache = result;
  _zenmuxUsageCacheAt = Date.now();
  return result;
}

// ─── GET /api/subscription ────────────────────────────────
router.get('/api/subscription', async (req, res) => {
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) {
    return res.json({ ok: true, data: mockData.mockSubscription ? mockData.mockSubscription() : null });
  }
  try {
    const data = await fetchSubscription();
    return res.json({ ok: true, data });
  } catch (e) {
    console.warn('[subscription] failed:', e.message);
    return res.json({ ok: false, error: e.message });
  }
});

// ─── GET /api/usage ───────────────────────────────────────
router.get('/api/usage', async (req, res) => {
  const { USE_MOCK, mockData } = req.app.locals;
  if (USE_MOCK) return res.json(mockData.mockUsage());

  try {
    const usage = await fetchZenMuxUsage();
    return res.json({ ok: true, usage, source: 'zenmux' });
  } catch (e) {
    console.warn('[usage] ZenMux API failed:', e.message);
  }

  return res.json({
    ok: true,
    notConnected: true,
    reason: 'ZenMux API 调用失败，请检查 ZENMUX_MGMT_KEY 配置',
  });
});

module.exports = router;

// ─── GET /api/usage/trend ─────────────────────────────────
// 返回按天的花费趋势数据，复用 ZenMux timeseries
let _trendCache = null;
let _trendCacheAt = 0;

async function fetchTrend() {
  if (!ZENMUX_MGMT_KEY) throw new Error('ZENMUX_MGMT_KEY not set');
  if (_trendCache && Date.now() - _trendCacheAt < ZENMUX_CACHE_TTL_MS) return _trendCache;

  const { periodStart, tomorrowISO } = await getPeriodRange();
  const headers = { Authorization: `Bearer ${ZENMUX_MGMT_KEY}` };
  const tsRes = await fetch(
    `${ZENMUX_TIMESERIES_URL}?metric=cost&bucket_width=1d&starting_at=${encodeURIComponent(periodStart.toISOString())}&ending_at=${encodeURIComponent(tomorrowISO)}`,
    { headers, timeout: 8000 }
  );
  if (!tsRes.ok) throw new Error(`ZenMux timeseries API error: ${tsRes.status}`);
  const tsData = await tsRes.json();

  const trend = getSeries(tsData).map((bucket) => {
    const raw = (bucket.models || []).reduce((s, m) => s + (m.value || 0), 0);
    return {
      date:    (bucket.date || bucket.period || '').slice(0, 10),
      costUSD: parseFloat((raw / MC_TO_USD).toFixed(4)),
    };
  }).filter((d) => d.date);

  _trendCache = trend;
  _trendCacheAt = Date.now();
  return trend;
}

router.get('/api/usage/trend', async (req, res) => {
  const { USE_MOCK } = req.app.locals;
  if (USE_MOCK) {
    // 生成 30 天 mock 数据
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      trend.push({ date: d.toISOString().slice(0, 10), costUSD: parseFloat((Math.random() * 0.8 + 0.05).toFixed(4)) });
    }
    return res.json({ ok: true, trend });
  }
  try {
    const trend = await fetchTrend();
    return res.json({ ok: true, trend });
  } catch (e) {
    console.warn('[usage/trend] failed:', e.message);
    return res.json({ ok: false, error: e.message });
  }
});
