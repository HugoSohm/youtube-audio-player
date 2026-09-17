// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// keyboard.ts — Raccourcis clavier globaux
// ============================================================
// Raccourcis actifs uniquement si le focus n'est PAS sur un
// champ de texte, pour ne pas interférer avec la recherche YT.
// ============================================================

import {
  togglePlayPause,
  nextTrack,
  prevTrack,
  toggleMute,
  getState,
  setVolume,
  seekBy,
  toggleRepeat,
} from './player';

// Vérifie si le focus est sur un élément de saisie
function isFocusOnInput(): boolean {
  const active = document.activeElement;
  if (!active) return false;
  const tag = active.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    (active as HTMLElement).isContentEditable
  );
}

function handleKeyDown(e: KeyboardEvent): void {
  // Ignorer si l'utilisateur tape dans un champ
  if (isFocusOnInput()) return;
  // Laisser passer les raccourcis du navigateur (Ctrl+R, Ctrl+M…)
  if (e.ctrlKey || e.metaKey) return;

  switch (e.code) {
    case 'Space':
      e.preventDefault(); // Empêche le scroll natif de YouTube
      togglePlayPause();
      break;

    case 'ArrowRight':
      // Shift+→ : piste suivante, → seul : avance de 10s
      e.preventDefault();
      if (e.shiftKey) nextTrack();
      else seekBy(10);
      break;

    case 'ArrowLeft':
      // Shift+← : piste précédente, ← seul : recule de 10s
      e.preventDefault();
      if (e.shiftKey) prevTrack();
      else seekBy(-10);
      break;

    case 'KeyR':
      e.preventDefault();
      toggleRepeat();
      break;

    case 'KeyM':
      e.preventDefault();
      toggleMute();
      break;

    case 'ArrowUp':
      // Volume +5
      if (e.altKey) {
        e.preventDefault();
        const { volume } = getState();
        setVolume(volume + 5);
      }
      break;

    case 'ArrowDown':
      // Volume -5
      if (e.altKey) {
        e.preventDefault();
        const { volume } = getState();
        setVolume(volume - 5);
      }
      break;
  }
}

// ── API publique ──────────────────────────────────────────────

let registered = false;

/**
 * Active les raccourcis clavier. Idempotent.
 */
export function registerKeyboardShortcuts(): void {
  if (registered) return;
  document.addEventListener('keydown', handleKeyDown);
  registered = true;
}

/**
 * Désactive les raccourcis clavier.
 */
export function unregisterKeyboardShortcuts(): void {
  document.removeEventListener('keydown', handleKeyDown);
  registered = false;
}
