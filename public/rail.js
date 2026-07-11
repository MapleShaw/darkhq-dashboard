/* 公共 rail 渲染 · 在所有页面共享
   用法：在 HTML 里放 <aside class="rail" data-active="dashboard|cron|signals|docs|settings"></aside>
        再 <script src="rail.js"></script>
*/
(function () {
  const NAV = [
    { key: 'dashboard', href: '/',             label: '堂口', section: 'main' },
    { key: 'cron',      href: '/cron.html',    label: '日程', section: 'main' },
    { key: 'signals',   href: '/signals.html', label: '风声', section: 'main' },
    { key: 'docs',      href: '/docs.html',    label: '卷宗', section: 'main' },
    { key: 'wewe',      href: '/wewe.html',    label: '微读', section: 'main' },
    { key: 'headroom',  href: '/headroom.html', label: '省流', section: 'main' },
    { key: 'status',    href: '/status.html',   label: '健康', section: 'main' },
    { key: 'settings',  href: '/settings.html', label: '设置', section: 'bottom' },
  ];

  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
    cron:      '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    signals:   '<path d="M2 12a10 10 0 0 1 20 0"/><path d="M5 12a7 7 0 0 1 14 0"/><path d="M8.5 12a3.5 3.5 0 0 1 7 0"/><circle cx="12" cy="12" r="1"/>',
    docs:      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
    wewe:      '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    headroom:  '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    status:    '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };

  function iconSvg(key) {
    return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[key] || ''}</svg>`;
  }

  function renderRail(rail) {
    const active = rail.dataset.active || '';
    const main = NAV.filter((n) => n.section === 'main');
    const bottom = NAV.filter((n) => n.section === 'bottom');

    const renderItem = (n) => `
      <a class="rail-item ${n.key === active ? 'active' : ''}" href="${n.href}">
        <span class="rail-icon">${iconSvg(n.key)}</span>
        <span class="rail-label">${n.label}</span>
      </a>`;

    rail.innerHTML = `
      <a href="/" class="rail-logo" title="老巢">
        <img src="/avatars/logo.png" alt="logo" onerror="this.outerHTML='🏴‍☠️'">
      </a>
      <div class="rail-section-label">Workspace</div>
      ${main.map(renderItem).join('')}
      <div class="rail-spacer"></div>
      ${bottom.map(renderItem).join('')}
    `;
  }

  document.querySelectorAll('aside.rail').forEach(renderRail);

  // ── 移动端底部 tab bar ──────────────────────────────────
  const BOTTOM_TABS = [
    { key: 'dashboard', href: '/',              label: '堂口', icon: '🏴' },
    { key: 'cron',      href: '/cron.html',     label: '日程', icon: '📅' },
    { key: 'signals',   href: '/signals.html',  label: '风声', icon: '📡' },
    { key: 'docs',      href: '/docs.html',     label: '卷宗', icon: '📂' },
    { key: 'wewe',      href: '/wewe.html',     label: '微读', icon: '📰' },
    { key: 'headroom',  href: '/headroom.html', label: '省流', icon: '⚡' },
    { key: 'status',    href: '/status.html',   label: '健康', icon: '🩺' },
    { key: 'settings',  href: '/settings.html', label: '设置', icon: '⚙️' },
  ];

  function renderBottomNav() {
    // Determine active page from the rail data-active attribute
    const rail = document.querySelector('aside.rail');
    const active = (rail && rail.dataset.active) || '';

    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.innerHTML = BOTTOM_TABS.map((tab) => `
      <a class="bottom-nav-item ${tab.key === active ? 'active' : ''}" href="${tab.href}">
        <span class="bottom-nav-icon">${tab.icon}</span>
        <span>${tab.label}</span>
      </a>`).join('');
    document.body.appendChild(nav);
  }

  renderBottomNav();
})();
