# Contributing to YouTube Audio Player

Thanks for your interest in contributing! Bug reports, fixes, translations and new ideas are all welcome.

## 🐛 Reporting a bug

YouTube changes its interface often, so bug reports are very helpful. Before opening an issue, check that it hasn't already been reported, then [open a bug report](https://github.com/HugoSohm/youtube-audio-player/issues/new?template=bug_report.md) with:

- the page where it happens (search, channel *Videos* tab, playlist, Liked videos…) and an example URL if possible
- what you expected and what happened
- your Chrome version and the extension version
- errors from the DevTools console (filter on `[YTP]`)

## 💡 Suggesting a feature

[Open a feature request](https://github.com/HugoSohm/youtube-audio-player/issues/new?template=feature_request.md) describing the problem it solves. For large changes, please discuss them in an issue before writing code.

## 🛠️ Development setup

Requires [Node.js](https://nodejs.org/) 18 or later and Chrome.

```bash
git clone https://github.com/HugoSohm/youtube-audio-player.git
cd youtube-audio-player
npm install
npm run dev
```

`npm run dev` rebuilds `dist/` on every change. Load `dist/` once in `chrome://extensions` (**Developer mode** → **Load unpacked**), then after each change click the reload button of the extension and refresh the YouTube tab.

See the [README](README.md#project-structure) for the project structure and how the extension works.

## ✅ Before opening a pull request

1. **Type-check** — `npm run typecheck` must pass.
2. **Build** — `npm run build` must succeed.
3. **Test manually** in Chrome on the pages affected by your change, typically:
   - a search results page (`/results?search_query=…`)
   - a channel *Videos* tab (`/@channel/videos`)
   - a playlist (`/playlist?list=…`) and, if you can, Liked videos (`/playlist?list=LL`)
   - toggling *List mode* on and off
   - playback with an ad, infinite scroll, and navigating between pages without reloading
4. **Translations** — every user-visible string goes through `t()` ([`src/i18n.ts`](src/i18n.ts)) and must be added to **all** locale files in [`public/_locales/`](public/_locales/) (`en`, `fr`, `es`). Use named placeholders (`$arg1$`) for values.
5. **Store visuals** — if you change the UI in a visible way, you can regenerate the visuals with `npm run store-assets` (optional, requires Chrome).

## 🧭 Guidelines

- Keep changes focused: one fix or feature per pull request.
- Follow the existing style: TypeScript strict mode, 2-space indentation, small functions with a comment explaining *why* when it isn't obvious.
- Existing code comments are in French; new comments can be written in English or French.
- Prefer robust YouTube selectors and keep fallbacks for both the classic (`ytd-*`) and new (`yt-*-view-model`) interfaces.
- The extension must not collect or send user data. Don't add remote code, analytics or new permissions without discussing it first (see [PRIVACY.md](PRIVACY.md)).

## 🌍 Adding a language

1. Copy `public/_locales/en/messages.json` to `public/_locales/<code>/messages.json` ([Chrome locale codes](https://developer.chrome.com/docs/extensions/reference/api/i18n#locales))
2. Translate every `message` (keep the keys and placeholders unchanged)
3. Keep `appDesc` under 132 characters
4. Build, then test with Chrome set to that language

## 📄 License

By contributing, you agree that your contributions will be licensed under the [GNU Affero General Public License v3.0 or later](LICENSE), the license of this project.
