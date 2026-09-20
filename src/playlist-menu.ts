// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// playlist-menu.ts — Popover « Ajouter à une playlist »
// ============================================================
// Un seul popover pour toute la page, ancré au bouton cliqué et posé
// sur <body> (position: fixed) : les lignes de la tracklist peuvent
// être recyclées ou défiler sans emporter le menu avec elles.
// ============================================================

import type { Track } from './types';
import { createPlaylist, editPlaylist, fetchPlaylists, type PlaylistOption } from './library';
import { t } from './i18n';

const MENU_ID = 'ytp-playlist-menu';
const TOAST_ID = 'ytp-toast';
/** Marge entre le bouton et le popover */
const GAP = 6;

let menu: HTMLElement | null = null;
let openForButton: HTMLElement | null = null;
/** Listeners « fermer au clic extérieur » posés le temps de l'ouverture */
let dismissListeners: AbortController | null = null;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Toast ────────────────────────────────────────────────────

let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Message éphémère en bas de l'écran (erreurs d'API surtout). */
export function showToast(message: string): void {
  let toast = document.getElementById(TOAST_ID);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.classList.add('ytp-toast--visible');

  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast?.classList.remove('ytp-toast--visible'), 3200);
}

/** Retire le toast de la page (démontage de l'extension). */
export function removeToast(): void {
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = null;
  document.getElementById(TOAST_ID)?.remove();
}

// ── Ouverture / fermeture ────────────────────────────────────

export function closePlaylistMenu(): void {
  menu?.remove();
  menu = null;
  openForButton?.setAttribute('aria-expanded', 'false');
  openForButton = null;
  dismissListeners?.abort();
  dismissListeners = null;
}

/** Le popover est-il ouvert pour ce bouton ? (clic = bascule) */
function isOpenFor(button: HTMLElement): boolean {
  return openForButton === button;
}

/**
 * Ouvre le popover des playlists pour une piste.
 * Un second clic sur le même bouton le referme.
 */
export function openPlaylistMenu(button: HTMLElement, track: Track): void {
  if (isOpenFor(button)) {
    closePlaylistMenu();
    return;
  }
  closePlaylistMenu();

  menu = document.createElement('div');
  menu.id = MENU_ID;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', t('addToPlaylist'));
  menu.innerHTML = `
    <div class="ytp-pm__head">
      <span class="ytp-pm__title">${escapeHtml(t('addToPlaylist'))}</span>
      <span class="ytp-pm__track">${escapeHtml(track.title)}</span>
    </div>
    <div class="ytp-pm__body"><div class="ytp-pm__status">${escapeHtml(t('loading'))}</div></div>
  `;

  document.body.appendChild(menu);
  openForButton = button;
  button.setAttribute('aria-expanded', 'true');
  position(menu, button);

  // Fermeture : clic extérieur, Échap, défilement de la page
  dismissListeners = new AbortController();
  const { signal } = dismissListeners;
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as Node;
      if (menu?.contains(target) || button.contains(target)) return;
      closePlaylistMenu();
    },
    { signal, capture: true }
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') {
        closePlaylistMenu();
        button.focus();
      }
    },
    { signal }
  );
  // capture: le défilement ne remonte pas. On ignore celui de la liste
  // de playlists elle-même, sinon le menu se fermerait en le parcourant.
  window.addEventListener(
    'scroll',
    (event) => {
      if (menu?.contains(event.target as Node)) return;
      closePlaylistMenu();
    },
    { signal, passive: true, capture: true }
  );
  window.addEventListener('resize', () => closePlaylistMenu(), { signal });

  loadPlaylists(track).catch(() => {
    /* déjà rapporté dans loadPlaylists */
  });
}

