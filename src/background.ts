// SPDX-License-Identifier: AGPL-3.0-or-later
// ============================================================
// background.ts — Service Worker MV3
// ============================================================
// - Badge "OFF" sur l'icône quand le "Mode liste" est désactivé
//   (l'icône ouvre la popup : mode liste + thème, voir popup.ts).
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

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !(STORAGE_KEY in changes)) return;
  updateBadge(changes[STORAGE_KEY]?.newValue !== false);
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
