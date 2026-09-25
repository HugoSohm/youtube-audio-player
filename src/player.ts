// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// player.ts — Widget flottant basé sur une iframe /watch
// ============================================================
// Pourquoi pas l'IFrame API / les embeds ?
//   - window.YT n'existe pas sur youtube.com (l'API n'y est pas chargée)
//   - YouTube refuse les embeds dont la page parente est youtube.com
//     (erreurs 152 / 153), quel que soit le referrer
//
// Architecture :
//   content script
//     → crée une iframe https://www.youtube.com/watch?v=ID
//       (même origine → accès direct à son DOM)
//     → injecte un CSS dans l'iframe pour n'afficher que #movie_player
//       (la vidéo et les pubs restent visibles)
//     → pilote le <video> natif (play / pause / seek / volume)
// ============================================================

import type { Track, PlayerState, VideoQuality, PlayerQualityInfo } from './types';
import './styles/player.scss';
import { cacheLikeState } from './library';
import { t } from './i18n';

// ── Constantes ────────────────────────────────────────────────
const PLAYER_ID = 'ytp-player-widget';
const FRAME_STYLE_ID = 'ytp-frame-style';
const POLL_MS = 250;
/** Pas des boutons avancer / reculer (et des flèches ← →) */
const SKIP_SECONDS = 10;

/** CSS injecté dans la page /watch : le lecteur occupe toute l'iframe */
const FRAME_CSS = `
  html, body, ytd-app { overflow: hidden !important; background: #000 !important; }
  #movie_player {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw !important;
    height: 100vh !important;
    z-index: 2147483647 !important;
    background: #000 !important;
  }
  #masthead-container, ytd-popup-container, tp-yt-iron-overlay-backdrop,
  ytd-consent-bump-v2-lightbox, ytd-miniplayer { display: none !important; }
  /* Pas d'overlay YouTube (titre, contrôles, cartes, écran de fin…) :
     seuls la vidéo, le spinner et le bloc pub (bouton "Passer") restent */
  #movie_player > :not(.html5-video-container, .video-ads, .ytp-spinner, .ytp-ad-persistent-progress-bar-container) {
    display: none !important;
  }
  /* Aucun clic sur la page /watch, sauf sur les pubs */
  html, body, ytd-app, #movie_player { pointer-events: none !important; }
  #movie_player .video-ads { pointer-events: auto !important; }
`;

/** Bouton « j'aime » de la page /watch chargée dans l'iframe (interfaces ancienne et nouvelle) */
const SEL_FRAME_LIKE = 'like-button-view-model button, #segmented-like-button button, ytd-toggle-button-renderer#like-button button';

const VOLUME_STORAGE_KEY = 'playerVolume';
const REPEAT_STORAGE_KEY = 'playerRepeat';
const QUALITY_STORAGE_KEY = 'playerQuality';

const QUALITY_LABELS: Record<VideoQuality, string> = {
  auto: t('qualityAuto'),
  hd2160: '2160p',
  hd1440: '1440p',
  hd1080: '1080p',
  hd720: '720p',
  large: '480p',
  medium: '360p',
  small: '240p',
  tiny: '144p',
};

// ── État ─────────────────────────────────────────────────────
let state: PlayerState = {
  currentTrack: null,
  playlist: [],
  isPlaying: false,
  isMuted: false,
  volume: 80,
  repeat: false,
  quality: 'auto',
};

let frame: HTMLIFrameElement | null = null;
/** Listeners posés sur document par le widget */
let documentListeners: AbortController | null = null;
/** Piste pour laquelle la qualité souhaitée a déjà été appliquée */
let qualityAppliedFor: string | null = null;
let boundVideo: HTMLVideoElement | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
/** Pendant un drag, la barre suit la souris et non la vidéo */
let isSeeking = false;

type TrackChangeCallback = (track: Track) => void;
let onTrackChangeCallback: TrackChangeCallback | null = null;

