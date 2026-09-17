// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// i18n.ts — Traductions (fr / en / es)
// ============================================================
// Les textes sont dans public/_locales/<langue>/messages.json.
// Chrome choisit la langue du navigateur, l'anglais par défaut.
// ============================================================

/** Texte traduit ; `$1`, `$2`… sont remplacés par les substitutions */
export function t(key: string, ...substitutions: (string | number)[]): string {
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}