/** Cale le popover sous le bouton, en le gardant dans la fenêtre. */
function position(element: HTMLElement, button: HTMLElement): void {
  const anchor = button.getBoundingClientRect();
  const box = element.getBoundingClientRect();

  // Aligné à droite du bouton, replié vers le haut s'il déborde en bas
  const left = Math.max(8, Math.min(
    anchor.right - box.width,
    window.innerWidth - box.width - 8
  ));
  const below = anchor.bottom + GAP;
  const top = below + box.height > window.innerHeight - 8
    ? Math.max(8, anchor.top - box.height - GAP)
    : below;

  element.style.left = `${Math.round(left)}px`;
  element.style.top = `${Math.round(top)}px`;
}

// ── Contenu ──────────────────────────────────────────────────

async function loadPlaylists(track: Track): Promise<void> {
  const body = menu?.querySelector<HTMLElement>('.ytp-pm__body');
  if (!body) return;

  let playlists: PlaylistOption[];
  try {
    playlists = await fetchPlaylists(track.id);
  } catch {
    if (menu) body.innerHTML = `<div class="ytp-pm__status">${escapeHtml(t('playlistsError'))}</div>`;
    return;
  }

  // Le menu a pu être refermé pendant la requête
  if (!menu?.contains(body)) return;

  body.innerHTML = '';
  playlists.forEach((playlist) => body.appendChild(buildOptionRow(playlist, track)));
  body.appendChild(buildCreateRow(track));

  if (menu && openForButton) position(menu, openForButton);
}

function buildOptionRow(playlist: PlaylistOption, track: Track): HTMLElement {
  const row = document.createElement('button');
  row.className = 'ytp-pm__item';
  row.type = 'button';
  row.setAttribute('role', 'menuitemcheckbox');
  row.setAttribute('aria-checked', String(playlist.contains));
  row.innerHTML = `
    <span class="ytp-pm__check" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </span>
    <span class="ytp-pm__name">${escapeHtml(playlist.title)}</span>
  `;

  row.addEventListener('click', async () => {
    if (row.classList.contains('ytp-pm__item--busy')) return;

    const add = row.getAttribute('aria-checked') !== 'true';
    // Optimiste : on bascule tout de suite, on revient en arrière si ça échoue
    row.setAttribute('aria-checked', String(add));
    row.classList.add('ytp-pm__item--busy');

    try {
      await editPlaylist(playlist.playlistId, track.id, add);
    } catch {
      row.setAttribute('aria-checked', String(!add));
      showToast(t('actionFailed'));
    } finally {
      row.classList.remove('ytp-pm__item--busy');
    }
  });

  return row;
}

/** Dernière ligne : « Nouvelle playlist », qui déplie un champ de saisie. */
function buildCreateRow(track: Track): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'ytp-pm__create';
  wrapper.innerHTML = `
    <button class="ytp-pm__item ytp-pm__item--new" type="button">
      <span class="ytp-pm__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </span>
      <span class="ytp-pm__name">${escapeHtml(t('newPlaylist'))}</span>
    </button>
    <form class="ytp-pm__form" hidden>
      <input class="ytp-pm__input" type="text" maxlength="150" placeholder="${escapeHtml(t('newPlaylistName'))}" aria-label="${escapeHtml(t('newPlaylistName'))}" />
      <button class="ytp-pm__submit" type="submit">${escapeHtml(t('create'))}</button>
    </form>
  `;

  const trigger = wrapper.querySelector<HTMLButtonElement>('.ytp-pm__item--new')!;
  const form = wrapper.querySelector<HTMLFormElement>('.ytp-pm__form')!;
  const input = wrapper.querySelector<HTMLInputElement>('.ytp-pm__input')!;

  trigger.addEventListener('click', () => {
    trigger.hidden = true;
    form.hidden = false;
    input.value = track.title;
    input.focus();
    input.select();
    if (menu && openForButton) position(menu, openForButton);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = input.value.trim();
    if (!title) return;

    form.classList.add('ytp-pm__form--busy');
    try {
      await createPlaylist(title, track.id);
      closePlaylistMenu();
      showToast(t('playlistCreated', title));
    } catch {
      showToast(t('actionFailed'));
    } finally {
      form.classList.remove('ytp-pm__form--busy');
    }
  });

  return wrapper;
}
