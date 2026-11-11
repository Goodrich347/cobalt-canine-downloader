# Cobalt Canine Downloader

A lightweight Manifest V3 Chrome extension for downloading media from any link or webpage directly through [`cobalt.canine.tools`](https://cobalt.canine.tools/) — without forcing you out of your current tab.

## Features

- **Copy-to-Download Floating Trigger**: Copy a media URL (`Cmd+C` / `Ctrl+C`), highlight a URL on a page, or right-click → *Copy link address*, and a subtle `>> Cobalt` pill pops up right next to it.
- **In-Page Mini Downloader (Shadow DOM)**: Click the floating pill or press **`Option + Shift + D`** (Mac) / **`Alt + Shift + D`** (Windows/Linux) to open a draggable mini-window directly on the current page.
- **Silent Background Helper**: Runs `cobalt.canine.tools` in a silent background tab so you don't lose your place. If Cloudflare Turnstile ever requires a manual click, a 1-click button opens a compact popup window that auto-closes once the download begins.
- **Multi-Select Batch Picker**: For multi-item posts (carousels, albums, or video + audio tracks), select multiple items with checkboxes (`Select all` / `Clear`) and click **Save selected (N)** to download them straight to your system.
- **Live Download Tracking**: Watch real-time download progress and open completed files (`Open` / `Finder`) right from the mini-window or extension popup.
- **Right-Click Context Menu**: Right-click any link, selection, video, or page → *Download with Cobalt* (`Auto`, `Audio only`, or `Mute`).

## Installation (Unpacked / Release)

1. Download the latest release zip from **Releases** (or clone this repository).
2. If using the zip, extract it so you have a folder containing `manifest.json`.
3. Open `chrome://extensions` in Chrome (or any Chromium browser).
4. Enable **Developer mode** (top-right).
5. Click **Load unpacked** and select the extracted folder (or the cloned repo folder).

## Shortcuts & Permissions

- **Default shortcut**: `Option + Shift + D` on macOS, `Alt + Shift + D` on Windows/Linux (customizable at `chrome://extensions/shortcuts`).
- **Why `cobalt.canine.tools` runs in a helper tab**: `cobalt-backend.canine.tools` is protected by Cloudflare Turnstile and requires a verified browser session token (`cf-turnstile-response`), so direct background `fetch()` calls without a real `cobalt.canine.tools` origin tab are rejected.
- **Privacy**: Zero analytics, zero external servers beyond `cobalt.canine.tools` (which you explicitly trigger). See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
