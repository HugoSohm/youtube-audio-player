// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// tracklist.ts — Rendu du tableau Tracklist style Spotify
// ============================================================

import type { Track } from './types';
import { activePageRoot } from './extractor';
import { isLiked, isSignedIn, onLikeChange, toggleLike } from './library';
import { closePlaylistMenu, openPlaylistMenu, removeToast, showToast } from './playlist-menu';
import { t } from './i18n';
import './styles/tracklist.scss';

// ── Constantes ────────────────────────────────────────────────

const CONTAINER_ID = 'ytp-tracklist-root';
const ROW_ATTR = 'data-track-id';
const NATIVE_HIDDEN_CLASS = 'ytp-native-hidden';
/** Posée sur la racine quand l'utilisateur n'est pas connecté : masque « j'aime » et playlists */
const ANON_CLASS = 'ytp-tl-root--anonymous';
/** Repère de fin de liste, observé par pagination.ts */
const SENTINEL_ID = 'ytp-tl-sentinel';
/** Au-delà, YouTube considère la vidéo comme vue et non comme « à reprendre » */
const WATCHED_THRESHOLD = 90;

// ── Callbacks vers le player ─────────────────────────────────

type PlayCallback = (track: Track) => void;

let onPlayCallback: PlayCallback | null = null;
let currentTrackId: string | null = null;
/** Désabonnement du cache des « j'aime » (posé au premier rendu) */
let unsubscribeLikes: (() => void) | null = null;
/** Listener de redimensionnement de fenêtre, posé au montage */
let resizeListener: AbortController | null = null;

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

  fitToViewport(root);
  resizeListener = new AbortController();
  window.addEventListener('resize', () => fitToViewport(root), {
    signal: resizeListener.signal,
    passive: true,
  });

  return root;
}

/**
 * Empêche la tracklist de déborder à droite de la fenêtre.
 *
 * Certains conteneurs de YouTube sont dimensionnés en `100vw`, qui inclut la
 * barre de défilement : la liste hérite alors d'une largeur supérieure à la
 * zone visible et son en-tête de colonnes part hors écran. On mesure l'écart
 * réel et on le reprend par une marge droite (largeur auto, cf. tracklist.scss).
 */
function fitToViewport(root: HTMLElement): void {
  root.style.marginRight = '';

  const overflow = root.getBoundingClientRect().right - document.documentElement.clientWidth;
  if (overflow > 0) root.style.marginRight = `${Math.ceil(overflow)}px`;
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
  const liked = isLiked(track.id);
  const watched = track.watchedPercent !== null;
  const fullyWatched = (track.watchedPercent ?? 0) >= WATCHED_THRESHOLD;
  // Seule trace visible de l'historique : la barre rouge sous la miniature.
  // Le détail ("Vue à 42 %") reste accessible en infobulle et aux lecteurs d'écran.
  const watchedLabel = t(
    fullyWatched ? 'alreadyWatched' : 'partlyWatched',
    String(Math.round(track.watchedPercent ?? 0))
  );

  if (watched) row.classList.add('ytp-tl-row--watched');

  // Les titres viennent de YouTube : échappés avant injection HTML
  const safe = {
    id: escapeHtml(track.id),
    title: escapeHtml(track.title),
    artist: escapeHtml(track.artist),
    duration: escapeHtml(track.duration),
    published: escapeHtml(track.publishedAt ?? '—'),
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
      <div class="ytp-tl-thumb-wrap">
        <img
          class="ytp-tl-thumb"
          src="${safe.thumbnail}"
          alt=""
          loading="lazy"
          width="40"
          height="40"
        />
        ${watched
          ? `<span class="ytp-tl-progress" role="img" title="${watchedLabel}" aria-label="${watchedLabel}"><i style="width:${track.watchedPercent}%"></i></span>`
          : ''}
      </div>
      <div class="ytp-tl-text-block">
        <span class="ytp-tl-title" title="${safe.title}">${safe.title}</span>
        <span class="ytp-tl-artist">${safe.artist}</span>
      </div>
    </div>

    <!-- Artiste (colonne centrale, comme Spotify) -->
    <div class="ytp-tl-cell ytp-tl-cell--info" role="cell">
      <span class="ytp-tl-artist-mid">${safe.artist}</span>
    </div>

    <!-- Date de publication -->
    <div class="ytp-tl-cell ytp-tl-cell--published" role="cell">
      <span class="ytp-tl-published">${safe.published}</span>
    </div>

    <!-- Durée -->
    <div class="ytp-tl-cell ytp-tl-cell--duration" role="cell">
      <span class="ytp-tl-duration">${safe.duration}</span>
    </div>

    <!-- J'aime / playlist / lien YT -->
    <div class="ytp-tl-cell ytp-tl-cell--actions" role="cell">
      <button
        class="ytp-tl-action ytp-tl-like${liked ? ' ytp-tl-like--on' : ''}"
        aria-pressed="${liked}"
        aria-label="${t(liked ? 'unlike' : 'like')}"
        title="${t(liked ? 'unlike' : 'like')}"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 000-7.8z"/>
        </svg>
      </button>

      <button
        class="ytp-tl-action ytp-tl-save"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-label="${t('addToPlaylist')}"
        title="${t('addToPlaylist')}"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <line x1="3" y1="6" x2="15" y2="6"/>
          <line x1="3" y1="12" x2="15" y2="12"/>
          <line x1="3" y1="18" x2="11" y2="18"/>
          <line x1="18" y1="10" x2="18" y2="20"/>
          <line x1="13" y1="15" x2="23" y2="15"/>
        </svg>
      </button>

      <a
        class="ytp-tl-action ytp-tl-yt-link"
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

  const likeBtn = row.querySelector<HTMLButtonElement>('.ytp-tl-like');
  likeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    void onLikeClick(likeBtn, track);
  });

  const saveBtn = row.querySelector<HTMLButtonElement>('.ytp-tl-save');
  saveBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openPlaylistMenu(saveBtn, track);
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

