/* 老巢控制台 · app.js v3.2 · 仅负责 index.html 业务 */

// ── 时钟 ──────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const el = document.getElementById('clock');
  if (el) el.textContent = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);
updateClock();

// ── 工具 ────────────────────────────────────────────
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const mo = d.getMonth() + 1;
    const da = d.getDate();
    const h  = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mo}/${da} ${h}:${mi}`;
  } catch (e) { return iso; }
}
function fmtAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const d = Math.floor(hr / 24);
  return `${d} 天前`;
}
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function statusBadge(s) {
  const key = (s || 'unknown').toLowerCase();
  const map = {
    success: ['ok',   '搞掂'],
    ok:      ['ok',   '搞掂'],
    failed:  ['err',  '失手'],
    error:   ['err',  '失手'],
    running: ['warn', '开工中'],
    unknown: ['dim',  '未知'],
  };
  const [cls, label] = map[key] || ['dim', '未知'];
  return `<span class="badge ${cls}">${label}</span>`;
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function fmtNum(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }

// ── KPI 顶部 ───────────────────────────────────────
function updateStats({ bots, cron, signal }) {
  if (bots) {
    const total = bots.bots ? bots.bots.length : 0;
    const online = bots.gatewayOnline ? bots.bots.filter((b) => b.status !== 'offline').length : 0;
    setText('sum-total', total);
    setText('sum-online', `${online}/${total}`);
    setText('sum-online-sub', bots.gatewayOnline ? '线路正常' : '线路断了');
    const el = document.getElementById('sum-online-sub');
    if (el) el.className = 'stat-sub ' + (bots.gatewayOnline ? 'ok' : 'err');
  }
  if (cron) setText('sum-cron', cron.jobs ? cron.jobs.length : 0);
  if (signal) {
    const sigs = signal.signals || [];
    const top = sigs[0];
    if (top) {
      setText('sum-signal-score', top.title ? (top.title.length > 32 ? top.title.slice(0, 32) + '…' : top.title) : '—');
      setText('sum-signal-time', fmtTime(top.publishedAt));
    } else {
      setText('sum-signal-score', '暂无风声');
      setText('sum-signal-time', '');
    }
  }
}

// ── 顶栏 Gateway 标签 ────────────────────────────────
function updateGatewayPill(online) {
  const pill = document.getElementById('gateway-status');
  if (!pill) return;
  pill.className = 'status-chip ' + (online ? 'ok' : 'err');
  pill.innerHTML = `<span class="dot"></span><span>${online ? '线路正常' : '线路断了'}</span>`;
}

// ── Bot 舰队 ──────────────────────────────────────
async function loadBots() {
  const grid = document.getElementById('bot-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">载入中…</div>';
  try {
    const data = await fetch('/api/bots').then((r) => r.json());
    updateGatewayPill(data.gatewayOnline);
    setText('bot-count', `${(data.bots || []).length} 位兄弟`);

    // 喂给心跳卡 side 信息
    window.__lastBotsData = data;
    renderHeartbeat(data);

    const bots = data.bots || [];
    if (!bots.length) {
      grid.innerHTML = '<div class="empty"><span class="empty-icon">🤖</span>暂无 Bot</div>';
      updateStats({ bots: data });
      return;
    }
    grid.innerHTML = bots.map(renderBotCard).join('');
    updateStats({ bots: data });
  } catch (e) {
    grid.innerHTML = `<div class="empty"><span class="empty-icon">⚠</span>${esc(e.message)}</div>`;
  }
}

function renderBotCard(bot) {
  const status = bot.status || (bot.online ? 'online' : 'offline');
  const statusLabel = { online: '在场', running: '开工中', offline: '失联' }[status] || status;

  const avatar = bot.avatarUrl
    ? `<img src="${esc(bot.avatarUrl)}" alt="${esc(bot.name)}" onerror="this.style.display='none'">`
    : '🤖';

  const nowTaskLine = bot.currentTask
    ? `<div class="bot-card-meta-row">
         <span class="key">正在开工</span>
         <span class="val"><span class="emoji">⟳</span>${esc(bot.currentTask)}</span>
       </div>`
    : `<div class="bot-card-meta-row">
         <span class="key">目前</span>
         <span class="val">${statusLabel === '在场' ? '候命中' : statusLabel}</span>
       </div>`;

  const lastTaskLine = bot.lastTaskName
    ? `<div class="bot-card-meta-row">
         <span class="key">最近一单</span>
         <span class="val">${statusBadge(bot.lastTaskStatus)} ${esc(bot.lastTaskName)}</span>
       </div>
       <div class="bot-card-meta-row">
         <span class="key">收工</span>
         <span class="val mono">${fmtAgo(bot.lastTaskTime)} · ${fmtTime(bot.lastTaskTime)}</span>
       </div>`
    : `<div class="bot-card-meta-row">
         <span class="key">最近活跃</span>
         <span class="val">${esc(bot.lastSeen || '—')}</span>
       </div>`;

  const tokenLine = `
    <div class="bot-card-meta-row">
      <span class="key">今日 Token</span>
      <span class="val mono">${bot.todayTokens != null ? fmtNum(bot.todayTokens) : '—'}</span>
    </div>`;

  return `
  <a href="/docs.html?bot=${esc(bot.id)}" class="bot-card">
    <div class="bot-card-top">
      <div class="bot-card-avatar">${avatar}</div>
      <div class="bot-card-identity">
        <div class="bot-card-name">
          ${esc(bot.name)}
          <span class="bot-card-code">${esc((bot.codename || '').toUpperCase())}</span>
        </div>
        <div class="bot-card-role">${esc(bot.role)}</div>
      </div>
      <div class="bot-card-indicator ${status}">
        <span class="dot"></span>${statusLabel}
      </div>
    </div>
    <div class="bot-card-meta">
      ${nowTaskLine}
      ${lastTaskLine}
      ${tokenLine}
      <div class="bot-card-meta-row">
        <span class="key">本周</span>
        <span class="val">${bot.weekTasks != null ? bot.weekTasks + ' 单' : '—'}</span>
      </div>
    </div>
    <div class="bot-card-footer">
      <span class="model">${esc(bot.model)}</span>
      <span>睇卷宗 →</span>
    </div>
  </a>`;
}

// ── 定时任务预览 ──────────────────────────────────
async function loadCronPreview() {
  const list = document.getElementById('cron-preview');
  if (!list) return;
  list.innerHTML = '<div class="loading">载入中…</div>';
  try {
    const data = await fetch('/api/cron').then((r) => r.json());
    const jobs = (data.jobs || []).slice(0, 4);
    if (!jobs.length) {
      list.innerHTML = '<div class="empty"><span class="empty-icon">⏰</span>暂无任务</div>';
      updateStats({ cron: data });
      return;
    }
    list.innerHTML = `
      <div class="cron-head">
        <div>例牌</div><div>状态</div><div>上次</div><div>下次</div><div>时辰</div>
      </div>
      ${jobs.map(renderCronRow).join('')}`;
    updateStats({ cron: data });
  } catch (e) {
    list.innerHTML = `<div class="empty"><span class="empty-icon">⚠</span>${esc(e.message)}</div>`;
  }
}
function renderCronRow(job) {
  return `
  <div class="cron-row">
    <div class="cron-name"><span class="emoji">${job.emoji || '⚙'}</span><span class="txt">${esc(job.name)}</span></div>
    <div>${statusBadge(job.status)}</div>
    <div class="cron-time">${fmtTime(job.lastRun)}</div>
    <div class="cron-time next">${fmtTime(job.nextRun)}</div>
    <div class="cron-schedule">${esc(job.schedule)}</div>
  </div>`;
}

// ── 信号预览 ──────────────────────────────────────
async function loadSignalPreview() {
  const grid = document.getElementById('signal-preview');
  if (!grid) return;
  grid.innerHTML = '<div class="loading">扫描信号中…</div>';
  try {
    const data = await fetch('/api/signals').then((r) => r.json());
    const sigs = (data.signals || []).slice(0, 3);
    if (!sigs.length) {
      grid.innerHTML = '<div class="empty"><span class="empty-icon">📡</span>暂无风声</div>';
      updateStats({ signal: data });
      return;
    }
    grid.innerHTML = sigs.map(renderSignalCard).join('');
    updateStats({ signal: data });
  } catch (e) {
    grid.innerHTML = `<div class="empty"><span class="empty-icon">⚠</span>${esc(e.message)}</div>`;
  }
}
function renderSignalCard(sig) {
  return `
  <article class="signal-card">
    <div class="signal-top">
      <span class="signal-tag"><span class="tag-dot ${esc(sig.source)}"></span>${esc((sig.source || '').toUpperCase())} · ${esc(sig.sourceName)}</span>
      <span class="signal-score">${sig.score || 0}</span>
    </div>
    <h3 class="signal-title">
      ${sig.url ? `<a href="${esc(sig.url)}" target="_blank" rel="noopener">${esc(sig.title)}</a>` : esc(sig.title)}
    </h3>
    ${sig.summary ? `<p class="signal-summary">${esc(sig.summary)}</p>` : ''}
    <div class="signal-meta"><span>${fmtTime(sig.publishedAt)}</span></div>
  </article>`;
}

// ── 心跳卡（侧栏主卡）──────────────────────────────
// 本地不依赖真实 ping，直接用浏览器前端探测 /health 的耗时，外加随机抖动生成 sparkline
const HB_HISTORY = [];
async function measureHeartbeat() {
  const t0 = performance.now();
  let ok = false;
  try {
    const r = await fetch('/health', { cache: 'no-store' });
    const j = await r.json();
    ok = j.ok === true;
  } catch (e) {}
  const lat = Math.max(4, Math.round(performance.now() - t0));
  return { ok, lat, at: new Date() };
}

async function pollHeartbeat() {
  const rec = await measureHeartbeat();
  HB_HISTORY.push(rec);
  if (HB_HISTORY.length > 30) HB_HISTORY.shift();
  paintHeartbeat();
}

function paintHeartbeat() {
  if (!HB_HISTORY.length) return;
  const last = HB_HISTORY[HB_HISTORY.length - 1];
  setText('hb-latency', last.lat);
  setText('hb-updated', fmtAgo(last.at.toISOString()));

  // 趋势：用最近 5 条的平均 vs 前 5 条
  const arr = HB_HISTORY.map((h) => h.lat);
  const recent = arr.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, arr.length);
  const older = arr.length > 5 ? arr.slice(-10, -5).reduce((a, b) => a + b, 0) / Math.min(5, arr.length - 5) : recent;
  const delta = recent - older;
  const trendEl = document.getElementById('hb-trend');
  if (trendEl) {
    if (arr.length < 5) { trendEl.textContent = '校准中'; trendEl.className = 'trend'; }
    else if (delta < -1) { trendEl.textContent = `↓ ${Math.abs(delta).toFixed(1)}ms`; trendEl.className = 'trend'; }
    else if (delta > 1)  { trendEl.textContent = `↑ ${delta.toFixed(1)}ms`;          trendEl.className = 'trend err'; }
    else                  { trendEl.textContent = '稳定';                            trendEl.className = 'trend'; }
  }

  // sparkline 绘制
  const svg = document.getElementById('hb-spark');
  if (svg && arr.length >= 2) {
    const W = 200, H = 48, pad = 3;
    const max = Math.max(...arr, 10);
    const min = Math.min(...arr, 0);
    const range = Math.max(1, max - min);
    const step = (W - pad * 2) / (arr.length - 1);
    const pts = arr.map((v, i) => [pad + i * step, H - pad - ((v - min) / range) * (H - pad * 2)]);
    const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${H - pad} L${pts[0][0].toFixed(1)},${H - pad} Z`;
    const lastPt = pts[pts.length - 1];
    svg.innerHTML = `
      <path class="area" d="${area}"/>
      <path class="line" d="${line}"/>
      <circle cx="${lastPt[0].toFixed(1)}" cy="${lastPt[1].toFixed(1)}" r="3"/>`;
  }
}

