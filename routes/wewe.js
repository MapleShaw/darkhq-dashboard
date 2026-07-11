/**
 * routes/wewe.js
 * 代理转发 wewe-rss tRPC 接口，供 wewe.html 使用
 *
 * GET  /api/wewe/accounts         → account.list
 * GET  /api/wewe/feeds            → feed.list
 * POST /api/wewe/login/start      → platform.createLoginUrl
 * GET  /api/wewe/login/poll       → platform.getLoginResult?input={"id":"xxx"}
 * POST /api/wewe/login/add        → account.add
 * POST /api/wewe/feeds/refresh    → feed.refreshArticles
 * POST /api/wewe/feeds/add        → platform.getMpInfo + feed.add, or MP_WXS id direct add
 * POST /api/wewe/feeds/delete     → feed.delete
 */

'use strict';

const express = require('express');
const http    = require('http');
const router  = express.Router();

const WEWE_BASE = 'http://localhost:4000';
const WEWE_AUTH = '123567';

// ── 内部请求工具 ────────────────────────────────────────────
function weweGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${WEWE_BASE}/trpc/${path}`;
    http.get(url, { headers: { authorization: WEWE_AUTH } }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('parse error: ' + body.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function wewePost(path, payload) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(payload);
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: `/trpc/${path}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'authorization': WEWE_AUTH,
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('parse error: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function wewePostBatch(path, payload) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify({ 0: payload });
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: `/trpc/${path}?batch=1`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'authorization': WEWE_AUTH,
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('parse error: ' + body.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function dataToResult(data) {
  if (Array.isArray(data)) return data[0]?.result?.data?.json ?? data[0]?.result?.data ?? data[0];
  return data?.result?.data?.json ?? data?.result?.data ?? data;
}

// ── 账号列表 ─────────────────────────────────────────────────
router.get('/api/wewe/accounts', async (req, res) => {
  try {
    const { data } = await weweGet('account.list?input={}');
    // 响应结构: data.result.data
    const result = data?.result?.data || data;
    res.json({ ok: true, accounts: result?.items || [] });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── Feed 列表 ────────────────────────────────────────────────
router.get('/api/wewe/feeds', async (req, res) => {
  try {
    const { data } = await weweGet('feed.list?input={}');
    const result = data?.result?.data || data;
    res.json({ ok: true, feeds: result?.items || [] });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── 登录：生成二维码 ─────────────────────────────────────────
router.post('/api/wewe/login/start', async (req, res) => {
  try {
    const { data } = await wewePost('platform.createLoginUrl', {});
    const result = data?.result?.data || data;
    // wewe-rss 返回字段: uuid, scanUrl, qrSvg
    const key = result?.uuid || result?.key;
    const qrCodeUrl = result?.scanUrl || result?.qrCodeUrl;
    const qrSvg = result?.qrSvg || null;
    if (!key) {
      return res.status(502).json({ ok: false, error: '获取登录信息失败', raw: result });
    }
    res.json({ ok: true, qrCodeUrl, qrSvg, key });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── 登录：轮询结果 ───────────────────────────────────────────
router.get('/api/wewe/login/poll', async (req, res) => {
  const key = req.query.key;
  if (!key) return res.status(400).json({ ok: false, error: 'missing key' });
  try {
    const input = encodeURIComponent(JSON.stringify({ id: key }));
    const { data } = await weweGet(`platform.getLoginResult?input=${input}`);
    const result = data?.result?.data || data;
    // 登录成功时 result 包含 token 字段
    res.json({ ok: true, token: result?.token || null, status: result?.status || null, raw: result });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── 登录：写入账号 ───────────────────────────────────────────
router.post('/api/wewe/login/add', async (req, res) => {
  const { id, token, name, status } = req.body || {};
  if (!id || !token || !name) return res.status(400).json({ ok: false, error: 'missing fields' });
  try {
    const { data } = await wewePost('account.add', { id, token, name, status: status ?? 1 });
    const result = data?.result?.data || data;
    res.json({ ok: true, account: result });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});


// ── Feed：添加公众号订阅 ─────────────────────────────────────
router.post('/api/wewe/feeds/add', async (req, res) => {
  const rawInput = req.body?.mpIds || req.body?.ids || req.body?.wxsLinks || req.body?.links || req.body?.wxsLink || req.body?.link;
  const inputs = (Array.isArray(rawInput) ? rawInput : String(rawInput || '').split(/\n+/))
    .map(v => String(v).trim())
    .filter(Boolean);

  if (!inputs.length) return res.status(400).json({ ok: false, error: 'missing mpId' });

  const added = [];
  const failed = [];

  async function addFeed(feedPayload, source) {
    const { data: addData } = await wewePost('feed.add', feedPayload);
    added.push(dataToResult(addData) || feedPayload);

    // 添加后后台触发一次抓取，不阻塞页面响应
    wewePost('feed.refreshArticles', { mpId: feedPayload.id })
      .catch(e => console.error('[wewe] refresh new feed error:', e.message));
  }

  for (const input of inputs) {
    try {
      if (/^MP_WXS_\d+$/i.test(input)) {
        const id = input.toUpperCase();
        await addFeed({
          id,
          mpName: id,
          mpCover: '',
          mpIntro: '',
          updateTime: Math.floor(Date.now() / 1000),
          status: 1,
        }, input);
        continue;
      }

      const { data: infoData } = await wewePost('platform.getMpInfo', { wxsLink: input });
      const infos = dataToResult(infoData);
      const items = Array.isArray(infos) ? infos : [];
      if (!items.length) {
        failed.push({ input, error: '未识别到公众号信息。请确认微信读书账号已登录，链接是 mp.weixin.qq.com/s/... 文章链接；也可直接填写 MP_WXS_... 公众号源 ID。' });
        continue;
      }

      for (const item of items) {
        await addFeed({
          id: String(item.id),
          mpName: item.name || item.mpName || String(item.id),
          mpCover: item.cover || item.mpCover || '',
          mpIntro: item.intro || item.mpIntro || '',
          updateTime: Number(item.updateTime || Math.floor(Date.now() / 1000)),
          status: 1,
        }, input);
      }
    } catch (e) {
      failed.push({ input, error: e.message });
    }
  }

  res.json({ ok: added.length > 0, added, failed });
});

// ── Feed：删除公众号订阅 ─────────────────────────────────────
router.post('/api/wewe/feeds/delete', async (req, res) => {
  const mpId = req.body?.mpId || req.body?.id;
  if (!mpId) return res.status(400).json({ ok: false, error: 'missing mpId' });
  try {
    const { data } = await wewePostBatch('feed.delete', mpId);
    const result = dataToResult(data);
    if (result?.error || result?.statusCode >= 400) return res.status(502).json({ ok: false, error: result.message || result.error?.message || '删除失败', raw: result });
    res.json({ ok: true, id: mpId, raw: result });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ── Feed：触发抓取 ───────────────────────────────────────────
router.post('/api/wewe/feeds/refresh', async (req, res) => {
  const { mpId } = req.body || {};
  // 不 await——wewe-rss 单个 feed 抓取是同步阻塞的，可能跑 10-30s
  // 立刻返回 202 Accepted，让抓取在后台进行
  wewePost('feed.refreshArticles', mpId ? { mpId } : {})
    .catch(e => console.error('[wewe] refreshArticles error:', e.message));
  res.json({ ok: true, async: true });
});

module.exports = router;
