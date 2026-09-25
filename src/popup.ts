// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// popup.ts — Popup ouverte par un clic sur l'icône de l'extension
// ============================================================
// - Interrupteur "Mode liste" (même clé que toggle.ts)
// - Choix du thème du lecteur (appliqué en direct via
//   chrome.storage.onChanged, voir player.ts)
// ============================================================

import './styles/popup.scss';
import { t } from './i18n';
import { THEMES, THEME_STORAGE_KEY, loadTheme, type PlayerTheme } from './themes';

const ENABLED_STORAGE_KEY = 'enabled';

const THEME_LABELS: Record<PlayerTheme, string> = {
  dark: 'themeDark',
  light: 'themeLight',
  itunes: 'themeItunes',
};

document.documentElement.lang = chrome.i18n.getUILanguage();
document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
  el.textContent = t(el.dataset.i18n!);
});

// ── Mode liste ────────────────────────────────────────────────

const enabledBtn = document.getElementById('pp-enabled')!;

function renderEnabled(enabled: boolean): void {
  enabledBtn.setAttribute('aria-checked', String(enabled));
}

enabledBtn.addEventListener('click', () => {
  const next = enabledBtn.getAttribute('aria-checked') !== 'true';
  renderEnabled(next);
  chrome.storage.local.set({ [ENABLED_STORAGE_KEY]: next });
});

// ── Thèmes ────────────────────────────────────────────────────

const themesEl = document.getElementById('pp-themes')!;

function buildThemeOption(theme: PlayerTheme): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pp-theme';
  btn.dataset.theme = theme;
  btn.setAttribute('role', 'radio');
  btn.innerHTML = `
    <span class="pp-preview pp-preview--${theme}" aria-hidden="true">
      <span class="pp-preview__video"></span>
      <span class="pp-preview__lcd"><span></span><span></span></span>
      <span class="pp-preview__buttons"><i></i><i class="pp-preview__play"></i><i></i></span>
      <span class="pp-preview__bar"><span></span></span>
    </span>
    <span class="pp-theme__name">${t(THEME_LABELS[theme])}</span>
  `;
  btn.addEventListener('click', () => selectTheme(theme, true));
  return btn;
}

function selectTheme(theme: PlayerTheme, save: boolean): void {
  themesEl.querySelectorAll<HTMLElement>('.pp-theme').forEach((el) => {
    const checked = el.dataset.theme === theme;
    el.setAttribute('aria-checked', String(checked));
    el.tabIndex = checked ? 0 : -1;
  });
  if (save) chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
}

// Radiogroup : les flèches déplacent la sélection
themesEl.addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const current = THEMES.indexOf(
    (themesEl.querySelector<HTMLElement>('[aria-checked="true"]')?.dataset.theme ?? THEMES[0]) as PlayerTheme,
  );
  const next = THEMES[(current + step + THEMES.length) % THEMES.length]!;
  selectTheme(next, true);
  themesEl.querySelector<HTMLElement>(`[data-theme="${next}"]`)?.focus();
});

THEMES.forEach((theme) => themesEl.appendChild(buildThemeOption(theme)));

// ── État initial ──────────────────────────────────────────────

(async () => {
  const stored = await chrome.storage.local.get(ENABLED_STORAGE_KEY);
  renderEnabled(stored[ENABLED_STORAGE_KEY] !== false);
  selectTheme(await loadTheme(), false);
})();