function renderHeartbeat(data) {
  setText('hb-status', data.gatewayOnline ? '接通' : '断线');
  setText('hb-uptime', data.uptime || '—');
  setText('hb-host', data.host || '—');
  const st = document.getElementById('hb-status');
  if (st) st.style.color = data.gatewayOnline ? '#5bffa8' : '#ff9aa0';
}

// ── Token 用量迷你卡 ─────────────────────────────
async function loadTokenMini() {
  const host = document.getElementById('token-mini');
  if (!host) return;
  try {
    const data = await fetch('/api/usage').then((r) => r.json());
    const u = data.usage || {};
    const models = u.models || [];
    const total = u.totalTokens || 0;
    const period = u.statPeriod ? esc(u.statPeriod) : '累计';
    const tz = u.timezone ? esc(u.timezone) : '本地时区';
    host.innerHTML = `
      <div class="token-mini-top">
        <span class="total">${fmtNum(total)}</span>
        <span class="today">今日 <strong>${fmtNum(u.todayTokens || 0)}</strong></span>
      </div>
      <div class="token-bar-stack">
        ${models.map((m, i) => `<div class="token-bar-seg s${i}" style="width:${m.pct}%"></div>`).join('')}
      </div>
      <div class="token-model">
        ${models.map((m, i) => `
          <div class="token-model-row">
            <span><span class="token-bar-seg s${i}" style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:0.4rem;vertical-align:middle"></span>${esc(m.model)}</span>
            <span class="n">${fmtNum(m.tokens)} · ${m.pct}%</span>
          </div>`).join('')}
      </div>
      <div style="font-size:0.68rem;color:var(--text-3);padding-top:0.6rem;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:0.4rem;flex-wrap:wrap">
        <span>口径：${period}</span>
        <span>${tz}</span>
      </div>`;
  } catch (e) {
    host.innerHTML = `<div class="empty"><span class="empty-icon">⚠</span>${esc(e.message)}</div>`;
  }
}

// ── 统一刷新 ──────────────────────────────────────
function loadAll() {
  loadBots();
  loadCronPreview();
  loadSignalPreview();
  loadTokenMini();
  pollHeartbeat();
}

function init() {
  loadAll();
  // 大数据源 5 分钟，信号 15 分钟
  setInterval(() => { loadBots(); loadCronPreview(); loadTokenMini(); }, 5 * 60 * 1000);
  setInterval(() => { loadSignalPreview(); }, 15 * 60 * 1000);
  // 心跳 5 秒一次
  setInterval(pollHeartbeat, 5000);
}
document.addEventListener('DOMContentLoaded', init);