type PlayStateCallback = (track: Track, isPlaying: boolean) => void;
let onPlayStateCallback: PlayStateCallback | null = null;

export function setOnTrackChange(cb: TrackChangeCallback): void {
  onTrackChangeCallback = cb;
}

export function setOnPlayStateChange(cb: PlayStateCallback): void {
  onPlayStateCallback = cb;
}

let onCloseCallback: (() => void) | null = null;

export function setOnClose(cb: () => void): void {
  onCloseCallback = cb;
}

// ── Accès au contenu de l'iframe ──────────────────────────────

function frameDoc(): Document | null {
  try {
    return frame?.contentDocument ?? null;
  } catch {
    return null; // navigation en cours
  }
}

function frameVideo(): HTMLVideoElement | null {
  return frameDoc()?.querySelector<HTMLVideoElement>('#movie_player video') ?? null;
}

function isAdShowing(): boolean {
  return !!frameDoc()?.querySelector('#movie_player.ad-showing');
}

// ── Synchronisation avec la page /watch ───────────────────────

function tick(): void {
  const doc = frameDoc();
  if (!doc || !state.currentTrack) return;

  // Le document change à chaque piste : on réinjecte le CSS
  if (!doc.getElementById(FRAME_STYLE_ID) && (doc.head || doc.documentElement)) {
    const style = doc.createElement('style');
    style.id = FRAME_STYLE_ID;
    style.textContent = FRAME_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
    frame?.contentWindow?.dispatchEvent(new Event('resize'));
  }

  const video = frameVideo();
  if (video && video !== boundVideo) bindVideo(video);

  if (hasPlayerError(doc)) showEmbedError();

  // Répétition : boucle native du <video>, jamais pendant une pub.
  // Réappliquée à chaque tick car YouTube réinitialise l'élément (pubs, chargement).
  // Avec loop, "ended" ne se déclenche pas : pas d'autoplay YouTube vers une autre vidéo.
  if (video) {
    const loop = state.repeat && !isAdShowing();
    if (video.loop !== loop) video.loop = loop;
  }

  if (video && !isSeeking && !isAdShowing() && video.duration > 0) {
    updateProgress(video.currentTime, video.duration);
  }

  syncLikeFromFrame(doc, state.currentTrack.id);
}

/**
 * L'iframe est une vraie page /watch, même origine : son bouton « j'aime »
 * porte l'état réel du compte. C'est la seule piste pour laquelle on connaît
 * cet état sans requête supplémentaire — on en profite pour corriger le cache
 * local que la tracklist affiche (voir library.ts).
 */
function syncLikeFromFrame(doc: Document, videoId: string): void {
  const pressed = doc.querySelector(SEL_FRAME_LIKE)?.getAttribute('aria-pressed');
  if (pressed === 'true' || pressed === 'false') cacheLikeState(videoId, pressed === 'true');
}

function bindVideo(video: HTMLVideoElement): void {
  boundVideo = video;
  applyVolume(video);

  // YouTube réapplique son propre volume (chargement, pubs) : on le corrige aussitôt
  video.addEventListener('volumechange', () => {
    if (video === boundVideo) applyVolume(video);
  });

  video.addEventListener('playing', () => {
    setPlaying(true);
    // Le lecteur est prêt et la pub éventuelle terminée : on applique la qualité
    const track = state.currentTrack;
    if (track && !isAdShowing() && qualityAppliedFor !== track.id && state.quality !== 'auto') {
      qualityAppliedFor = track.id;
      callPlayerQuality(state.quality);
    }
  });
  video.addEventListener('pause', () => setPlaying(false));
  video.addEventListener('ended', () => {
    // La fin d'une pub déclenche aussi "ended"
    if (video !== boundVideo || isAdShowing()) return;
    setPlaying(false);
    nextTrack();
  });

  if (!video.paused) setPlaying(true);
}

