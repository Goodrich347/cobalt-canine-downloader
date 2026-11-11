# Changelog

## [2.1.0] - 2026-11-11

### Added
- 100% English UI across the floating mini-window, popup, status indicators, and notifications.
- Multi-select batch picker (`Select all`, `Clear`, per-card checkboxes, and `Save selected (N)`) in both the in-page mini-window and the extension popup.
- `cobalt_tap.js` (`MAIN` world fetch tap) to capture Cobalt `picker` media URLs directly and batch-download selected items via `chrome.downloads.download`.
- Multi-select batch toolbar injected into Cobalt's native `.picker-dialog` when using `cobalt.canine.tools` directly.

## [2.0.0] - 2026-11-11

### Added
- In-page Shadow DOM mini-downloader (`page_widget.js`) with draggable header, mode switcher, live job status, and recent downloads list (`Open` / `Finder`).
- Floating `>> Cobalt` pill triggered on copying a URL (`Cmd+C`, text selection, or *Copy link address* via `offscreen` clipboard check).
- Silent background helper tab mode (`silentBackground: true` by default) + compact `460x560` Turnstile fallback window when Cloudflare requires a manual click.
- Added `clipboardRead` and `offscreen` permissions to fix popup clipboard paste access.

## [1.0.0] - 2026-11-11

### Added
- Initial Manifest V3 release with `cobalt.canine.tools` automation (`content.js`), popup (`Auto` / `Audio` / `Mute`), right-click context menus, and `Alt+Shift+D` shortcut.
