# Privacy Policy — YouTube Audio Player

_Last updated: September 17, 2026_

YouTube Audio Player ("the extension") is a Chrome extension that displays YouTube search results, channel videos and playlists as a compact tracklist with a floating player.

## Data collection

The extension **does not collect, store on a server, sell or share any personal data**. It has no account system, no analytics and no tracking.

## Data processed locally

To work, the extension reads the content of the YouTube pages you visit (video titles, channel names, durations and links) in order to display the tracklist. This processing happens **only in your browser**; nothing is sent to the developer or to any third party.

The following settings are saved with Chrome's local storage (`chrome.storage.local`) and never leave your browser:

- whether List mode is on or off
- player volume and mute state
- repeat setting
- preferred video quality

## Riptune integration (optional)

When you click the Riptune button in the player, the extension sends the URL of the current YouTube video to the Riptune desktop application **running on your own computer** (`http://127.0.0.1:4774`). If the application is not running, it tries to open it via the `riptune://` link, and opens https://riptune.app if it is not installed. This only happens when you click the button.

## Permissions

- **storage**: save the settings listed above locally.
- **scripting**: change the video quality of the YouTube player shown inside the extension's floating player.
- **youtube.com**: display the tracklist and the player on YouTube pages.
- **127.0.0.1:4774**: send a track to the Riptune application installed on your computer, on request.

## Third parties

Videos are played by YouTube itself inside the floating player. Your use of YouTube remains subject to [Google's Privacy Policy](https://policies.google.com/privacy).

YouTube Audio Player is an independent extension, not affiliated with YouTube or Google.

## Contact

For any question about this policy: contact@hugosohm.fr