function hasPlayerError(doc: Document): boolean {
  const err = doc.querySelector<HTMLElement>('#movie_player .ytp-error');
  return !!err && err.getClientRects().length > 0;
}

function setPlaying(playing: boolean): void {
  if (state.isPlaying === playing) return;
  state.isPlaying = playing;
  setPlayIcon(playing);
  if (state.currentTrack) onPlayStateCallback?.(state.currentTrack, playing);
}

function startPolling(): void {
  if (pollInterval) return;
  pollInterval = setInterval(tick, POLL_MS);
}

function stopPolling(): void {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

// ── Construction du widget ────────────────────────────────────

function buildWidget(): HTMLElement {
  const widget = document.createElement('div');
  widget.id = PLAYER_ID;
  widget.setAttribute('role', 'region');
  widget.setAttribute('aria-label', t('playerRegion'));

  widget.innerHTML = `
    <!-- Zone du player YouTube — l'iframe /watch y est insérée -->
    <div class="ytp-w-iframe-wrap">
      <div id="ytp-page-player"></div>
      <button class="ytp-w-close" id="ytp-w-close" title="${t('closePlayer')}" aria-label="${t('closePlayer')}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18"/>
        </svg>
      </button>
    </div>

    <div class="ytp-w-controls">
      <div class="ytp-w-head">
        <div class="ytp-w-meta">
          <div class="ytp-w-title" id="ytp-w-title">${t('noTrack')}</div>
          <div class="ytp-w-tooltip" id="ytp-w-tooltip" role="tooltip"></div>
          <a class="ytp-w-artist" id="ytp-w-artist" target="_blank" rel="noopener noreferrer"></a>
        </div>
        <div class="ytp-w-actions">
          <div class="ytp-w-quality" id="ytp-w-quality">
            <button class="ytp-w-quality__btn" id="ytp-w-quality-btn" title="${t('videoQuality')}"
                    aria-haspopup="menu" aria-expanded="false">Auto</button>
            <div class="ytp-w-quality__menu" id="ytp-w-quality-menu" role="menu"></div>
          </div>
          <a class="ytp-w-btn ytp-w-btn--action" id="ytp-w-open-yt" href="https://www.youtube.com/"
             target="_blank" rel="noopener noreferrer" title="${t('openVideo')}">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M21.6 7.2a2.5 2.5 0 0 0-1.76-1.77C18.28 5 12 5 12 5s-6.28 0-7.84.43A2.5 2.5 0 0 0 2.4 7.2C2 8.77 2 12 2 12s0 3.23.4 4.8a2.5 2.5 0 0 0 1.76 1.77C5.72 19 12 19 12 19s6.28 0 7.84-.43a2.5 2.5 0 0 0 1.76-1.77C22 15.23 22 12 22 12s0-3.23-.4-4.8zM10 15V9l5.2 3z"/>
            </svg>
          </a>
        </div>
      </div>

      <div class="ytp-w-buttons">
        <!-- Répéter : ancré à gauche, symétrique du volume -->
        <button class="ytp-w-btn ytp-w-btn--repeat" id="ytp-w-repeat" title="${t('repeatOn')}" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
            <path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>
            <text x="12" y="14.5" text-anchor="middle" font-size="7" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">1</text>
          </svg>
        </button>
        <button class="ytp-w-btn" id="ytp-w-prev" title="${t('previous')}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button class="ytp-w-btn ytp-w-btn--skip" id="ytp-w-back" title="${t('skipBack', SKIP_SECONDS)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>
            <text x="12" y="15.5" text-anchor="middle" font-size="9.5" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">${SKIP_SECONDS}</text>
          </svg>
        </button>
        <button class="ytp-w-btn ytp-w-btn--play" id="ytp-w-play" title="${t('playPause')}">
          <svg class="ytp-icon-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <svg class="ytp-icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        </button>
        <button class="ytp-w-btn ytp-w-btn--skip" id="ytp-w-forward" title="${t('skipForward', SKIP_SECONDS)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>
            <text x="12" y="15.5" text-anchor="middle" font-size="9.5" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">${SKIP_SECONDS}</text>
          </svg>
        </button>
        <button class="ytp-w-btn" id="ytp-w-next" title="${t('next')}">
          <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm2.5-6 5.5 4V8zm7.5-6h2v12h-2z"/></svg>
        </button>

        <!-- Volume : jauge verticale affichée au survol -->
        <div class="ytp-w-vol" id="ytp-w-vol">
          <div class="ytp-w-vol__popover">
            <div class="ytp-w-vol__bar" id="ytp-w-volume" role="slider" tabindex="0"
                 aria-label="${t('volume')}" aria-orientation="vertical"
                 aria-valuemin="0" aria-valuemax="100" aria-valuenow="80">
              <div class="ytp-w-vol__track"><div class="ytp-w-vol__fill"></div></div>
              <div class="ytp-w-vol__thumb"></div>
            </div>
          </div>
          <button class="ytp-w-btn ytp-w-btn--volume" id="ytp-w-mute" title="${t('mute')}" data-level="high">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor"/>
              <path class="ytp-vol-wave1" d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path class="ytp-vol-wave2" d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
              <path class="ytp-vol-mute" d="m22 9-6 6m0-6 6 6"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="ytp-w-seek">
        <div class="ytp-w-progress" id="ytp-w-progress" role="slider" tabindex="0"
             aria-label="${t('seekPosition')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="ytp-w-progress__track">
            <div class="ytp-w-progress__fill"></div>
          </div>
          <div class="ytp-w-progress__thumb"></div>
        </div>
        <div class="ytp-w-times">
          <span id="ytp-w-current">0:00</span>
          <span id="ytp-w-duration">0:00</span>
        </div>
      </div>
    </div>
  `;

  return widget;
}

// ── Montage ───────────────────────────────────────────────────

export async function mountPlayer(playlist: Track[]): Promise<void> {
  state.playlist = playlist;

  if (!document.getElementById(PLAYER_ID)) {
    const widget = buildWidget();
    document.body.appendChild(widget);
    bindControls();
  }

  await loadSavedPrefs();
  updateVolumeUi();
  updateRepeatUi();
  updateQualityUi();
}

function bindControls(): void {
  document.getElementById('ytp-w-close')?.addEventListener('click', closePlayer);
  document.getElementById('ytp-w-play')?.addEventListener('click', togglePlayPause);
  document.getElementById('ytp-w-prev')?.addEventListener('click', prevTrack);
  document.getElementById('ytp-w-next')?.addEventListener('click', nextTrack);
  document.getElementById('ytp-w-back')?.addEventListener('click', () => seekBy(-SKIP_SECONDS));
  document.getElementById('ytp-w-forward')?.addEventListener('click', () => seekBy(SKIP_SECONDS));

  const bar = document.getElementById('ytp-w-progress');
  if (bar) bindSeekBar(bar);

  document.getElementById('ytp-w-mute')?.addEventListener('click', toggleMute);

  const vol = document.getElementById('ytp-w-vol');
  const volBar = document.getElementById('ytp-w-volume');
  if (vol && volBar) bindVolumeBar(vol, volBar);

  // Ouvrir sur YouTube : on met le widget en pause pour éviter le double son
  document.getElementById('ytp-w-open-yt')?.addEventListener('click', () => {
    frameVideo()?.pause();
  });

  document.getElementById('ytp-w-repeat')?.addEventListener('click', toggleRepeat);

  bindQualityMenu();
  bindTitleTooltip();
}

// ── Répéter ───────────────────────────────────────────────────

export function toggleRepeat(): void {
  state.repeat = !state.repeat;
  chrome.storage.local.set({ [REPEAT_STORAGE_KEY]: state.repeat });
  updateRepeatUi();
  tick(); // applique video.loop sans attendre le prochain tick
}

function updateRepeatUi(): void {
  const btn = document.getElementById('ytp-w-repeat');
  if (!btn) return;
  btn.classList.toggle('ytp-w-btn--on', state.repeat);
  btn.setAttribute('aria-pressed', String(state.repeat));
  btn.title = t(state.repeat ? 'repeatOff' : 'repeatOn');
}

// ── Qualité vidéo ─────────────────────────────────────────────

/**
 * L'API du lecteur (setPlaybackQualityRange…) n'existe que dans le monde
 * "MAIN" de la page /watch : background.ts l'appelle via chrome.scripting
 * dans la frame de notre iframe.
 */
async function callPlayerQuality(quality: VideoQuality | null): Promise<PlayerQualityInfo | null> {
  if (!frame?.isConnected) return null;
  // runtime.getFrameId (Chrome 106+) est absent de @types/chrome 0.0.279
  const runtime = chrome.runtime as typeof chrome.runtime & { getFrameId(el: Element): number };
  try {
    const frameId = runtime.getFrameId(frame);
    if (frameId < 0) return null;
    const res = await chrome.runtime.sendMessage({ type: 'YT_PLAYER_QUALITY', frameId, quality }) as
      { success: boolean; info?: PlayerQualityInfo | null } | undefined;
    return res?.success ? res.info ?? null : null;
  } catch (err) {
    console.debug('[YTP] Qualité', err);
    return null;
  }
}

function bindQualityMenu(): void {
  const container = document.getElementById('ytp-w-quality');
  const btn = document.getElementById('ytp-w-quality-btn');
  const menu = document.getElementById('ytp-w-quality-menu');
  if (!container || !btn || !menu) return;

  const close = () => {
    container.classList.remove('ytp-w-quality--open');
    btn.setAttribute('aria-expanded', 'false');
  };

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (container.classList.contains('ytp-w-quality--open')) return close();

    // Niveaux disponibles pour la vidéo en cours (liste par défaut sinon)
    const info = state.currentTrack ? await callPlayerQuality(null) : null;
    const levels = info?.available.length
      ? info.available
      : (Object.keys(QUALITY_LABELS) as VideoQuality[]);
    const ordered = ['auto', ...levels.filter((q) => q !== 'auto')] as VideoQuality[];

    menu.replaceChildren(...ordered.map((q) => {
      const item = document.createElement('button');
      item.className = 'ytp-w-quality__item';
      item.setAttribute('role', 'menuitemradio');
      item.setAttribute('aria-checked', String(q === state.quality));
      item.textContent = QUALITY_LABELS[q] ?? q;
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        close();
        setQuality(q);
      });
      return item;
    }));

    container.classList.add('ytp-w-quality--open');
    btn.setAttribute('aria-expanded', 'true');
  });

  // Clic ailleurs : fermeture (listener retiré au démontage du widget)
  documentListeners?.abort();
  documentListeners = new AbortController();
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target as Node)) close();
  }, { signal: documentListeners.signal });
  container.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); btn.focus(); }
  });
}

