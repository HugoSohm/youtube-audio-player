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
/**
 * Ligne de métadonnées sous le titre (vues • date de publication).
 *
 * Les classes de la nouvelle interface sont instables — YouTube est passé de
 * `yt-content-metadata-view-model__metadata-row` à
 * `ytContentMetadataViewModelMetadataRow`. On vise donc d'abord la structure
 * (le custom element et ses lignes), et on garde les deux conventions de
 * nommage en filet.
 */
const SEL_META_ROW = [
  '#metadata-line',
  '#video-info',
  'yt-content-metadata-view-model > div',
  '[class*="MetadataRow"]',
  '[class*="metadata-row"]',
].join(', ');
/** Barre de progression « déjà vue » posée par YouTube sur la miniature */
const SEL_WATCHED = [
  'ytd-thumbnail-overlay-resume-playback-renderer #progress',
  // Nouvelle interface : le suffixe de la classe change au fil des versions
  '[class*="ProgressBarHostWatchedProgressBarSegment"]',
].join(', ');
/** Conteneur injecté par l'extension : ses mutations ne doivent pas relancer l'extraction */
const SEL_OWN_ROOT = '#ytp-tracklist-root';
/** Tous les rendus vidéo, quelle que soit la page ou l'interface */
export const SEL_RENDERERS = [
  SEL_VIDEO_RENDERER,
  SEL_RICH_ITEM,
  SEL_PLAYLIST_ITEM,
  SEL_LOCKUP,
].join(', ');

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

/**
 * Date de publication relative affichée par YouTube ("3 months ago", "il y a 3 mois").
 *
 * YouTube ne l'expose nulle part sous forme structurée : on lit la ligne de
 * métadonnées, où l'ordre est toujours « vues • publication ». On prend donc le
 * dernier élément, et seulement quand la ligne en compte au moins deux — sinon
 * c'est un compteur de vues seul (playlists classiques) et on préfère ne rien
 * afficher plutôt qu'une valeur fausse.
 */
function extractPublished(el: Element, artist: string): string | null {
  const rows = [...el.querySelectorAll(SEL_META_ROW)].reverse();

  for (const row of rows) {
    // Seules les feuilles : un <span> parent répéterait le texte de ses enfants
    const items = [...row.querySelectorAll('span')]
      .filter((span) => !span.querySelector('span'))
      .map((span) => (span.textContent ?? '').replace(/\u00a0/g, ' ').trim())
      .filter((text) => text && text !== '•' && text !== artist);

    const last = items[items.length - 1];
    if (items.length >= 2 && last) return last;
  }

  return null;
}

/**
 * Pourcentage déjà visionné, d'après la barre rouge que YouTube pose sur la
 * miniature des vidéos de l'historique. Sa largeur est en style inline, donc
 * lisible même si le rendu natif est masqué. null = vidéo jamais ouverte
 * (YouTube n'insère alors pas l'overlay).
 */
function extractWatchedPercent(el: Element): number | null {
  const bar = el.querySelector<HTMLElement>(SEL_WATCHED);
  if (!bar) return null;

  const percent = parseFloat(bar.style.width);
  if (!Number.isFinite(percent) || percent <= 0) return null;

  return Math.min(100, percent);
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

  // 5. Date de publication (texte relatif fourni par YouTube, déjà localisé)
  const publishedAt = extractPublished(el, artist);

  // 6. Progression de lecture (historique YouTube)
  const watchedPercent = extractWatchedPercent(el);

  return {
    id: videoId,
    title,
    artist,
    channelUrl,
    duration,
    publishedAt,
    watchedPercent,
    thumbnail,
    index,
  };
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
  const renderers = activePageRoot().querySelectorAll<Element>(SEL_RENDERERS);
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
  const isPlaylistPage = detectPage() === 'playlist';

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const seenIds = new Set<string>();
  // Les rendus déjà traités. Sans ce filtre on ré-extrairait toute la page à
  // chaque lot : avec plusieurs centaines de vidéos, chacune demandant une
  // poignée de querySelectorAll, c'est la principale source de ralentissement.
  const processed = new WeakSet<Element>();
  let nextIndex = 0;

  /** Ne traite que les rendus jamais vus, dans l'ordre du document. */
  const collectNew = (): Track[] => {
    const tracks: Track[] = [];

    container.querySelectorAll<Element>(SEL_RENDERERS).forEach((el) => {
      if (processed.has(el)) return;
      processed.add(el);

      const track = extractFromRenderer(el, nextIndex, isPlaylistPage);
      if (!track) return;
      if (seenIds.has(track.id)) return; // dédoublonnage

      seenIds.add(track.id);
      nextIndex++;
      tracks.push(track);
    });

    return tracks;
  };

  // Pré-remplir avec ce qui est déjà affiché
  collectNew();

  const observer = new MutationObserver((mutations) => {
    // Nos propres ajouts de lignes sont dans le conteneur observé : sans ce
    // filtre, chaque appendTracks() relancerait une extraction (et repousserait
    // le debounce indéfiniment sur les longues listes).
    if (mutations.every((m) => (m.target as Element).closest?.(SEL_OWN_ROOT))) return;

    // Debounce court : la tracklist doit grandir vite, c'est sa hauteur qui
    // éloigne la sentinelle de pagination de YouTube.
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const newTracks = collectNew();
      if (newTracks.length > 0) onNewTracks(newTracks);
    }, 120);
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
