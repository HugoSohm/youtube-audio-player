// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// background.ts — Service Worker MV3
// ============================================================
// - Un clic sur l'icône de l'extension bascule le "Mode liste"
//   (les content scripts réagissent via chrome.storage.onChanged).
// - Relaie les demandes de téléchargement vers l'app Riptune.
// - Change la qualité vidéo du lecteur du widget.
// ============================================================

export {}; // module ES

const STORAGE_KEY = 'enabled';

async function updateBadge(enabled: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: enabled ? '' : 'OFF' });
  await chrome.action.setBadgeBackgroundColor({ color: '#6a6a6a' });
}

async function readEnabled(): Promise<boolean> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] !== false;
}

chrome.action.onClicked.addListener(async () => {
  await chrome.storage.local.set({ [STORAGE_KEY]: !(await readEnabled()) });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(STORAGE_KEY in changes)) return;
  updateBadge(changes[STORAGE_KEY]?.newValue !== false);
});

// ── Riptune ───────────────────────────────────────────────────
// Même stratégie que l'extension officielle Riptune Companion :
//   1. webhook local de l'app (silencieux, si Riptune est ouvert)
//   2. sinon deeplink riptune:// (lance l'app)
// En plus : un navigateur ne peut pas savoir si le protocole riptune://
// mène à une app installée (Chrome propose de l'ouvrir même après une
// désinstallation). Après le deeplink, on attend donc que l'app réponde
// sur son port local ; sans réponse, on ouvre riptune.app.

const RIPTUNE_BASE = 'http://127.0.0.1:4774';
const RIPTUNE_WEBSITE = 'https://riptune.app';
const RIPTUNE_FORMAT = 'mp3';
/** "both" = téléchargement + analyse (BPM / tonalité), comme dans Riptune Companion */
const RIPTUNE_ACTION = 'both';
/** Temps laissé pour accepter "Ouvrir Riptune ?" et lancer l'app */
const RIPTUNE_LAUNCH_TIMEOUT_MS = 12_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** L'app répond-elle sur son port local ? (n'importe quel statut HTTP suffit) */
async function isRiptuneRunning(): Promise<boolean> {
  try {
    await fetch(RIPTUNE_BASE, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns "app" si Riptune a reçu la demande (webhook ou app lancée par le
 *          deeplink), "website" si l'app est introuvable et riptune.app a été ouvert
 */
async function sendToRiptune(videoUrl: string, tabId: number | undefined): Promise<'app' | 'website'> {
  try {
    const res = await fetch(`${RIPTUNE_BASE}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: RIPTUNE_ACTION,
        url: encodeURIComponent(videoUrl),
        format: RIPTUNE_FORMAT,
      }),
    });
    if (res.ok) return 'app';
  } catch {
    // App fermée : on passe au deeplink
  }

  const deepLink = `riptune://${RIPTUNE_ACTION}?url=${encodeURIComponent(videoUrl)}&format=${RIPTUNE_FORMAT}`;
  // Sur l'onglet courant, Chrome affiche "Ouvrir Riptune ?" sans quitter la page
  if (tabId !== undefined) await chrome.tabs.update(tabId, { url: deepLink });
  else await chrome.tabs.create({ url: deepLink });

  // L'app lancée traite le deeplink elle-même : on vérifie juste qu'elle démarre
  const deadline = Date.now() + RIPTUNE_LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1000);
    if (await isRiptuneRunning()) return 'app';
  }

  await chrome.tabs.create({ url: RIPTUNE_WEBSITE, ...(tabId !== undefined ? { openerTabId: tabId } : {}) });
  return 'website';
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'RIPTUNE_DOWNLOAD' || typeof message.url !== 'string') return false;

  sendToRiptune(message.url, sender.tab?.id)
    .then((result) => sendResponse({ success: true, result }))
    .catch((err: Error) => sendResponse({ success: false, error: err.message }));
  return true; // réponse asynchrone
});

// ── Qualité vidéo du lecteur ──────────────────────────────────
// L'API du lecteur YouTube n'est accessible que dans le monde MAIN
// de la page /watch chargée dans l'iframe du widget.

/** Exécutée dans la page /watch (sérialisée par chrome.scripting) */
function playerQualityInPage(quality: string | null) {
  const player = document.getElementById('movie_player') as (HTMLElement & {
    getAvailableQualityLevels?: () => string[];
    getPlaybackQuality?: () => string;
    setPlaybackQualityRange?: (min: string, max: string) => void;
  }) | null;
  if (!player?.getAvailableQualityLevels || !player.getPlaybackQuality) return null;
  if (quality) player.setPlaybackQualityRange?.(quality, quality);
  return { available: player.getAvailableQualityLevels(), current: player.getPlaybackQuality() };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'YT_PLAYER_QUALITY' || typeof message.frameId !== 'number') return false;
  const tabId = sender.tab?.id;
  if (tabId === undefined) return false;

  chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [message.frameId] },
      world: 'MAIN',
      func: playerQualityInPage,
      args: [typeof message.quality === 'string' ? message.quality : null],
    })
    .then(([result]) => sendResponse({ success: true, info: result?.result ?? null }))
    .catch((err: Error) => sendResponse({ success: false, error: err.message }));
  return true;
});

chrome.runtime.onStartup.addListener(async () => updateBadge(await readEnabled()));
chrome.runtime.onInstalled.addListener(async () => updateBadge(await readEnabled()));
