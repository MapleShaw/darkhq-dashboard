/* 老巢控制台 · 全站主题控制 */
(function () {
  const STORAGE_KEY = 'darkhq-theme';
  const root = document.documentElement;

  function storedTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch (_) {
      return null;
    }
  }

  function applyTheme(theme, persist) {
    const next = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = next;
    root.style.colorScheme = next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch (_) {}
    }
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const light = next === 'light';
      button.setAttribute('aria-label', light ? '切换到深色主题' : '切换到浅色主题');
      button.setAttribute('title', light ? '切换到深色主题' : '切换到浅色主题');
      button.setAttribute('aria-pressed', String(light));
      const label = button.querySelector('.theme-toggle-label');
      if (label) label.textContent = light ? '深色模式' : '浅色模式';
      const icon = button.querySelector('.theme-toggle-icon');
      if (icon) icon.textContent = light ? '☾' : '☀';
    });
    return next;
  }

  function toggleTheme() {
    return applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light', true);
  }

  applyTheme(storedTheme() || 'dark', false);

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    event.preventDefault();
    toggleTheme();
  });

  document.addEventListener('DOMContentLoaded', () => applyTheme(root.dataset.theme, false));

  window.DarkHQTheme = { apply: (theme) => applyTheme(theme, true), toggle: toggleTheme };
})();
