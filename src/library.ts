// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// library.ts — « J'aime » et playlists via l'API interne YouTube
// ============================================================
// YouTube ne masque pas ses résultats derrière une API publique : la page
// parle à /youtubei/v1/* (InnerTube). Le content script tourne sur
// www.youtube.com, donc ces appels sont same-origin et les cookies de
// session suffisent — à condition de signer chaque requête comme le fait
// le site lui-même (en-tête SAPISIDHASH).
//
// Les identifiants nécessaires (clé d'API, version du client) sont posés
// par YouTube dans un <script> inline `ytcfg.set(...)` de la page.
// ============================================================

const ORIGIN = 'https://www.youtube.com';

/** Identifiants InnerTube lus dans la page */
interface InnerTubeConfig {
  apiKey: string;
  clientVersion: string;
  hl: string;
  gl: string;
  sessionIndex: string;
  /** Compte de marque actif, le cas échéant */
  delegatedSessionId: string | null;
}

/** `undefined` = pas encore cherché, `null` = introuvable */
let cachedConfig: InnerTubeConfig | null | undefined;

function readInnerTubeConfig(): InnerTubeConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  let apiKey = '';
  let clientVersion = '';
  let hl = 'en';
  let gl = 'US';
  let sessionIndex = '0';
  let delegatedSessionId: string | null = null;

  for (const script of document.querySelectorAll('script:not([src])')) {
    const text = script.textContent ?? '';
    if (!text.includes('INNERTUBE_API_KEY')) continue;

    apiKey = text.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? apiKey;
    clientVersion = text.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? clientVersion;
    hl = text.match(/"HL":"([^"]+)"/)?.[1] ?? hl;
    gl = text.match(/"GL":"([^"]+)"/)?.[1] ?? gl;
    sessionIndex = text.match(/"SESSION_INDEX":"([^"]*)"/)?.[1] || sessionIndex;
    delegatedSessionId = text.match(/"DELEGATED_SESSION_ID":"([^"]+)"/)?.[1] ?? delegatedSessionId;

    if (apiKey && clientVersion) break;
  }

  cachedConfig =
    apiKey && clientVersion
      ? { apiKey, clientVersion, hl, gl, sessionIndex, delegatedSessionId }
      : null;
  return cachedConfig;
}

// ── Authentification ─────────────────────────────────────────

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Cookie utilisé par Google pour signer les requêtes du site */
function sapisid(): string | null {
  return (
    readCookie('SAPISID') ??
    readCookie('__Secure-3PAPISID') ??
    readCookie('__Secure-1PAPISID')
  );
}

/** L'utilisateur est-il connecté à YouTube dans cet onglet ? */
export function isSignedIn(): boolean {
  return sapisid() !== null && readInnerTubeConfig() !== null;
}

/**
 * En-tête `Authorization` attendu par InnerTube :
 * `SAPISIDHASH <timestamp>_<sha1(timestamp + " " + SAPISID + " " + origine)>`
 */
async function authorization(): Promise<string> {
  const sid = sapisid();
  if (!sid) throw new Error('NOT_SIGNED_IN');

  const timestamp = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(`${timestamp} ${sid} ${ORIGIN}`)
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `SAPISIDHASH ${timestamp}_${hex}`;
}

// ── Appel générique ──────────────────────────────────────────

async function innertube<T = unknown>(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<T> {
  const config = readInnerTubeConfig();
  if (!config) throw new Error('NO_CONFIG');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: await authorization(),
    'X-Origin': ORIGIN,
    'X-Goog-AuthUser': config.sessionIndex,
    'X-Youtube-Client-Name': '1',
    'X-Youtube-Client-Version': config.clientVersion,
  };
  if (config.delegatedSessionId) headers['X-Goog-PageId'] = config.delegatedSessionId;

  const response = await fetch(
    `${ORIGIN}/youtubei/v1/${endpoint}?key=${config.apiKey}&prettyPrint=false`,
    {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: config.clientVersion,
            hl: config.hl,
            gl: config.gl,
          },
        },
        ...payload,
      }),
    }
  );

  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return (await response.json()) as T;
}

// ── « J'aime » ───────────────────────────────────────────────
// YouTube n'expose l'état des « j'aime » que vidéo par vidéo (endpoint
// /next, trop coûteux pour une liste). On tient donc un cache local,
// alimenté par les clics de l'utilisateur et — pour la piste en cours —
// par l'état réel lu dans l'iframe du lecteur (voir player.ts).

