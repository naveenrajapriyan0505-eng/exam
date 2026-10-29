/**
 * SmartProctor AI - Dark and Light Mode Theme Controller
 * Seamlessly manages Dark Mode (Obsidian Noir) and Light Mode (Crisp Monochrome)
 */
(function () {
  const THEME_KEY = 'smartproctor_theme';

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY) || 'dark';
    } catch (e) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {}
    syncThemeUI(theme);
  }

  function syncThemeUI(theme) {
    // 1. Update all toggle buttons
    const toggleBtns = document.querySelectorAll('.theme-toggle-btn');
    toggleBtns.forEach((btn) => {
      if (theme === 'light') {
        btn.innerHTML = '<span class="theme-icon">☀️</span> <span class="theme-label">Light Mode</span>';
        btn.setAttribute('title', 'Switch to Dark Mode');
        btn.setAttribute('aria-label', 'Switch to Dark Mode');
      } else {
        btn.innerHTML = '<span class="theme-icon">🌙</span> <span class="theme-label">Dark Mode</span>';
        btn.setAttribute('title', 'Switch to Light Mode');
        btn.setAttribute('aria-label', 'Switch to Light Mode');
      }
    });

    // 2. Update segmented choice buttons [data-theme-choice]
    const choiceBtns = document.querySelectorAll('[data-theme-choice]');
    choiceBtns.forEach((btn) => {
      const choice = btn.getAttribute('data-theme-choice');
      if (choice === theme) {
        btn.classList.add('active');
        btn.style.background = 'var(--btn-primary-bg)';
        btn.style.color = 'var(--btn-primary-color)';
        btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = 'var(--text-secondary)';
        btn.style.boxShadow = 'none';
      }
    });
  }

  // Apply immediately to avoid flash
  const initialTheme = getStoredTheme();
  document.documentElement.setAttribute('data-theme', initialTheme);

  // Global functions
  window.setSmartProctorTheme = function (theme) {
    applyTheme(theme === 'light' ? 'light' : 'dark');
  };

  window.toggleSmartProctorTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  };

  function initUI() {
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    syncThemeUI(activeTheme);

    // Bind toggle buttons
    document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
      btn.onclick = window.toggleSmartProctorTheme;
    });

    // Bind segmented choice buttons
    document.querySelectorAll('[data-theme-choice]').forEach((btn) => {
      btn.onclick = function () {
        const target = this.getAttribute('data-theme-choice');
        applyTheme(target);
      };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
