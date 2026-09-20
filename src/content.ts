// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// content.ts — Point d'entrée principal du content script
// ============================================================
// Orchestration de tous les modules. Gère :
//   - La détection de page
//   - L'interrupteur "Mode liste" (activé / désactivé)
//   - Le montage initial de la tracklist et du player
//   - La navigation SPA de YouTube (changements d'URL sans rechargement)
//   - L'infinite scroll (via extractor.watchForNewTracks)
//   - Le cleanup lors des navigations
// ============================================================

import { detectPage, extractTracks, watchForNewTracks } from './extractor';
import {
  mountTracklist,
  renderTracklist,
  appendTracks,
  setActiveTrack,
  setRowPlayingState,
  unmountTracklist,
  setPlayCallback,
  getSentinel,
} from './tracklist';
import {
  mountPlayer,
  playTrack,
  updatePlaylist,
  unmountPlayer,
  setOnTrackChange,
  setOnPlayStateChange,
  setOnClose,
} from './player';
import { registerKeyboardShortcuts, unregisterKeyboardShortcuts } from './keyboard';
import { loadLikes } from './library';
import { checkPagination, unwatchPagination, watchPagination } from './pagination';
import { initToggleState, isEnabled, showToggle, hideToggle } from './toggle';
import type { Track } from './types';

// ── État global ───────────────────────────────────────────────

let cleanupWatcher: (() => void) | null = null;
let isExtensionMounted = false;
let currentUrl = window.location.href;
let initRetryTimer: ReturnType<typeof setTimeout> | null = null;
/** Incrémenté à chaque (dé)montage : invalide les init() encore en attente */
let initGeneration = 0;

// ── Initialisation ────────────────────────────────────────────

/**
 * Initialise l'extension sur la page courante.
 * Peut être appelée plusieurs fois (navigation SPA) — idempotente.
 */
async function init(): Promise<void> {
  const page = detectPage();
  if (page === 'unknown') {
    cleanup();
    hideToggle();
    return;
  }

  showToggle();
  if (!isEnabled()) {
    cleanup();
    return;
  }

  const generation = ++initGeneration;

  // Attendre que le DOM YouTube soit chargé
  // (YT est une SPA, le contenu arrive async)
  const tracks = await waitForTracks();

  // Navigation ou désactivation pendant l'attente
  if (generation !== initGeneration || !isEnabled()) return;

  if (tracks.length === 0) {
    console.debug('[YTP] Aucune piste trouvée, abandon.');
    return;
  }

  // ── Callbacks ──
  setPlayCallback((track: Track) => {
    playTrack(track);
  });

  setOnTrackChange((track: Track) => {
    setActiveTrack(track.id);
  });

  setOnPlayStateChange((track: Track, isPlaying: boolean) => {
    setRowPlayingState(track.id, isPlaying);
  });

  // Lecteur fermé : plus aucune ligne active
  setOnClose(() => setActiveTrack(null));

  // ── Montage ──
  const root = mountTracklist();
  renderTracklist(root, tracks);

  await mountPlayer(tracks);

  // ── Infinite scroll ──
  cleanupWatcher?.();
  const allTracks = [...tracks];
  cleanupWatcher = watchForNewTracks((newTracks: Track[]) => {
    // Réindexe pour que suivant / précédent suivent l'ordre affiché
    newTracks.forEach((t) => {
      t.index = allTracks.length;
      allTracks.push(t);
    });
    appendTracks(newTracks);
    updatePlaylist([...allTracks]);

    // La liste vient de grandir : le bas est peut-être encore à portée
    checkPagination();
  });

  // Pagination à la demande : sans ça, YouTube charge toute la chaîne d'un coup
  const sentinel = getSentinel();
  if (sentinel) watchPagination(sentinel);

  registerKeyboardShortcuts();
  isExtensionMounted = true;

  console.info(`[YTP] Extension montée — ${tracks.length} pistes (${page})`);
}


/**
 * Nettoie tous les éléments injectés par l'extension
 * (l'interrupteur, lui, est géré par init()).
 */
function cleanup(): void {
  initGeneration++;
  if (initRetryTimer) {
    clearTimeout(initRetryTimer);
    initRetryTimer = null;
  }

  if (!isExtensionMounted) return;

  cleanupWatcher?.();
  cleanupWatcher = null;

  unwatchPagination();
  unmountTracklist();
  unmountPlayer();
  unregisterKeyboardShortcuts();

  isExtensionMounted = false;
  console.info('[YTP] Extension démontée');
}

// ── Attente du DOM YouTube ────────────────────────────────────

/**
 * Attend que YouTube ait rendu au moins une vidéo dans le DOM.
 * Retry toutes les 500ms jusqu'à 10 secondes.
 */
function waitForTracks(maxAttempts = 20, delayMs = 500): Promise<Track[]> {
  return new Promise((resolve) => {
    let attempts = 0;

    const attempt = () => {
      const tracks = extractTracks();
      if (tracks.length > 0) {
        resolve(tracks);
        return;
      }

      attempts++;
      if (attempts >= maxAttempts) {
        resolve([]); // Abandon
        return;
      }

      initRetryTimer = setTimeout(attempt, delayMs);
    };

    attempt();
  });
}

// ── Détection de navigation SPA ───────────────────────────────
// YouTube est une SPA (Single Page Application). Les changements
// d'URL ne déclenchent pas de rechargement de page. On écoute
// l'événement "yt-navigate-finish" de YouTube, avec un
// MutationObserver sur le <title> en filet de sécurité.
// (Patcher history.pushState ne sert à rien : le content script
// vit dans un monde isolé, YouTube appelle sa propre copie.)

function onUrlChange(): void {
  const newUrl = window.location.href;
  if (newUrl === currentUrl) return;

  currentUrl = newUrl;

  // Laisse YouTube finir son propre rendu (300ms)
  setTimeout(() => {
    cleanup();
    init().catch(console.error);
  }, 300);
}

document.addEventListener('yt-navigate-finish', onUrlChange);
window.addEventListener('popstate', onUrlChange);

const titleObserver = new MutationObserver(onUrlChange);
titleObserver.observe(document.querySelector('title') ?? document.head, {
  childList: true,
  subtree: true,
  characterData: true,
});

// ── Démarrage ────────────────────────────────────────────────

initToggleState((enabled) => {
  if (enabled) {
    init().catch(console.error);
  } else {
    cleanup();
    if (detectPage() !== 'unknown') showToggle();
  }
})
  // Le cache des « j'aime » est lu au premier rendu des lignes : on l'attend
  .then(() => loadLikes())
  .then(() => init())
  .catch(console.error);
