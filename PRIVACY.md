# Privacy Policy

**Cobalt Canine Downloader** runs locally in your browser and does not collect, store, or transmit personal data, browsing history, or analytics to the extension author or any third-party tracking service.

## Permissions Used

- `contextMenus`: Adds the *Download with Cobalt* right-click menu.
- `activeTab` & `tabs`: Reads the active tab URL when you trigger a download and manages the `https://cobalt.canine.tools/*` helper tab.
- `storage`: Saves your preferences (default mode, helper behavior) and recent download IDs locally in `chrome.storage.local`.
- `downloads`: Starts batch downloads you select and displays progress with *Open* / *Finder* actions.
- `clipboardRead` & `offscreen`: Reads a copied URL from your clipboard only when you click *Paste*, open the popup, or copy a link via right-click.
- `host_permissions` (`https://cobalt.canine.tools/*`): Automates link submission and reads download/picker results on Cobalt.

All media URLs you submit are sent strictly to `cobalt.canine.tools` at your explicit request.