function setQuality(quality: VideoQuality): void {
  state.quality = quality;
  chrome.storage.local.set({ [QUALITY_STORAGE_KEY]: quality });
  updateQualityUi();
  if (state.currentTrack) {
    qualityAppliedFor = state.currentTrack.id;
    callPlayerQuality(quality);
  }
}

function updateQualityUi(): void {
  const btn = document.getElementById('ytp-w-quality-btn');
  if (btn) btn.textContent = QUALITY_LABELS[state.quality];
}

// ── Tooltip du titre (uniquement s'il est tronqué) ────────────

function bindTitleTooltip(): void {
  const title = document.getElementById('ytp-w-title');
  const tooltip = document.getElementById('ytp-w-tooltip');
  if (!title || !tooltip) return;

  let timer: ReturnType<typeof setTimeout> | null = null;

  title.addEventListener('mouseenter', () => {
    if (title.scrollWidth <= title.clientWidth) return; // titre entier visible
    timer = setTimeout(() => {
      tooltip.textContent = title.textContent;
      tooltip.classList.add('ytp-w-tooltip--visible');
    }, 350);
  });

  title.addEventListener('mouseleave', () => {
    if (timer) clearTimeout(timer);
    tooltip.classList.remove('ytp-w-tooltip--visible');
  });
}

