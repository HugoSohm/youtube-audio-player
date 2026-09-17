// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// extractor.ts — Extraction des pistes depuis le DOM YouTube
// ============================================================

import type { Track, YouTubePage } from './types';

// ── Sélecteurs CSS YouTube ────────────────────────────────────
// YouTube utilise des Web Components : ytd-* (interface classique) et
// yt-*-view-model (nouvelle interface, déployée progressivement).
// Pages ciblées : /results, /@*/videos et /playlist (dont les titres likés).

/** Conteneur racine d'un rendu vidéo (page de recherche) */
const SEL_VIDEO_RENDERER = 'ytd-video-renderer';
/** Conteneur racine d'un item riche (page chaîne) */
const SEL_RICH_ITEM = 'ytd-rich-item-renderer';
/** Vidéo d'une playlist (interface classique) */
const SEL_PLAYLIST_ITEM = 'ytd-playlist-video-renderer';
/** Vidéo dans la nouvelle interface (playlists, titres likés…) */
const SEL_LOCKUP = 'yt-lockup-view-model';
/** Lien cliquable vers la vidéo */
const SEL_VIDEO_LINK = 'a#video-title, a#video-title-link, a.ytLockupMetadataViewModelTitle';
/** Durée de la vidéo */
const SEL_DURATION = 'span.ytd-thumbnail-overlay-time-status-renderer, ytd-thumbnail-overlay-time-status-renderer span[aria-label], .ytBadgeShapeText';
/** Nom de la chaîne */
const SEL_CHANNEL = 'ytd-channel-name a, .ytd-channel-name a, a.ytAttributedStringLink[href^="/@"], a.ytAttributedStringLink[href^="/channel/"]';
/** Miniature */
const SEL_THUMBNAIL = 'img.yt-core-image, img#img';

// ── Utilitaires ───────────────────────────────────────────────

/**
 * Extrait le videoId depuis un href YouTube.
 * Accepte "/watch?v=ID" et "https://www.youtube.com/watch?v=ID".
 */
function extractVideoId(href: string): string | null {
  try {
    // Préfixe l'URL si relative
    const url = href.startsWith('http')
      ? new URL(href)
      : new URL(href, 'https://www.youtube.com');
    return url.searchParams.get('v');
  } catch {
    return null;
  }
}

/**
 * Construit l'URL de miniature YouTube depuis un videoId.
 * mqdefault = 320×180 (toujours disponible, même pour les vieilles vidéos).
 */
function buildThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Nettoie le texte de durée (supprime les espaces insécables et les zéros inutiles).
 * Ex: " 3:42 " → "3:42", "1:03:07" → "1:03:07"
 */
function cleanDuration(raw: string): string {
  return raw.replace(/\u00a0/g, '').trim();
}

/**
 * Page YouTube actuellement affichée.
 * YouTube garde les pages précédentes dans ytd-page-manager avec
 * l'attribut "hidden" : sans ce filtre on extrairait aussi leurs vidéos.
 */
export function activePageRoot(): Element {
  return (
    document.querySelector('ytd-page-manager > :not([hidden])') ??
    document.body
  );
}

// ── Extraction depuis un nœud renderer ───────────────────────

/**
 * Extrait une Track depuis un élément ytd-video-renderer ou ytd-rich-item-renderer.
 * Retourne null si les données essentielles (id, titre) sont manquantes.
 */
