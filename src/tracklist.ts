// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// tracklist.ts — Rendu du tableau Tracklist style Spotify
// ============================================================

import type { Track } from './types';
import { activePageRoot } from './extractor';
import { t } from './i18n';
import './styles/tracklist.scss';

// ── Constantes ────────────────────────────────────────────────

const CONTAINER_ID = 'ytp-tracklist-root';
const ROW_ATTR = 'data-track-id';
const NATIVE_HIDDEN_CLASS = 'ytp-native-hidden';

// ── Callbacks vers le player ─────────────────────────────────

type PlayCallback = (track: Track) => void;

let onPlayCallback: PlayCallback | null = null;
let currentTrackId: string | null = null;

export function setPlayCallback(cb: PlayCallback): void {
  onPlayCallback = cb;
}

// ── Construction du DOM ───────────────────────────────────────

/**
 * Crée et insère le conteneur de la tracklist dans la page.
 * Remplace le rendu natif YouTube en le masquant (pas en le supprimant,
 * pour préserver les listeners YouTube et éviter les erreurs SPA).
 */
export function mountTracklist(): HTMLElement {
  // Évite les montages multiples
  let root = document.getElementById(CONTAINER_ID);
  if (root) return root;

  root = document.createElement('div');
  root.id = CONTAINER_ID;
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', t('tracklistRegion'));

  // Injection juste avant le conteneur de résultats de la page active
  // (recherche / playlist classique : ytd-section-list-renderer, chaîne : ytd-rich-grid-renderer,
  //  playlist nouvelle interface : yt-section-list-renderer)
  const page = activePageRoot();
  const anchor =
    page.querySelector('ytd-section-list-renderer') ??
    page.querySelector('ytd-rich-grid-renderer') ??
    page.querySelector('yt-section-list-renderer') ??
    page.querySelector('#contents') ??
    document.body;

  anchor.insertAdjacentElement('beforebegin', root);

  // Masque le rendu natif (sans le supprimer pour éviter les erreurs SPA)
  hideNativeRenderer();

  return root;
}

/**
 * Masque le rendu vidéo natif de YouTube, via une classe sur <html>
 * (voir tracklist.scss). Le bloc de chargement "continuation" reste
 * affiché juste sous la tracklist : quand il devient visible au scroll,
 * YouTube charge la page de résultats suivante (infinite scroll natif).
 */
function hideNativeRenderer(): void {
  document.documentElement.classList.add(NATIVE_HIDDEN_CLASS);
}

/**
 * Restaure le rendu natif (utilisé lors du démontage de l'extension).
 */
export function showNativeRenderer(): void {
  document.documentElement.classList.remove(NATIVE_HIDDEN_CLASS);
}

// ── Rendu du header ───────────────────────────────────────────

function buildHeader(): HTMLElement {
  const header = document.createElement('div');
  header.className = 'ytp-tl-header';
  header.innerHTML = `
    <div class="ytp-tl-header__icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
    </div>
    <div class="ytp-tl-header__title">
      <h1>Type Beats</h1>
      <span class="ytp-tl-header__subtitle">YouTube Audio Player</span>
    </div>
    <div class="ytp-tl-header__count" id="ytp-track-count">0 tracks</div>
  `;
  return header;
}

// ── Rendu d'une ligne ─────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildRow(track: Track): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ytp-tl-row';
  row.setAttribute(ROW_ATTR, track.id);
  row.setAttribute('role', 'row');
  row.setAttribute('tabindex', '0');
  row.setAttribute('aria-label', t('trackByArtist', track.title, track.artist));

  // L'index affiché est 1-basé
  const displayIndex = track.index + 1;

  // Les titres viennent de YouTube : échappés avant injection HTML
  const safe = {
    id: escapeHtml(track.id),
    title: escapeHtml(track.title),
    artist: escapeHtml(track.artist),
    duration: escapeHtml(track.duration),
    thumbnail: escapeHtml(track.thumbnail),
  };

  row.innerHTML = `
    <!-- # -->
    <div class="ytp-tl-cell ytp-tl-cell--index" role="cell">
      <span class="ytp-tl-index-num">${displayIndex}</span>
      <!-- Waveform animée affichée pendant la lecture -->
      <span class="ytp-tl-eq" aria-hidden="true"><i></i><i></i><i></i></span>
      <button
        class="ytp-tl-play-btn"
        aria-label="${t('playTrack', safe.title)}"
        data-video-id="${safe.id}"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </button>
    </div>

    <!-- Thumbnail + Titre + Artiste (sous le titre) -->
    <div class="ytp-tl-cell ytp-tl-cell--thumb" role="cell">
      <img
        class="ytp-tl-thumb"
        src="${safe.thumbnail}"
        alt=""
        loading="lazy"
        width="40"
        height="40"
      />
      <div class="ytp-tl-text-block">
        <span class="ytp-tl-title" title="${safe.title}">${safe.title}</span>
        <span class="ytp-tl-artist">${safe.artist}</span>
      </div>
    </div>

    <!-- Artiste (colonne centrale, comme Spotify) -->
    <div class="ytp-tl-cell ytp-tl-cell--info" role="cell">
      <span class="ytp-tl-artist-mid">${safe.artist}</span>
    </div>

    <!-- Durée -->
    <div class="ytp-tl-cell ytp-tl-cell--duration" role="cell">
      <span class="ytp-tl-duration">${safe.duration}</span>
    </div>

    <!-- Lien YT -->
    <div class="ytp-tl-cell ytp-tl-cell--link" role="cell">
      <a
        class="ytp-tl-yt-link"
        href="https://www.youtube.com/watch?v=${safe.id}"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="${t('openOnYouTube')}"
        title="${t('openOnYouTube')}"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
        </svg>
      </a>
    </div>
  `;

  // Événements
  const playBtn = row.querySelector<HTMLButtonElement>('.ytp-tl-play-btn');
  playBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    onPlayCallback?.(track);
  });

  // Clic sur la ligne entière (sauf liens)
  row.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('a') || target.closest('button')) return;
    onPlayCallback?.(track);
  });

  // Accessibilité clavier
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlayCallback?.(track);
    }
  });

  return row;
}