/**
 * Jauge de volume verticale (affichée au survol via CSS).
 * Drag, molette et flèches ↑ ↓ quand elle a le focus.
 */
function bindVolumeBar(container: HTMLElement, bar: HTMLElement): void {
  const volumeAt = (clientY: number): number => {
    const rect = bar.getBoundingClientRect();
    return ((rect.bottom - clientY) / rect.height) * 100;
  };

  let dragging = false;

  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    dragging = true;
    // Garde la jauge ouverte même si la souris sort pendant le drag
    container.classList.add('ytp-w-vol--dragging');
    setVolume(volumeAt(e.clientY));
  });

  bar.addEventListener('pointermove', (e) => {
    if (dragging) setVolume(volumeAt(e.clientY));
  });

  const endDrag = () => {
    dragging = false;
    container.classList.remove('ytp-w-vol--dragging');
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    setVolume(state.volume + (e.deltaY < 0 ? 5 : -5));
  }, { passive: false });

  bar.addEventListener('keydown', (e) => {
    const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    e.stopPropagation(); // ne pas déclencher le seek global de ← →
    setVolume(state.volume + step);
  });
}

/**
 * Barre de progression façon Spotify : clic ou drag.
 * Pendant le drag seule la barre bouge ; la vidéo est positionnée
 * au relâchement (évite de spammer des seeks pendant la pub/buffer).
 */
