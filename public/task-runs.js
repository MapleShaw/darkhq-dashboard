/* DarkHQ · 任务流水页面：Bot 动态任务，不等同 cron 例牌 */
(function () {
  'use strict';

  const ACTORS = {
    main: '老大',
    assistant: '跟班',
    content: '洗脑专家',
    intel: '线人',
    tech: '键盘杀手',
  };
  const STATUS_LABELS = {
    success: ['ok', '搞掂'],
    failed: ['err', '失手'],
    needs_confirmation: ['warn', '待确认'],
    running: ['warn', '开工中'],
    unknown: ['dim', '未知'],
  };
  const TASK_TYPE_LABELS = {
    darkhq_task_flow: 'DarkHQ 任务流水修复',
    readonly_audit: '幽灵任务审计',
  };

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    if (value == null) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function attr(value) { return esc(value).replace(/`/g, '&#96;'); }
  function text(value, fallback = '—') {
    const s = value == null ? '' : String(value);
    return s.trim() ? s : fallback;
  }
  function updateClock() {
    const n = new Date();
    const el = $('clock');
    if (el) el.textContent = [n.getHours(), n.getMinutes(), n.getSeconds()].map((x) => String(x).padStart(2, '0')).join(':');
  }
  function fmtTime(iso) {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return text(iso);
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function fmtDur(ms) {
    if (ms == null || ms === '') return '—';
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1000) return `${Math.round(n)}ms`;
    if (n < 60000) return `${(n / 1000).toFixed(1)}s`;
    return `${Math.round(n / 60000)}m ${Math.round((n % 60000) / 1000)}s`;
  }
  function normalizeStatus(status) {
    const key = String(status || '').trim().toLowerCase();
    if (!key) return 'unknown';
    if (key === 'ok' || key === 'done' || key === 'completed' || key === 'complete') return 'success';
    if (key === 'error' || key === 'fail' || key === 'failure') return 'failed';
    if (key === 'need_confirmation' || key === 'needs-confirmation' || key === 'confirm' || key === 'pending_confirmation') return 'needs_confirmation';
    if (key === 'pending' || key === 'in_progress') return 'running';
    return key;
  }
  function statusBadge(status) {
    const key = normalizeStatus(status);
    const pair = STATUS_LABELS[key] || ['dim', '未知'];
    return `<span class="badge ${pair[0]}" data-status="${attr(key)}">${esc(pair[1])}</span>`;
  }
  function dotColor(status) {
    return { success: 'var(--ok)', failed: 'var(--err)', needs_confirmation: 'var(--warn)', running: 'var(--warn)' }[normalizeStatus(status)] || 'var(--text-3)';
  }
  function actorLabel(actor) { return ACTORS[actor] || actor || '—'; }
  function taskTypeLabel(taskType) {
    const raw = String(taskType || '').trim();
    return TASK_TYPE_LABELS[raw] || '';
  }
  function isInternalMarker(value) {
    const s = String(value || '').trim();
    if (!s) return false;
    if (TASK_TYPE_LABELS[s]) return true;
    return /^[a-z0-9_]+$/.test(s) || /^[a-z]+-[a-z0-9_-]+$/.test(s);
  }
  function displayTitle(r) {
    if (text(r.title, '')) return text(r.title, '');
    const labeled = taskTypeLabel(r.taskType);
    if (labeled) return labeled;
    const summary = text(r.summary, '');
    return summary || actorLabel(r.actor);
  }
  function displaySummary(r) {
    const summary = text(r.summary, '');
    if (summary && !isInternalMarker(summary)) return summary;
    const labeled = taskTypeLabel(r.taskType);
    return labeled || summary || '—';
  }
  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((x) => String(x == null ? '' : x)).filter((x) => x.trim()).slice(0, 50);
  }
  function listBlock(title, items) {
    const arr = normalizeItems(items);
    if (!arr.length) return '';
    return `<div class="task-run-detail-block"><label>${esc(title)}</label><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }
  function counts(runs) {
    const by = { total: runs.length, success: 0, failed: 0, needs_confirmation: 0, running: 0 };
    runs.forEach((r) => {
      const s = normalizeStatus(r.status);
      if (s === 'success') by.success += 1;
      else if (s === 'failed') by.failed += 1;
      else if (s === 'needs_confirmation') by.needs_confirmation += 1;
      else if (s === 'running') by.running += 1;
    });
    return by;
  }
  function paintStats(runs, skipped) {
    const c = counts(runs);
    if ($('task-total')) $('task-total').textContent = c.total;
    if ($('task-success')) $('task-success').textContent = c.success;
    if ($('task-warn')) $('task-warn').textContent = c.needs_confirmation + c.running;
    if ($('task-skipped')) $('task-skipped').textContent = skipped || 0;
  }
  function renderRun(r, i) {
    const id = attr(`task-run-${i}`);
    const title = displayTitle(r);
    const summary = displaySummary(r);
    return `<details class="task-run-row" id="${id}">
      <summary title="${attr(summary)}">
        <div class="task-run-actor"><span class="actor-dot" style="background:${dotColor(r.status)}"></span><span>${esc(actorLabel(r.actor))}</span></div>
        <div>${statusBadge(r.status)}</div>
        <div class="task-run-main"><div class="task-run-title">${esc(title)}</div><div class="task-run-summary">${esc(summary)}</div></div>
        <div class="cron-time">${fmtTime(r.startedAt)}</div>
      </summary>
      <div class="task-run-detail">
        <div class="detail-field"><label>任务 ID</label><code>${esc(text(r.taskId))}</code></div>
        <div class="detail-field internal-field"><label>流水 ID / 内部类型</label><code>${esc(text(r.jobId))} · ${esc(text(r.taskType))}</code></div>
        <div class="detail-field"><label>执行者</label><span>${esc(actorLabel(r.actor))} · ${esc(text(r.actor))}</span></div>
        <div class="detail-field"><label>状态</label><span>${statusBadge(r.status)}</span></div>
        ${r.resolvedAt ? `<div class="detail-field"><label>关闭时间</label><span>${esc(text(r.resolvedAt))}</span></div>` : ''}
        ${r.resolutionSummary ? `<div class="detail-field" style="grid-column:1/-1"><label>关闭说明</label><span>${esc(r.resolutionSummary)}</span></div>` : ''}
        <div class="detail-field"><label>开始</label><span>${esc(text(r.startedAt))}</span></div>
        <div class="detail-field"><label>完成</label><span>${esc(text(r.finishedAt))}</span></div>
        <div class="detail-field"><label>耗时</label><span>${fmtDur(r.durationMs)}</span></div>
        <div class="detail-field"><label>下一步</label><span>${esc(text(r.nextAction))}</span></div>
        <div class="detail-field" style="grid-column:1/-1"><label>摘要</label><span>${esc(summary)}</span></div>
        ${listBlock('证据', r.evidence)}
        ${listBlock('产物', r.artifacts)}
        ${listBlock('阻塞', r.blockers)}
      </div>
    </details>`;
  }
  function setFilterFromQuery() {
    const qs = new URLSearchParams(location.search);
    const actor = qs.get('actor') || '';
    const status = qs.get('status') || '';
    if ($('task-run-actor')) $('task-run-actor').value = actor;
    if ($('task-run-status')) $('task-run-status').value = status;
  }
  function syncQuery(actor, status) {
    const qs = new URLSearchParams();
    if (actor) qs.set('actor', actor);
    if (status) qs.set('status', status);
    const next = qs.toString() ? `${location.pathname}?${qs}` : location.pathname;
    history.replaceState(null, '', next);
  }
  async function loadTaskRuns() {
    const list = $('task-runs');
    if (!list) return;
    list.innerHTML = '<div class="loading">载入中…</div>';
    const actor = $('task-run-actor') ? $('task-run-actor').value : '';
    const status = $('task-run-status') ? $('task-run-status').value : '';
    syncQuery(actor, status);
    const qs = new URLSearchParams({ limit: '120' });
    if (actor) qs.set('actor', actor);
    if (status) qs.set('status', status);
    try {
      const response = await fetch(`/api/task-runs?${qs.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const runs = Array.isArray(data.runs) ? data.runs : [];
      paintStats(runs, Number(data.skipped || data.errors || 0));
      if (!runs.length) {
        list.innerHTML = '<div class="empty"><span class="empty-icon">📋</span>暂无任务流水</div>';
        return;
      }
      list.innerHTML = `<div class="task-run-head"><div>执行者 / 类型</div><div>状态</div><div>摘要</div><div>时间</div></div>${runs.map(renderRun).join('')}`;
    } catch (err) {
      paintStats([], 0);
      list.innerHTML = `<div class="empty"><span class="empty-icon">⚠</span>${esc(err.message || err)}</div>`;
    }
  }

  window.loadTaskRuns = loadTaskRuns;
  window.updateClock = updateClock;

  setInterval(updateClock, 1000);
  updateClock();
  document.addEventListener('DOMContentLoaded', () => {
    setFilterFromQuery();
    ['task-run-actor', 'task-run-status'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('change', loadTaskRuns);
    });
    loadTaskRuns();
  });
}());
