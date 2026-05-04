/* 老巢控制台 · app.js v2 */

// ── Clock ──────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  const s = String(now.getSeconds()).padStart(2,'0');
  const el = document.getElementById('clock');
  if (el) el.textContent = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();

// ── Helpers ────────────────────────────────────────────
function formatTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const mo = d.getMonth()+1;
    const da = d.getDate();
    const h  = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    return `${mo}/${da} ${h}:${mi}`;
  } catch(e) { return iso; }
}

function statusLabel(s) {
  const map = {
    success:['✓ 成功','status-success'],
    ok:     ['✓ 成功','status-success'],
    failed: ['✗ 失败','status-failed'],
    error:  ['✗ 失败','status-failed'],
    running:['⟳ 运行中','status-running'],
    unknown:['— 未知','status-unknown'],
  };
  const key = (s||'unknown').toLowerCase();
  return map[key] || ['— 未知','status-unknown'];
}

function sourceTag(src, sourceName) {
  const tags = {
    blog:   ['tag-blog','📰 BLOG'],
    x:      ['tag-x','𝕏'],
    podcast:['tag-podcast','🎙 PODCAST'],
  };
  const [cls,label] = tags[src] || ['tag-default', src?.toUpperCase()||'FEED'];
  return `<span class="signal-source-tag ${cls}">${label}: ${sourceName||''}</span>`;
}

function escHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Bot emoji map
const BOT_EMOJI = {
  main:'🏴‍☠️', content:'🧠', tech:'⌨️', intel:'🕵️', assistant:'🤖'
};

// ── Summary Bar ────────────────────────────────────────
function updateSummary(botsData, cronData, signalsData) {
  if (botsData) {
    const total = botsData.bots ? botsData.bots.length : 0;
    const online = botsData.gatewayOnline ? total : 0;
    const el = document.getElementById('sum-total');
    const elO = document.getElementById('sum-online');
    const elOS = document.getElementById('sum-online-sub');
    if (el)  el.textContent = total;
    if (elO) elO.textContent = `${online}/${total}`;
    if (elOS) elOS.textContent = botsData.gatewayOnline ? 'gateway online' : 'gateway offline';
    if (elO) elO.style.color = botsData.gatewayOnline ? 'var(--green)' : 'var(--red)';
  }
  if (cronData) {
    const el = document.getElementById('sum-cron');
    if (el) el.textContent = cronData.jobs ? cronData.jobs.length : 0;
  }
  if (signalsData) {
    const sigs = signalsData.signals || [];
    const top = sigs[0];
    const elScore = document.getElementById('sum-signal-score');
    const elTime  = document.getElementById('sum-signal-time');
    if (top) {
      if (elScore) elScore.textContent = top.title ? top.title.slice(0,28)+'…' : '—';
      if (elTime)  elTime.textContent = formatTime(top.publishedAt);
    } else {
      if (elScore) elScore.textContent = '暂无信号';
    }
  }
}

// ── Bot Fleet ──────────────────────────────────────────
let botsCache = null;