const LIKES_STORAGE_KEY = 'likedVideos';
/** Plafond du cache local, pour ne pas laisser gonfler chrome.storage */
const LIKES_MAX = 2000;

const likedIds = new Set<string>();
const likeListeners = new Set<(videoId: string, liked: boolean) => void>();

/** Charge le cache des « j'aime » depuis chrome.storage. */
export async function loadLikes(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(LIKES_STORAGE_KEY);
    const ids = stored[LIKES_STORAGE_KEY];
    if (Array.isArray(ids)) ids.forEach((id) => typeof id === 'string' && likedIds.add(id));
  } catch {
    // storage indisponible : on repart d'un cache vide
  }
}

function persistLikes(): void {
  // On garde les plus récents (Set = ordre d'insertion)
  const ids = [...likedIds].slice(-LIKES_MAX);
  chrome.storage.local.set({ [LIKES_STORAGE_KEY]: ids }).catch(() => {});
}

export function isLiked(videoId: string): boolean {
  return likedIds.has(videoId);
}

/** S'abonne aux changements d'état ; retourne la fonction de désabonnement. */
export function onLikeChange(
  listener: (videoId: string, liked: boolean) => void
): () => void {
  likeListeners.add(listener);
  return () => likeListeners.delete(listener);
}

/**
 * Met à jour le cache sans appeler l'API (état constaté ailleurs,
 * typiquement le bouton « j'aime » de l'iframe du lecteur).
 */
export function cacheLikeState(videoId: string, liked: boolean): void {
  if (likedIds.has(videoId) === liked) return;

  if (liked) likedIds.add(videoId);
  else likedIds.delete(videoId);

  persistLikes();
  likeListeners.forEach((listener) => listener(videoId, liked));
}

/**
 * Bascule le « j'aime » d'une vidéo.
 * @returns le nouvel état
 * @throws si l'utilisateur n'est pas connecté ou si YouTube refuse
 */
export async function toggleLike(videoId: string): Promise<boolean> {
  const liked = !likedIds.has(videoId);
  await innertube(liked ? 'like/like' : 'like/removelike', { target: { videoId } });
  cacheLikeState(videoId, liked);
  return liked;
}

// ── Playlists ────────────────────────────────────────────────

export interface PlaylistOption {
  playlistId: string;
  title: string;
  /** La vidéo est-elle déjà dans cette playlist ? */
  contains: boolean;
}

/**
 * Parcourt la réponse d'InnerTube à la recherche des entrées de playlist.
 * L'enveloppe change régulièrement, le renderer lui-même beaucoup moins :
 * on cherche donc `playlistAddToOptionRenderer` n'importe où dans l'arbre.
 */
function collectPlaylistOptions(node: unknown, out: PlaylistOption[]): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach((child) => collectPlaylistOptions(child, out));
    return;
  }

  const record = node as Record<string, any>;
  const renderer = record.playlistAddToOptionRenderer;
  if (renderer?.playlistId) {
    out.push({
      playlistId: renderer.playlistId,
      title:
        renderer.title?.simpleText ??
        renderer.title?.runs?.[0]?.text ??
        renderer.playlistId,
      contains: renderer.containsSelectedVideos === 'ALL',
    });
    return;
  }

  Object.values(record).forEach((child) => collectPlaylistOptions(child, out));
}

/** Playlists de l'utilisateur, avec l'appartenance de `videoId` à chacune. */
export async function fetchPlaylists(videoId: string): Promise<PlaylistOption[]> {
  const data = await innertube('playlist/get_add_to_playlist', {
    excludeWatchLater: false,
    videoIds: [videoId],
  });

  const options: PlaylistOption[] = [];
  collectPlaylistOptions(data, options);

  // Dédoublonnage : le renderer peut apparaître deux fois (liste + section épinglée)
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.playlistId)) return false;
    seen.add(option.playlistId);
    return true;
  });
}

/** Ajoute ou retire `videoId` de la playlist. */
export async function editPlaylist(
  playlistId: string,
  videoId: string,
  add: boolean
): Promise<void> {
  await innertube('browse/edit_playlist', {
    playlistId,
    actions: [
      add
        ? { action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }
        : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId },
    ],
  });
}

/** Crée une playlist privée contenant `videoId`. */
export async function createPlaylist(title: string, videoId: string): Promise<string> {
  const data = await innertube<{ playlistId?: string }>('playlist/create', {
    title,
    privacyStatus: 'PRIVATE',
    videoIds: [videoId],
  });
  return data.playlistId ?? '';
}