function bindSeekBar(bar: HTMLElement): void {
  const seekableVideo = (): HTMLVideoElement | null => {
    const video = frameVideo();
    return video && !isAdShowing() && video.duration > 0 ? video : null;
  };

  const ratioAt = (clientX: number): number => {
    const rect = bar.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  bar.addEventListener('pointerdown', (e) => {
    const video = seekableVideo();
    if (!video || e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    isSeeking = true;
    bar.classList.add('ytp-w-progress--dragging');
    updateProgress(ratioAt(e.clientX) * video.duration, video.duration);
  });

  bar.addEventListener('pointermove', (e) => {
    const video = seekableVideo();
    if (!isSeeking || !video) return;
    updateProgress(ratioAt(e.clientX) * video.duration, video.duration);
  });

  const endDrag = (e: PointerEvent, commit: boolean) => {
    if (!isSeeking) return;
    isSeeking = false;
    bar.classList.remove('ytp-w-progress--dragging');
    const video = seekableVideo();
    if (commit && video) video.currentTime = ratioAt(e.clientX) * video.duration;
  };

  bar.addEventListener('pointerup', (e) => endDrag(e, true));
  bar.addEventListener('pointercancel', (e) => endDrag(e, false));

  // Accessibilité clavier sur la barre elle-même
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    seekBy(e.key === 'ArrowLeft' ? -SKIP_SECONDS : SKIP_SECONDS);
  });
}

// ── API publique ──────────────────────────────────────────────

export function playTrack(track: Track): void {
  state.currentTrack = track;
  state.isPlaying = false; // confirmé par l'événement "playing"

  showWidget();
  updateWidgetInfo(track);
  hideEmbedError();
  setPlayIcon(false);
  isSeeking = false;
  updateProgress(0, 0);

  loadInFrame(track.id);
  startPolling();

  onTrackChangeCallback?.(track);
}

function loadInFrame(videoId: string): void {
  qualityAppliedFor = null;
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  boundVideo = null;

  if (frame?.isConnected && frame.contentWindow) {
    // replace() : n'ajoute pas d'entrée dans l'historique de l'onglet
    frame.contentWindow.location.replace(url);
    return;
  }

  frame = document.createElement('iframe');
  frame.src = url;
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  frame.title = t('playerFrame');
  document.getElementById('ytp-page-player')?.replaceChildren(frame);
}

