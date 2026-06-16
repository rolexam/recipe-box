/**
 * theme.js — light/dark theme controller.
 *
 * Persists the user's choice in localStorage and applies it via the
 * `data-theme` attribute on <html>. Falls back to the OS preference
 * when no choice has been saved.
 */

const STORAGE_KEY = 'theme';
const THEMES = Object.freeze({ light: 'light', dark: 'dark' });

/**
 * @typedef {'light' | 'dark'} Theme
 */

/**
 * Read the saved theme, or fall back to the OS preference.
 *
 * localStorage access can throw in privacy modes; treat any failure as
 * "no preference saved" rather than letting the UI break.
 *
 * @returns {Theme}
 */
function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === THEMES.light || saved === THEMES.dark) {
      return saved;
    }
  } catch {
    // Storage unavailable — fall through to OS preference.
  }

  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;

  return prefersDark ? THEMES.dark : THEMES.light;
}

/**
 * @param {Theme} theme
 */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * @param {Theme} theme
 */
function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Persistence is best-effort; ignore quota/privacy failures.
  }
}

/**
 * @param {HTMLButtonElement} button
 * @param {Theme} theme
 */
function syncButton(button, theme) {
  const isDark = theme === THEMES.dark;
  button.setAttribute('aria-pressed', String(isDark));
  button.textContent = isDark ? 'Light mode' : 'Dark mode';
}

/**
 * Wire the toggle button to the current theme state. Safe to call once
 * on DOM ready; the initial theme attribute is set ahead of paint by
 * the inline bootstrap script in index.html to avoid a flash.
 *
 * @param {HTMLButtonElement} button
 */
export function initThemeToggle(button) {
  const current = /** @type {Theme} */ (
    document.documentElement.getAttribute('data-theme') || getInitialTheme()
  );
  applyTheme(current);
  syncButton(button, current);

  button.addEventListener('click', () => {
    const active = document.documentElement.getAttribute('data-theme');
    const next = active === THEMES.dark ? THEMES.light : THEMES.dark;
    applyTheme(next);
    saveTheme(next);
    syncButton(button, next);
  });
}

export { getInitialTheme, THEMES };