function extractFromRenderer(el: Element, index: number, isPlaylistPage: boolean): Track | null {
  // 1. Lien vidéo → titre + href
  const linkEl = el.querySelector<HTMLAnchorElement>(SEL_VIDEO_LINK);
  if (!linkEl) return null;

  const href = linkEl.getAttribute('href') ?? '';
  // Hors page playlist, un lockup qui pointe vers une liste est une playlist ou un mix
  if (!isPlaylistPage && el.matches(SEL_LOCKUP) && /[?&]list=/.test(href)) return null;
  const videoId = extractVideoId(href);
  if (!videoId) return null;

  const title = (linkEl.getAttribute('title') ?? linkEl.textContent ?? '').trim();
  if (!title) return null;

  // 2. Chaîne — absente des vignettes sur une page chaîne : on prend alors la chaîne de la page
  const channelEl = el.querySelector<HTMLAnchorElement>(SEL_CHANNEL);
  const pageChannel = channelEl ? null : currentPageChannel();
  const artist = (channelEl?.textContent ?? pageChannel?.name ?? 'Unknown').trim();
  const channelHref = channelEl?.getAttribute('href');
  const channelUrl = channelHref
    ? new URL(channelHref, 'https://www.youtube.com').href
    : pageChannel?.url ?? null;

  // 3. Durée — plusieurs emplacements possibles
  let duration = '—';
  // Plusieurs badges possibles (ex. "NOUVEAU") : on préfère celui au format m:ss
  const durationEls = [...el.querySelectorAll(SEL_DURATION)];
  const durationEl =
    durationEls.find((d) => /^\d+(:\d{2})+$/.test(cleanDuration(d.textContent ?? ''))) ??
    durationEls[0];
  if (durationEl) {
    // Préférer aria-label qui contient la durée lisible ("3 minutes, 42 seconds")
    // mais le textContent est plus court ("3:42")
    const raw = durationEl.textContent ?? '';
    duration = cleanDuration(raw) || '—';
  }

  // 4. Miniature — on préfère construire l'URL depuis l'ID pour éviter
  //    les images floues/lazy-loaded du DOM
  const thumbnail = buildThumbnailUrl(videoId);

  return { id: videoId, title, artist, channelUrl, duration, thumbnail, index };
}

/**
 * Chaîne de la page courante (/@handle/videos) : nom depuis l'en-tête,
 * URL depuis le chemin. null hors page chaîne.
 */
function currentPageChannel(): { name: string | null; url: string } | null {
  const handle = window.location.pathname.match(/^\/@[^/]+/)?.[0];
  if (!handle) return null;
  const name = activePageRoot()
    .querySelector('yt-page-header-view-model h1, #page-header h1, #channel-name')
    ?.textContent?.trim();
  return { name: name || null, url: `https://www.youtube.com${handle}` };
}

// ── API publique ──────────────────────────────────────────────

/**
 * Extrait toutes les pistes visibles dans le DOM actuel.
 * Déduplication par videoId (le même clip peut apparaître 2× lors du scroll).
 */
export function extractTracks(): Track[] {
  const renderers = activePageRoot().querySelectorAll<Element>(
    `${SEL_VIDEO_RENDERER}, ${SEL_RICH_ITEM}, ${SEL_PLAYLIST_ITEM}, ${SEL_LOCKUP}`
  );
  const isPlaylistPage = detectPage() === 'playlist';

  const seen = new Set<string>();
  const tracks: Track[] = [];

  renderers.forEach((el) => {
    const track = extractFromRenderer(el, tracks.length, isPlaylistPage);
    if (!track) return;
    if (seen.has(track.id)) return; // dédoublonnage
    seen.add(track.id);
    tracks.push(track);
  });

  return tracks;
}

/**
 * Détecte le type de page YouTube actuelle.
 */
export function detectPage(): YouTubePage {
  const path = window.location.pathname;
  if (path.startsWith('/results')) return 'search';
  if (/^\/@.+\/videos/.test(path)) return 'channel-videos';
  // Playlists, dont les titres likés (list=LL) et « À regarder plus tard » (list=WL)
  if (path === '/playlist' && new URLSearchParams(window.location.search).has('list')) return 'playlist';
  return 'unknown';
}

/**
 * Installe un MutationObserver sur le conteneur de résultats YouTube
 * pour détecter l'infinite scroll et les nouvelles vidéos ajoutées.
 *
 * @param onNewTracks Callback appelé avec les nouvelles pistes découvertes
 * @returns Fonction de cleanup pour déconnecter l'observer
 */
export function watchForNewTracks(
  onNewTracks: (tracks: Track[]) => void
): () => void {
  // Toute la page active : les résultats arrivent dans
  // ytd-section-list-renderer (recherche) ou ytd-rich-grid-renderer (chaîne)
  const container = activePageRoot();

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const seenIds = new Set<string>();

  // Pré-remplir les IDs déjà extraits
  extractTracks().forEach((t) => seenIds.add(t.id));

  const observer = new MutationObserver(() => {
    // Debounce : on attend 300ms après le dernier mutation pour extraire
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const allTracks = extractTracks();
      const newTracks = allTracks.filter((t) => !seenIds.has(t.id));
      if (newTracks.length > 0) {
        newTracks.forEach((t) => seenIds.add(t.id));
        onNewTracks(newTracks);
      }
    }, 300);
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
  });

  // Retourne le cleanup
  return () => {
    observer.disconnect();
    if (debounceTimer !== null) clearTimeout(debounceTimer);
  };
}