export function togglePlayPause(): void {
  const video = frameVideo();
  if (!state.currentTrack || !video) return;
  if (video.paused) {
    video.play().catch(() => { /* autoplay bloqué : l'utilisateur recliquera */ });
  } else {
    video.pause();
  }
}

/** Avance (secondes > 0) ou recule (secondes < 0) dans la piste courante */
export function seekBy(seconds: number): void {
  const video = frameVideo();
  if (!video || isAdShowing() || !(video.duration > 0)) return;
  video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + seconds));
  updateProgress(video.currentTime, video.duration);
}

export function nextTrack(): void {
  const { playlist, currentTrack } = state;
  if (!currentTrack || !playlist.length) return;
  const next = playlist[(currentTrack.index + 1) % playlist.length];
  if (next) playTrack(next);
}

export function prevTrack(): void {
  const { playlist, currentTrack } = state;
  if (!currentTrack || !playlist.length) return;
  const prev = playlist[(currentTrack.index - 1 + playlist.length) % playlist.length];
  if (prev) playTrack(prev);
}

export function toggleMute(): void {
  if (state.isMuted || state.volume === 0) {
    state.isMuted = false;
    if (state.volume === 0) state.volume = 50; // comme Spotify : on ne réactive pas à 0
  } else {
    state.isMuted = true;
  }
  onVolumeChanged();
}

export function setVolume(vol: number): void {
  state.volume = Math.round(Math.max(0, Math.min(100, vol)));
  // Bouger le volume réactive le son
  if (state.volume > 0) state.isMuted = false;
  onVolumeChanged();
}

// ── Volume ────────────────────────────────────────────────────

let saveVolumeTimer: ReturnType<typeof setTimeout> | null = null;

function onVolumeChanged(): void {
  applyVolume();
  updateVolumeUi();

  // Mémorisé entre les sessions (debounce : "input" tire en continu pendant le drag)
  if (saveVolumeTimer) clearTimeout(saveVolumeTimer);
  saveVolumeTimer = setTimeout(() => {
    chrome.storage.local.set({
      [VOLUME_STORAGE_KEY]: { volume: state.volume, muted: state.isMuted },
    });
  }, 300);
}

/** Volume, répétition et qualité mémorisés entre les sessions */
async function loadSavedPrefs(): Promise<void> {
  const stored = await chrome.storage.local.get([VOLUME_STORAGE_KEY, REPEAT_STORAGE_KEY, QUALITY_STORAGE_KEY]);
  const saved = stored[VOLUME_STORAGE_KEY] as { volume?: unknown; muted?: unknown } | undefined;
  if (typeof saved?.volume === 'number') state.volume = saved.volume;
  if (typeof saved?.muted === 'boolean') state.isMuted = saved.muted;
  if (typeof stored[REPEAT_STORAGE_KEY] === 'boolean') state.repeat = stored[REPEAT_STORAGE_KEY];
  const quality = stored[QUALITY_STORAGE_KEY];
  if (typeof quality === 'string' && quality in QUALITY_LABELS) state.quality = quality as VideoQuality;
}

/** Aligne le <video> sur le volume du widget (qui fait référence) */
function applyVolume(video = frameVideo()): void {
  if (!video) return;
  const target = state.volume / 100;
  if (Math.abs(video.volume - target) > 0.001) video.volume = target;
  if (video.muted !== state.isMuted) video.muted = state.isMuted;
}

function updateVolumeUi(): void {
  const shown = state.isMuted ? 0 : state.volume;

  const bar = document.getElementById('ytp-w-volume');
  if (bar) {
    bar.style.setProperty('--volume', `${shown}%`);
    bar.setAttribute('aria-valuenow', String(shown));
    bar.setAttribute('aria-valuetext', `${shown} %`);
  }

  const btn = document.getElementById('ytp-w-mute');
  if (btn) {
    btn.dataset.level = shown === 0 ? 'muted' : shown < 50 ? 'low' : 'high';
    btn.title = t(shown === 0 ? 'unmute' : 'mute');
  }
}