// ── Rendu du tableau ──────────────────────────────────────────

function buildTableHeader(): HTMLElement {
  const thead = document.createElement('div');
  thead.className = 'ytp-tl-thead';
  thead.setAttribute('role', 'row');
  thead.innerHTML = `
    <div class="ytp-tl-th ytp-tl-th--index" role="columnheader">#</div>
    <div class="ytp-tl-th" role="columnheader">${t('columnTitle')}</div>
    <div class="ytp-tl-th ytp-tl-th--info" role="columnheader">${t('columnArtist')}</div>
    <div class="ytp-tl-th ytp-tl-th--duration" role="columnheader">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-label="${t('columnDuration')}">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
    <div class="ytp-tl-th ytp-tl-th--link" role="columnheader"></div>
  `;
  return thead;
}


// ── API publique ──────────────────────────────────────────────

/**
 * Rend la tracklist initiale dans le conteneur donné.
 */
export function renderTracklist(root: HTMLElement, tracks: Track[]): void {
  root.innerHTML = '';

  // Header décoratif
  root.appendChild(buildHeader());

  // Corps du tableau
  const table = document.createElement('div');
  table.className = 'ytp-tl-table';
  table.setAttribute('role', 'table');
  table.setAttribute('aria-label', 'Tracklist');

  table.appendChild(buildTableHeader());

  const body = document.createElement('div');
  body.className = 'ytp-tl-tbody';
  body.id = 'ytp-tl-tbody';
  body.setAttribute('role', 'rowgroup');

  tracks.forEach((track) => body.appendChild(buildRow(track)));

  table.appendChild(body);
  root.appendChild(table);

  updateTrackCount(tracks.length);
}

/**
 * Ajoute de nouvelles pistes à la fin de la tracklist (infinite scroll).
 */
export function appendTracks(tracks: Track[]): void {
  const body = document.getElementById('ytp-tl-tbody');
  if (!body) return;

  tracks.forEach((track) => body.appendChild(buildRow(track)));

  // Met à jour le compteur
  const currentCount = body.querySelectorAll('.ytp-tl-row').length;
  updateTrackCount(currentCount);
}

/**
 * Met en surbrillance la ligne de la piste en cours de lecture.
 */
export function setActiveTrack(trackId: string | null): void {
  // Désactive l'ancienne
  if (currentTrackId) {
    const oldRow = document.querySelector<HTMLElement>(
      `[${ROW_ATTR}="${currentTrackId}"]`
    );
    oldRow?.classList.remove('ytp-tl-row--active');
    oldRow?.classList.remove('ytp-tl-row--playing');
  }

  currentTrackId = trackId;

  if (trackId) {
    const newRow = document.querySelector<HTMLElement>(
      `[${ROW_ATTR}="${trackId}"]`
    );
    newRow?.classList.add('ytp-tl-row--active', 'ytp-tl-row--playing');
    // Scroll vers la ligne active si hors vue
    newRow?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * Bascule l'icône play/pause sur la ligne active.
 */
export function setRowPlayingState(trackId: string, isPlaying: boolean): void {
  const row = document.querySelector<HTMLElement>(
    `[${ROW_ATTR}="${trackId}"]`
  );
  if (!row) return;

  row.classList.toggle('ytp-tl-row--playing', isPlaying);
  row.classList.toggle('ytp-tl-row--paused', !isPlaying);
}

function updateTrackCount(count: number): void {
  const el = document.getElementById('ytp-track-count');
  if (el) el.textContent = t(count > 1 ? 'trackCountMany' : 'trackCountOne', count);
}

/**
 * Démonte complètement la tracklist et restaure le rendu natif.
 */
export function unmountTracklist(): void {
  document.getElementById(CONTAINER_ID)?.remove();
  showNativeRenderer();
}
