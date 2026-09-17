// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// toggle.ts — Interrupteur "Mode liste" dans la barre YouTube
// ============================================================
// L'état est stocké dans chrome.storage.local : il est partagé
// entre tous les onglets et modifiable aussi depuis l'icône
// de l'extension (voir background.ts).
// ============================================================

import './styles/toggle.scss';
import { t } from './i18n';

const TOGGLE_ID = 'ytp-mode-toggle';
const STORAGE_KEY = 'enabled';

type ToggleCallback = (enabled: boolean) => void;

let enabled = true;
let onChangeCallback: ToggleCallback | null = null;

// ── Stockage ──────────────────────────────────────────────────

/**
 * Charge l'état persistant et écoute ses changements (autres onglets,
 * clic sur l'icône de l'extension).
 */
export async function initToggleState(onChange: ToggleCallback): Promise<boolean> {
  onChangeCallback = onChange;

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  enabled = stored[STORAGE_KEY] !== false; // activé par défaut

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(STORAGE_KEY in changes)) return;
    const next = changes[STORAGE_KEY]?.newValue !== false;
    if (next === enabled) return;
    enabled = next;
    syncButton();
    onChangeCallback?.(enabled);
  });

  return enabled;
}

export function isEnabled(): boolean {
  return enabled;
}

function setEnabled(next: boolean): void {
  // onChanged se charge de notifier le content script
  chrome.storage.local.set({ [STORAGE_KEY]: next });
}

// ── Bouton ────────────────────────────────────────────────────

function buildButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.id = TOGGLE_ID;
  btn.type = 'button';
  btn.title = t('toggleTitle');
  btn.innerHTML = `
    <svg class="ytp-toggle__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
    </svg>
    <span class="ytp-toggle__label">${t('toggleLabel')}</span>
    <span class="ytp-toggle__switch" aria-hidden="true"><span class="ytp-toggle__knob"></span></span>
  `;
  btn.addEventListener('click', () => setEnabled(!enabled));
  return btn;
}

function syncButton(): void {
  const btn = document.getElementById(TOGGLE_ID);
  if (!btn) return;
  btn.classList.toggle('ytp-toggle--on', enabled);
  btn.setAttribute('aria-pressed', String(enabled));
}

/**
 * Affiche l'interrupteur dans la barre du haut de YouTube.
 * Idempotent — réinsère le bouton si YouTube a re-rendu la barre.
 */
export function showToggle(): void {
  let btn = document.getElementById(TOGGLE_ID);
  if (!btn) {
    btn = buildButton();
    const buttons = document.querySelector('ytd-masthead #end #buttons');
    if (buttons) {
      buttons.insertAdjacentElement('beforebegin', btn);
    } else {
      // Barre introuvable : bouton flottant
      btn.classList.add('ytp-toggle--floating');
      document.body.appendChild(btn);
    }
  }
  syncButton();
}

export function hideToggle(): void {
  document.getElementById(TOGGLE_ID)?.remove();
}
