// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// themes.ts — Thèmes du lecteur flottant
// ============================================================
// Le thème est choisi dans la popup de l'extension (popup.ts) et
// stocké dans chrome.storage.local. Il ne s'applique qu'au lecteur :
// l'interface de YouTube change trop souvent pour être thémée.
// Styles : styles/themes.scss.
// ============================================================

export const THEMES = ['dark', 'light', 'itunes'] as const;
export type PlayerTheme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = 'playerTheme';
export const DEFAULT_THEME: PlayerTheme = 'dark';

/** Valeur stockée → thème connu (sinon le thème par défaut) */
export function parseTheme(value: unknown): PlayerTheme {
  return THEMES.includes(value as PlayerTheme) ? (value as PlayerTheme) : DEFAULT_THEME;
}

export async function loadTheme(): Promise<PlayerTheme> {
  const stored = await chrome.storage.local.get(THEME_STORAGE_KEY);
  return parseTheme(stored[THEME_STORAGE_KEY]);
}