// ── « J'aime » ────────────────────────────────────────────────

/**
 * Bascule le « j'aime » ; l'affichage suit le cache partagé
 * (voir syncLikeButtons), y compris en cas d'échec.
 */
async function onLikeClick(button: HTMLButtonElement, track: Track): Promise<void> {
  if (button.classList.contains('ytp-tl-action--busy')) return;
  button.classList.add('ytp-tl-action--busy');

  try {
    await toggleLike(track.id);
  } catch {
    showToast(t('actionFailed'));
  } finally {
    button.classList.remove('ytp-tl-action--busy');
  }
}

/** Reflète l'état d'une vidéo sur toutes ses lignes visibles. */
function syncLikeButtons(videoId: string, liked: boolean): void {
  const row = document.querySelector<HTMLElement>(`[${ROW_ATTR}="${CSS.escape(videoId)}"]`);
  const button = row?.querySelector<HTMLButtonElement>('.ytp-tl-like');
  if (!button) return;

  button.classList.toggle('ytp-tl-like--on', liked);
  button.setAttribute('aria-pressed', String(liked));
  button.setAttribute('aria-label', t(liked ? 'unlike' : 'like'));
  button.title = t(liked ? 'unlike' : 'like');
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
    <div class="ytp-tl-th ytp-tl-th--published" role="columnheader">${t('columnPublished')}</div>
    <div class="ytp-tl-th ytp-tl-th--duration" role="columnheader">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-label="${t('columnDuration')}">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>
    </div>
    <div class="ytp-tl-th ytp-tl-th--actions" role="columnheader"></div>
  `;
  return thead;
}


// ── API publique ──────────────────────────────────────────────

/**
 * Rend la tracklist initiale dans le conteneur donné.
 */
export function renderTracklist(root: HTMLElement, tracks: Track[]): void {
  root.innerHTML = '';

  // Hors session YouTube, « j'aime » et playlists n'ont pas de sens
  root.classList.toggle(ANON_CLASS, !isSignedIn());

  // Un seul abonnement, quel que soit le nombre de rendus
  unsubscribeLikes?.();
  unsubscribeLikes = onLikeChange(syncLikeButtons);

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

  // Après le tableau : les lignes s'ajoutent dans le tbody, jamais après lui
  const sentinel = document.createElement('div');
  sentinel.id = SENTINEL_ID;
  sentinel.className = 'ytp-tl-sentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  root.appendChild(sentinel);

  updateTrackCount(tracks.length);
}

/** Repère de fin de liste, à confier à pagination.ts. */
export function getSentinel(): HTMLElement | null {
  return document.getElementById(SENTINEL_ID);
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
  closePlaylistMenu();
  removeToast();
  unsubscribeLikes?.();
  unsubscribeLikes = null;
  resizeListener?.abort();
  resizeListener = null;
  document.getElementById(CONTAINER_ID)?.remove();
  showNativeRenderer();
}