export function getState(): Readonly<PlayerState> {
  return state;
}

export function updatePlaylist(tracks: Track[]): void {
  state.playlist = tracks;
}

// ── UI helpers ────────────────────────────────────────────────

function showWidget(): void {
  document.getElementById(PLAYER_ID)?.classList.add('ytp-w--visible');
}

function updateWidgetInfo(track: Track): void {
  const title = document.getElementById('ytp-w-title');
  const artist = document.getElementById('ytp-w-artist');
  if (title) title.textContent = track.title;
  if (artist) {
    artist.textContent = track.artist;
    if (track.channelUrl) {
      artist.setAttribute('href', track.channelUrl);
      artist.title = t('openChannel', track.artist);
    } else {
      artist.removeAttribute('href');
      artist.removeAttribute('title');
    }
  }
  const ytLink = document.getElementById('ytp-w-open-yt') as HTMLAnchorElement | null;
  if (ytLink) ytLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(track.id)}`;
}

function setPlayIcon(playing: boolean): void {
  const play = document.querySelector<HTMLElement>('.ytp-icon-play');
  const pause = document.querySelector<HTMLElement>('.ytp-icon-pause');
  if (!play || !pause) return;
  play.style.display = playing ? 'none' : 'block';
  pause.style.display = playing ? 'block' : 'none';
}

function showEmbedError(): void {
  if (document.getElementById('ytp-embed-error')) return;
  const videoId = encodeURIComponent(state.currentTrack?.id ?? '');
  const err = document.createElement('div');
  err.id = 'ytp-embed-error';
  err.innerHTML = `
    <div class="ytp-err-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
      </svg>
    </div>
    <p class="ytp-err-msg">${t('videoUnavailable')}</p>
    <a class="ytp-err-link"
       href="https://www.youtube.com/watch?v=${videoId}"
       target="_blank" rel="noopener noreferrer">
      Ouvrir sur YouTube ↗
    </a>`;
  document.querySelector('.ytp-w-iframe-wrap')?.appendChild(err);
  setPlaying(false);
}

function hideEmbedError(): void {
  document.getElementById('ytp-embed-error')?.remove();
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function updateProgress(currentTime: number, duration: number): void {
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const bar = document.getElementById('ytp-w-progress');
  if (bar) {
    bar.style.setProperty('--progress', `${pct}%`);
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.setAttribute('aria-valuetext', formatTime(currentTime));
  }
  const current = document.getElementById('ytp-w-current');
  const total = document.getElementById('ytp-w-duration');
  if (current) current.textContent = formatTime(currentTime);
  if (total) total.textContent = formatTime(duration);
}

/**
 * Ferme le lecteur : coupe le son (l'iframe est retirée) et masque le widget.
 * La tracklist reste en place ; cliquer une piste rouvre le lecteur.
 */
export function closePlayer(): void {
  stopPolling();
  document.getElementById('ytp-page-player')?.replaceChildren();
  frame = null;
  boundVideo = null;
  qualityAppliedFor = null;
  state.currentTrack = null;
  state.isPlaying = false;

  hideEmbedError();
  setPlayIcon(false);
  updateProgress(0, 0);
  document.getElementById(PLAYER_ID)?.classList.remove('ytp-w--visible');
  onCloseCallback?.();
}

export function unmountPlayer(): void {
  stopPolling();
  documentListeners?.abort();
  documentListeners = null;
  frame = null;
  boundVideo = null;
  qualityAppliedFor = null;
  state.currentTrack = null;
  state.isPlaying = false;
  // Retirer le widget retire l'iframe, ce qui coupe le son
  document.getElementById(PLAYER_ID)?.remove();
}