async function loadBots() {
  const grid = document.getElementById('bot-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">载入中...</div>';
  try {
    const res = await fetch('/api/bots');
    const data = await res.json();
    botsCache = data;

    // Gateway status pill
    const pill = document.getElementById('gateway-status');
    if (pill) {
      if (data.gatewayOnline) {
        pill.innerHTML = '<span class="dot dot-cyan"></span><span>GATEWAY ONLINE</span>';
      } else {
        pill.innerHTML = '<span class="dot dot-red"></span><span>GATEWAY OFFLINE</span>';
      }
    }

    if (!data.bots || data.bots.length === 0) {
      grid.innerHTML = '<div class="empty-state"><span class="empty-icon">🤖</span>暂无 Bot 数据</div>';
    } else {
      grid.innerHTML = data.bots.map(bot => renderBotCard(bot, data.gatewayOnline)).join('');
      // attach click listeners
      grid.querySelectorAll('.bot-card-v2').forEach(card => {
        card.addEventListener('click', () => toggleBotCard(card));
      });
    }

    // Update sidebar info
    const gwText = document.getElementById('gw-status-text');
    if (gwText) gwText.textContent = data.gatewayOnline ? '在线' : '离线';
    if (gwText) gwText.style.color = data.gatewayOnline ? 'var(--green)' : 'var(--red)';
    const hostEl = document.getElementById('sys-host');
    if (hostEl) hostEl.textContent = data.host || 'VM-0-5';
    const uptimeEl = document.getElementById('sys-uptime');
    if (uptimeEl) uptimeEl.textContent = data.uptime || '—';

    updateSummary(data, null, null);
  } catch(e) {
    if (grid) grid.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败：${e.message}</div>`;
  }
}

function renderBotCard(bot, gatewayOnline) {
  const dotCls  = gatewayOnline ? 'dot-cyan' : 'dot-red';
  const statusTxt = gatewayOnline ? '在线' : '离线';
  const emoji   = BOT_EMOJI[bot.id] || '🤖';
  // mock channels count
  const taskCount = Math.floor(Math.random()*20)+3;
  return `
  <div class="bot-card-v2" data-id="${bot.id}">
    <div class="bot-card-top">
      <div class="bot-avatar">${emoji}</div>
      <div class="bot-info">
        <div class="bot-name">${bot.name}</div>
        <div class="bot-codename">[${bot.codename.toUpperCase()}]</div>
        <div class="bot-tags">
          <span class="bot-model">${bot.model}</span>
          <span class="bot-role">${bot.role}</span>
        </div>
        <div class="bot-lastseen-v2">⏱ ${bot.lastSeen}</div>
      </div>
      <div class="bot-indicator-v2">
        <span class="dot ${dotCls}"></span>
        <span>${statusTxt}</span>
      </div>
    </div>
    <div class="bot-detail" id="detail-${bot.id}">
      <div class="bot-detail-inner">
        <div class="bot-detail-item">
          <span class="bot-detail-label">负责频道</span>
          <span class="bot-detail-value">${bot.channel || 'telegram'}</span>
        </div>
        <div class="bot-detail-item">
          <span class="bot-detail-label">本周任务</span>
          <span class="bot-detail-value">${taskCount} 条</span>
        </div>
        <div class="bot-detail-item">
          <span class="bot-detail-label">代号</span>
          <span class="bot-detail-value">${bot.codename}</span>
        </div>
        <div class="bot-detail-item">
          <span class="bot-detail-label">模型</span>
          <span class="bot-detail-value">${bot.model}</span>
        </div>
      </div>
    </div>
    <div class="bot-expand-hint">▼ 点击展开详情</div>
  </div>`;
}

function toggleBotCard(card) {
  const id     = card.dataset.id;
  const detail = document.getElementById('detail-' + id);
  const hint   = card.querySelector('.bot-expand-hint');
  if (!detail) return;
  const isOpen = detail.classList.toggle('open');
  if (hint) hint.textContent = isOpen ? '▲ 点击收起' : '▼ 点击展开详情';
}

// ── Cron Preview (index page) ──────────────────────────
let cronCache = null;

async function loadCronPreview() {
  const table = document.getElementById('cron-preview');
  if (!table) return;
  table.innerHTML = '<div class="loading">载入中...</div>';
  try {
    const res  = await fetch('/api/cron');
    const data = await res.json();
    cronCache  = data;
    if (!data.jobs || data.jobs.length === 0) {
      table.innerHTML = '<div class="empty-state"><span class="empty-icon">⏰</span>暂无任务</div>';
    } else {
      const preview = data.jobs.slice(0, 3);
      const headerRow = `
        <div class="cron-row" style="background:rgba(0,0,0,0.3);border-color:rgba(0,212,255,0.08)">
          <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text-dim)">任务名称</div>
          <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text-dim)">状态</div>
          <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text-dim)">上次运行</div>
          <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text-dim)">下次运行</div>
        </div>`;
      const rows = preview.map(job => {
        const [statusText, statusClass] = statusLabel(job.status);
        return `
        <div class="cron-row">
          <div class="cron-name">
            <span>${job.emoji||''}</span>
            <span>${job.name}</span>
            <span class="cron-schedule" style="margin-left:auto;font-size:0.68rem;color:var(--yellow)">${job.schedule}</span>
          </div>
          <div><span class="cron-status ${statusClass}">${statusText}</span></div>
          <div class="cron-time"><span>${formatTime(job.lastRun)}</span></div>
          <div class="cron-time"><span class="next">▶ ${formatTime(job.nextRun)}</span></div>
        </div>`;
      }).join('');
      table.innerHTML = headerRow + rows;
    }
    updateSummary(null, data, null);
  } catch(e) {
    if (table) table.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span>加载失败：${e.message}</div>`;
  }
}

// ── Signal Preview (index page) ───────────────────────
let signalsCache = [];

async function loadSignalPreview() {
  const feed = document.getElementById('signal-preview');
  if (!feed) return;
  feed.innerHTML = '<div class="loading">扫描信号中...</div>';
  try {
    const res  = await fetch('/api/signals');
    const data = await res.json();
    signalsCache = data.signals || [];
    if (signalsCache.length === 0) {
      feed.innerHTML = '<div class="empty-state"><span class="empty-icon">📡</span>暂无信号</div>';
    } else {
      const preview = signalsCache.slice(0, 3);
      feed.innerHTML = preview.map(sig => `
        <div class="signal-card">
          <div class="signal-card-header">
            ${sourceTag(sig.source, sig.sourceName)}
            <span class="signal-score">🔥 ${sig.score||'?'}</span>
          </div>
          <div class="signal-title">
            ${sig.url
              ? `<a href="${sig.url}" target="_blank" rel="noopener">${escHtml(sig.title)}</a>`
              : escHtml(sig.title)}
          </div>
          ${sig.summary ? `<div class="signal-summary">${escHtml(sig.summary)}</div>` : ''}
          <div class="signal-meta">${formatTime(sig.publishedAt)}</div>
        </div>`
      ).join('');
    }
    updateSummary(null, null, data);
  } catch(e) {
    if (feed) feed.innerHTML = `<div class="empty-state"><span class="empty-icon">📡</span>加载失败：${e.message}</div>`;
  }
}

// ── Legacy compat (cron.html / signals.html may call these) ──────
async function loadCron()    { return loadCronPreview(); }
async function loadSignals() { return loadSignalPreview(); }

// ── Auto-refresh ───────────────────────────────────────
function init() {
  loadBots();
  loadCronPreview();
  loadSignalPreview();

  setInterval(() => { loadBots(); loadCronPreview(); }, 5*60*1000);
  setInterval(() => loadSignalPreview(), 15*60*1000);
}

document.addEventListener('DOMContentLoaded', init);
