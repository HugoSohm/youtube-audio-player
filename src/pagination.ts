// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// pagination.ts — Chargement des lots suivants, à la demande
// ============================================================
// YouTube pagine en gardant une sentinelle (« continuation ») en fin de
// liste : dès qu'elle entre dans la fenêtre, il charge le lot suivant.
//
// Or l'extension masque le rendu natif, ce qui fait s'effondrer la hauteur
// de la page : la sentinelle reste visible en permanence et chaque lot
// chargé, masqué à son tour, n'ajoute aucune hauteur. Rien ne l'éloigne
// donc jamais de la fenêtre et YouTube enchaîne les lots jusqu'à épuiser
// la chaîne (mesuré : 30 → 761 vidéos en 6 s, sans défilement).
//
// On garde donc la sentinelle masquée (voir tracklist.scss) et on ne la
// révèle que le temps d'un lot, quand l'utilisateur atteint le bas de la
// tracklist. Un lot par ouverture, comme une pagination normale.
// ============================================================

import { activePageRoot, SEL_RENDERERS } from './extractor';

/** Posée sur <html> pour révéler la sentinelle de YouTube */
const LOAD_MORE_CLASS = 'ytp-load-more';
/** Distance au bas de la liste à partir de laquelle on précharge */
const PRELOAD_PX = 600;
/** Sans nouveau lot dans ce délai, on considère la liste épuisée */
const BATCH_TIMEOUT_MS = 5000;

let sentinel: HTMLElement | null = null;
let sentinelObserver: IntersectionObserver | null = null;
/** Surveille l'arrivée du lot pendant que la porte est ouverte */
let batchObserver: MutationObserver | null = null;
let batchTimer: ReturnType<typeof setTimeout> | null = null;
/** Une seule ouverture à la fois */
let isLoading = false;
/** YouTube n'a plus rien à donner : on arrête de demander */
let exhausted = false;
/** Écoute du défilement, pour retenter après chaque geste de l'utilisateur */
let scrollListener: AbortController | null = null;
/** rAF en attente, pour ne pas empiler les re-vérifications */
let recheckFrame: number | null = null;
/** Position de la sentinelle à la dernière ouverture, pour mesurer la progression */
let lastOffset = -1;
/** Ouvertures consécutives qui n'ont rien ajouté à la liste */
let stalledOpens = 0;
/** Au-delà, on arrête : YouTube répond mais plus rien n'arrive dans la tracklist */
const MAX_STALLED_OPENS = 3;

// ── Porte ─────────────────────────────────────────────────────

/**
 * Révèle la sentinelle de YouTube et la remasque dès qu'un lot arrive.
 *
 * La fermeture passe par un MutationObserver plutôt que par un délai :
 * ouverte ne serait-ce que 900 ms, YouTube enchaîne quatre lots.
 */
function openGate(): void {
  if (isLoading || exhausted || !sentinel) return;

  // Si la liste n'a pas grandi depuis la dernière ouverture, insister ne sert
  // à rien : YouTube renvoie des éléments que l'extracteur écarte tous
  // (playlists, mixes…). Sans ce garde-fou on rouvrirait en boucle.
  const offset = sentinel.offsetTop;
  if (offset === lastOffset) {
    if (++stalledOpens >= MAX_STALLED_OPENS) {
      exhausted = true;
      return;
    }
  } else {
    stalledOpens = 0;
    lastOffset = offset;
  }

  isLoading = true;

  batchObserver = new MutationObserver((mutations) => {
    const gotBatch = mutations.some((mutation) =>
      [...mutation.addedNodes].some(
        (node) => node instanceof Element && node.matches(SEL_RENDERERS)
      )
    );
    if (gotBatch) closeGate(true);
  });
  batchObserver.observe(activePageRoot(), { childList: true, subtree: true });

  document.documentElement.classList.add(LOAD_MORE_CLASS);
  batchTimer = setTimeout(() => closeGate(false), BATCH_TIMEOUT_MS);
}

function closeGate(gotBatch: boolean): void {
  document.documentElement.classList.remove(LOAD_MORE_CLASS);

  batchObserver?.disconnect();
  batchObserver = null;

  if (batchTimer !== null) clearTimeout(batchTimer);
  batchTimer = null;

  isLoading = false;

  // Porte ouverte, rien n'est venu : la chaîne / recherche est au bout
  if (!gotBatch) {
    exhausted = true;
    return;
  }

  // Pas de re-vérification ici : la porte se referme dès l'arrivée du lot,
  // alors que les lignes ne sont ajoutées qu'après le debounce de
  // l'extracteur. Vérifier maintenant verrait la sentinelle encore en bas et
  // rouvrirait aussitôt — huit lots d'affilée pour un seul geste, mesuré.
  // C'est donc checkPagination(), appelé après appendTracks(), qui relance.
}

function scheduleRecheck(): void {
  if (recheckFrame !== null) return;
  recheckFrame = requestAnimationFrame(() => {
    recheckFrame = null;
    checkPagination();
  });
}

// ── Déclenchement ─────────────────────────────────────────────

/**
 * Demande un lot si le bas de la tracklist approche.
 *
 * Appelée par l'IntersectionObserver, mais aussi après chaque ajout de
 * lignes : l'IO ne se déclenche qu'aux changements d'état, et si un lot
 * laissait la sentinelle toujours visible on resterait bloqué.
 */
export function checkPagination(): void {
  if (!sentinel || isLoading || exhausted) return;

  const { top } = sentinel.getBoundingClientRect();
  if (top <= window.innerHeight + PRELOAD_PX) openGate();
}

/**
 * Commence à surveiller la fin de la tracklist.
 * @param element repère placé après la dernière ligne
 */
export function watchPagination(element: HTMLElement): void {
  unwatchPagination();

  sentinel = element;
  exhausted = false;

  sentinelObserver = new IntersectionObserver(() => checkPagination(), {
    rootMargin: `0px 0px ${PRELOAD_PX}px 0px`,
  });
  sentinelObserver.observe(element);

  // L'IntersectionObserver ne signale que les changements d'état : si la
  // sentinelle reste visible après un lot, il ne redira rien. Le défilement
  // de l'utilisateur sert alors de relance.
  scrollListener = new AbortController();
  window.addEventListener('scroll', scheduleRecheck, {
    signal: scrollListener.signal,
    passive: true,
  });

  // La liste initiale peut déjà être plus courte que la fenêtre
  checkPagination();
}

/** Arrête toute surveillance et remasque la sentinelle de YouTube. */
export function unwatchPagination(): void {
  closeGate(true); // true : pas de conclusion sur l'épuisement au démontage

  sentinelObserver?.disconnect();
  sentinelObserver = null;

  scrollListener?.abort();
  scrollListener = null;

  if (recheckFrame !== null) cancelAnimationFrame(recheckFrame);
  recheckFrame = null;

  sentinel = null;
  exhausted = false;
  lastOffset = -1;
  stalledOpens = 0;
}
