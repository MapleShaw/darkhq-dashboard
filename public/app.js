/* 老巢控制台 · app.js v3.3 · 仅负责 index.html 业务 */

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
function normalizeStatus(s) {
  const key = String(s || '').trim().toLowerCase();
  if (!key) return 'unknown';
  if (key === 'ok' || key === 'done' || key === 'completed' || key === 'complete') return 'success';
  if (key === 'error' || key === 'fail' || key === 'failure') return 'failed';
  if (key === 'need_confirmation' || key === 'needs-confirmation' || key === 'confirm' || key === 'pending_confirmation') return 'needs_confirmation';
  if (key === 'pending' || key === 'in_progress') return 'running';
  return key;
}
function statusBadge(s) {
  const key = normalizeStatus(s);
  const map = {
    success: ['ok',   '搞掂'],
    failed:  ['err',  '失手'],
    needs_confirmation: ['warn', '待确认'],
    running: ['warn', '开工中'],
    unknown: ['dim',  '未知'],
  };
  const [cls, label] = map[key] || ['dim', '未知'];
  return `<span class="badge ${cls}">${label}</span>`;
}
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function fmtNum(n) { if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'; return String(n); }
const INTERNAL_TASK_TYPES = new Set(['darkhq_task_flow', 'readonly_audit']);
const TASK_TYPE_LABELS = {
  darkhq_task_flow: 'DarkHQ 任务流水修复',
  readonly_audit: '幽灵任务审计',
};
function isInternalMarker(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (TASK_TYPE_LABELS[s]) return true;
  if (/^[a-z]+-[a-z0-9_-]+$/.test(s) || /^[a-z0-9_]+$/.test(s)) return true;
  return false;
}
function cleanTaskTitle(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const m = raw.match(/^([a-z][a-z0-9_]{2,80})\s*[:：]\s*(.+)$/i);
  if (m && (TASK_TYPE_LABELS[m[1]] || INTERNAL_TASK_TYPES.has(m[1]) || isInternalMarker(m[1]))) return m[2].trim();
  return raw;
}
function humanTaskTitle(name) {
  const raw = String(name || '').replace(/\s+/g, ' ').trim();
  const cleaned = cleanTaskTitle(raw);
  const m = raw.match(/^([a-z][a-z0-9_]{2,80})\s*[:：]\s*(.+)$/i);
  if (m && TASK_TYPE_LABELS[m[1]]) return TASK_TYPE_LABELS[m[1]];
  return cleaned || '—';
}
function humanTaskSummary(name) {
  return cleanTaskTitle(name) || '—';
}

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

  const lastTaskTitle = bot.lastTaskTitle || bot.lastTaskName;
  const lastTaskSummary = bot.lastTaskSummary || bot.lastTaskName;
  const lastTaskLine = lastTaskTitle
    ? `<div class="bot-card-meta-row last-task">
         <span class="key">最近一单</span>
         <span class="val task-title" title="${esc(lastTaskTitle)}"><span>${esc(humanTaskTitle(lastTaskTitle))}</span></span>
       </div>
       <div class="bot-card-meta-row last-task-result">
         <span class="key">上一单结果</span>
         <span class="val">${statusBadge(bot.lastTaskStatus)}</span>
       </div>
       <div class="bot-card-meta-row last-task-summary">
         <span class="key">摘要</span>
         <span class="val task-summary" title="${esc(lastTaskSummary)}">${esc(humanTaskSummary(lastTaskSummary))}</span>
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
      <span class="val mono" ${bot.todayTokens == null ? 'title="ZenMux API 无 per-agent 统计，需 gateway 侧自行实现"' : ''}>
        ${bot.todayTokens != null ? fmtNum(bot.todayTokens) : '<span style="color:var(--text-3);font-size:0.75em">— 暂无数据</span>'}
      </span>
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
function stripLeadingEmoji(name) {
  const value = String(name == null ? '' : name);
  const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const clusters = segmenter ? Array.from(segmenter.segment(value), part => part.segment) : Array.from(value);
  let index = 0;
  while (index < clusters.length && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(clusters[index])) index += 1;
  return clusters.slice(index).join('').replace(/^\s+/, '');
}
function renderCronRow(job) {
  return `
  <div class="cron-row">
    <div class="cron-name"><span class="emoji">${job.emoji || '⚙'}</span><span class="txt">${esc(stripLeadingEmoji(job.name))}</span></div>
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

// 全局缓存 usage 数据，供 receipt 直接用
let _usageCache = null;

async function loadTokenMini() {
  const host = document.getElementById('token-mini');
  if (!host) return;
  try {
    const data = await fetch('/api/usage').then((r) => r.json());
    const u = data.usage || {};
    _usageCache = u;
    const models = u.models || [];
    const total = u.totalTokens || 0;
    const totalUSD = u.totalUSD ? `$${parseFloat(u.totalUSD).toFixed(2)}` : null;
    const period = u.statPeriod ? esc(u.statPeriod) : '累计';
    const tz = u.timezone ? esc(u.timezone) : '本地时区';
    const hasUSD = models.length && models[0].costUSD != null;
    host.innerHTML = `
      <div class="token-mini-top">
        ${totalUSD
          ? `<span class="total">${totalUSD}</span>`
          : `<span class="total">${fmtNum(total)}</span>`
        }
      </div>
      <div class="token-bar-stack">
        ${models.map((m, i) => `<div class="token-bar-seg s${i}" style="width:${m.pct}%"></div>`).join('')}
      </div>
      <div class="token-model">
        ${models.slice(0, 5).map((m, i) => `
          <div class="token-model-row">
            <span><span class="token-bar-seg s${i}" style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:0.4rem;vertical-align:middle"></span>${esc(m.model)}</span>
            <span class="n">${hasUSD ? '$' + parseFloat(m.costUSD).toFixed(4) : fmtNum(m.tokens)} · ${m.pct}%</span>
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

// ── Token Receipt ──────────────────────────────────────────────

const RECEIPT_LOGO_LINES = [
'      ██████       ',
'   ██████████████  ',
'   ██  ███  █████  ',
'   ██████████████  ',
'   ██  ▀▀▀  █████  ',
'   ▝▀▀▀▀▀▀▀▀▀▀▀▘  ',
];
function buildLogoBlock(W = 46) {
  return RECEIPT_LOGO_LINES.map(l => {
    const pad = Math.floor((W - l.length) / 2);
    return ' '.repeat(Math.max(0, pad)) + l;
  }).join('\n');
}

const RECEIPT_FOOTERS = [
  'QUOTA IS NOT BUDGET. BUDGET IS VIBES.',
  'THE SESSION ENDED. THE TOKENS DID NOT.',
  "LAST PROMPT WASN'T THE LAST.",
  'DARK HQ WATCHED. TOKENS BURNED.',
  '老巢还在。预算死了。',
  '消耗稳了。钱包动了。',
  '每一个 token，都是你的选择。',
  'THE LOGO LOOKS CALM. THE BILL DOES NOT.',
];

// 计算字符串的视觉宽度（CJK 字符算 2 宽）
function rcptWidth(s) {
  let w = 0;
  for (const c of s) { w += (c.charCodeAt(0) > 0x7f) ? 2 : 1; }
  return w;
}
function rcptLine(left, right, W = 46) {
  const gap = W - rcptWidth(left) - rcptWidth(right);
  if (gap <= 0) return left + ' ' + right;
  return left + ' '.repeat(gap) + right;
}
function rcptHr(ch = '━', W = 46) { return ch.repeat(W); }
function rcptCenter(s, W = 46) {
  const vw = rcptWidth(s);
  if (vw >= W) return s;
  const pad = Math.floor((W - vw) / 2);
  return ' '.repeat(pad) + s;
}
function rcptBar(pct, width = 20) {
  const f = pct > 0 ? Math.max(1, Math.round(pct * width)) : 0;
  return '█'.repeat(f) + '░'.repeat(width - f);
}
function rcptBarcode(seed, W = 46) {
  const chars = ['███','██','█','▊','▎'];
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h << 5) + h) ^ seed.charCodeAt(i);
  let s = '';
  for (let i = 0; i < W; i++) { h = ((h << 5) + h) ^ i; s += chars[Math.abs(h) % chars.length][0]; }
  return s;
}

function buildReceipt(u) {
  const W = 46;
  const models = u.models || [];
  const totalUSD = u.totalUSD ? parseFloat(u.totalUSD) : null;
  const period = u.statPeriod || 'N/A';
  const tz = u.timezone || 'Asia/Shanghai';
  const sub = u.subscription || {};
  const plan = sub.plan || {};
  const q7 = sub.quota_7_day || {};
  const q5h = sub.quota_5_hour || {};
  const now = new Date().toLocaleString('zh-CN', { timeZone: tz, hour12: false });
  const receiptId = 'DH_' + Date.now().toString(36).toUpperCase();
  const footer = RECEIPT_FOOTERS[Math.floor(Math.random() * RECEIPT_FOOTERS.length)];
  const hasUSD = models.length && models[0].costUSD != null;

  const rows = [];

  // Logo + header
  rows.push(buildLogoBlock(W));
  rows.push('');
  rows.push(rcptCenter('老巢指挥部', W));
  rows.push(rcptCenter('DARK HQ COMMAND', W));
  rows.push('');
  rows.push(rcptCenter('感谢你让 token 为老巢发光发热', W));
  rows.push(rcptLine('RECEIPT #:', receiptId, W));
  rows.push(rcptLine('DATE:', now, W));
  rows.push(rcptHr('━', W));

  // Meta
  rows.push(rcptLine('SOURCE', 'ZenMux API', W));
  if (plan.tier) {
    rows.push(rcptLine('PLAN', plan.tier.toUpperCase() + ' · $' + plan.amount_usd + '/mo', W));
  }
  rows.push(rcptLine('PERIOD', period, W));
  rows.push(rcptHr('─', W));

  // 模型明细
  rows.push(rcptLine('MODEL', hasUSD ? 'COST       PCT' : 'TOKENS     PCT', W));
  rows.push(rcptHr('─', W));
  models.forEach((m) => {
    const name = m.model.length > 26 ? m.model.slice(0, 24) + '..' : m.model;
    const costStr = hasUSD
      ? ('$' + parseFloat(m.costUSD).toFixed(4)).padStart(8)
      : String(m.tokens || 0).padStart(9);
    const right = costStr + '  ' + String(m.pct).padStart(2) + '%';
    rows.push(rcptLine(name, right, W));
  });

  rows.push(rcptHr('━', W));
  if (totalUSD != null) {
    rows.push(rcptLine('TOTAL SPEND', ('$' + totalUSD.toFixed(4)).padStart(12), W));
  }

  // 配额
  if (q7.used_value_usd != null) {
    rows.push(rcptHr('─', W));
    rows.push(rcptLine('QUOTA 7D', '$' + q7.used_value_usd + ' / $' + q7.max_value_usd, W));
    rows.push('  [' + rcptBar(q7.usage_percentage || 0, 22) + '] ' + Math.round((q7.usage_percentage || 0) * 100) + '%');
  }
  if (q5h.used_value_usd != null) {
    rows.push(rcptLine('QUOTA 5H', '$' + q5h.used_value_usd + ' / $' + q5h.max_value_usd, W));
    rows.push('  [' + rcptBar(q5h.usage_percentage || 0, 22) + '] ' + Math.round((q5h.usage_percentage || 0) * 100) + '%');
  }

  rows.push(rcptHr('━', W));
  rows.push(rcptCenter(footer, W));
  rows.push('');
  rows.push(rcptBarcode(receiptId, W));
  rows.push(rcptCenter(receiptId, W));

  return rows.join('\n');
}

async function showReceipt() {
  const overlay = document.getElementById('receipt-overlay');
  const paper = document.getElementById('receipt-paper');
  const modal = overlay.querySelector('.receipt-modal');

  // 重置状态
  overlay.classList.remove('open');
  paper.textContent = '';
  modal.classList.remove('receipt-printing', 'receipt-done');

  // 先显示打印机外壳
  overlay.classList.add('open');
  modal.classList.add('receipt-printing');

  try {
    const data = _usageCache
      ? { usage: _usageCache }
      : await fetch('/api/usage').then((r) => r.json());
    const receiptText = buildReceipt(data.usage || data);

    // 逐行打印动画
    const lines = receiptText.split('\n');
    paper.textContent = '';
    let i = 0;
    const printLine = () => {
      if (i < lines.length) {
        paper.textContent += (i === 0 ? '' : '\n') + lines[i];
        i++;
        // 滚动到底部
        paper.scrollTop = paper.scrollHeight;
        // 模拟打印机节奏：内容行快，分隔线稍慢
        const line = lines[i - 1];
        const delay = (line.includes('━') || line.includes('─')) ? 60 :
                      line.trim() === '' ? 20 : 28;
        setTimeout(printLine, delay);
      } else {
        modal.classList.remove('receipt-printing');
        modal.classList.add('receipt-done');
        // 打印完成后显示操作按钮
        const actions = document.getElementById('receipt-actions');
        if (actions) actions.style.display = 'flex';
      }
    };
    // 打印机预热延迟
    setTimeout(printLine, 400);
  } catch (e) {
    modal.classList.remove('receipt-printing');
    paper.textContent = '打印失败：' + e.message;
    const actions = document.getElementById('receipt-actions');
    if (actions) actions.style.display = 'flex';
  }
}

function closeReceipt(e) {
  if (e.target === document.getElementById('receipt-overlay')) {
    const overlay = document.getElementById('receipt-overlay');
    overlay.classList.remove('open');
    const actions = document.getElementById('receipt-actions');
    if (actions) actions.style.display = 'none';
  }
}

function copyReceipt() {
  const text = document.getElementById('receipt-paper').textContent;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.receipt-actions button');
    const orig = btn.textContent;
    btn.textContent = '已复制 ✓';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  });
}

// ── 统一刷新 ──────────────────────────────────────
function loadAll() {
  loadBots();
  fetch("/api/version").then(r=>r.json()).then(d=>{if(d.ok){const el=document.getElementById("sys-version");if(el)el.textContent="v"+d.version;}}).catch(()=>{});
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
