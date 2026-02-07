<p align="center">
  <img src="R3-extension/icons/logo.png" alt="R3 Logo" width="120">
</p>

<h1 align="center">R3 - Record. Run. Repeat.</h1>

<p align="center">
  A lightweight Chrome extension for recording and replaying web interaction tests — no Selenium, no Cypress, no code required.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Chrome-blue" alt="Chrome">
  <img src="https://img.shields.io/badge/manifest-v3-green" alt="Manifest V3">
  <img src="https://img.shields.io/badge/dependencies-0-brightgreen" alt="Dependencies">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
</p>

---

## What is R3?

R3 is a zero-config browser extension that lets anyone — QA leads, developers, non-technical team members — record a web workflow once and replay it with a single click. No test frameworks to install, no scripts to write. Just **Record. Run. Repeat.**

Export your recordings as CSV files and share them with your team. Import them on any machine with the extension installed. That's it.

## Key Features

- **One-click recording** — Click "Start Recording", interact with your app, click "Stop". Done.
- **Smart replay engine** — Polls for elements, dispatches framework-compatible synthetic events, handles SPAs and page navigations.
- **Framework-friendly** — Works with Angular, React, Vue, and vanilla JS apps. Dispatches proper `input`, `change`, and `blur` events for framework state updates.
- **CSV import/export** — Share test cases as simple CSV files. No proprietary formats.
- **SPA support** — Handles client-side navigation, re-injects the player after full page navigations mid-test.
- **Duplicate ID handling** — Finds the first *visible* element when SPAs have multiple elements with the same ID across views.
- **iframe support** — Searches same-origin iframes for elements automatically.
- **Intelligent selectors** — Prioritizes stable selectors: `data-testid` > `id` > `name` > `aria-label` > `placeholder` > CSS path. Filters out dynamic/generated IDs.
- **Visual feedback** — Highlights recorded elements with a red outline during recording.
- **Continue on error** — Optionally skip failed steps and continue the rest of the test.
- **Add Wait steps** — Insert manual wait steps during recording for pages that need extra load time.
- **Auto-save** — Recordings persist in `chrome.storage.local` so nothing is lost if the popup closes.
- **Pop-out window** — Detach the extension into its own window for side-by-side testing.

## CSV Format

R3 uses a simple 4-column CSV schema:

```
Action,Target (Selector),Value (Input Data),Description (Optional)
OPEN,,https://example.com,Open the site
WAIT,,2000,Wait for page load
TYPE,[data-testid='fname'],John,Enter first name
CLICK,#submit-btn,,Click submit
```

### Supported Actions

| Action | Description |
|--------|-------------|
| `OPEN` | Navigate to a URL |
| `CLICK` | Click an element |
| `DBLCLICK` | Double-click an element |
| `RIGHTCLICK` | Right-click (context menu) |
| `TYPE` | Set a field's value (final value) |
| `TYPE_CHAR` | Type character-by-character (for autocomplete fields) |
| `CLEAR` | Clear a field |
| `SELECT` | Select a dropdown option |
| `CHECK` | Check a checkbox or radio button |
| `UNCHECK` | Uncheck a checkbox |
| `PRESS` | Press a key (Enter, Tab, Escape) |
| `WAIT` | Wait for a duration (ms) or for an element to appear |
| `ASSERT_EXISTS` | Verify an element exists on the page |

## Installation

### From source (Developer mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/git-Laks/R3.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `R3-extension` folder

### From Chrome Web Store

*Coming soon.*

## Quick Start

1. Navigate to the web app you want to test
2. Click the R3 extension icon in your toolbar
3. Click **Start Recording**
4. Interact with your app normally — clicks, typing, dropdowns, etc.
5. Click **Stop Recording**
6. Click **Export CSV** to save your test
7. To replay: **Import CSV** (or use the current recording) and click **Play Recording**

## Architecture

```
R3-extension/
  manifest.json          # Chrome Manifest V3 config
  background/
    service-worker.js    # Message relay, tab management, navigation handling
  content/
    recorder.js          # Captures user interactions, generates selectors
    player.js            # Replays steps with polling and synthetic events
  popup/
    popup.html/css/js    # Extension UI
  utils/
    selectors.js         # Selector generation with priority hierarchy
  icons/
    logo.png             # Extension logo
    icon16/48/128.png    # Toolbar and store icons
```

## Tested On

- [x] Angular (AngularJS 1.x and Angular 2+)
- [ ] React *(planned)*
- [ ] Vue *(planned)*
- [ ] Vanilla JS / static sites

## Compatibility

- **Chrome 105+** (uses the `checkVisibility()` API)
- **Manifest V3**
- Same-origin iframes supported; cross-origin iframes are skipped (browser security)

## Contributing

Issues and pull requests are welcome! If you find a bug or have a feature request, please [open an issue](../../issues).

### Development

1. Load the extension in developer mode (see Installation)
2. Make changes to the source files
3. Click the reload button on `chrome://extensions` to pick up changes
4. Open the service worker console from the extensions page for background script logs
5. Open DevTools on the test page for content script logs (`[R3]` prefix)

## License

This project is licensed under the [MIT License](LICENSE) — you are free to use, modify, and distribute it, with attribution to the original author.

## Roadmap

- [ ] Chrome Web Store listing
- [ ] React and Vue testing
- [ ] Variable support (e.g., `{{timestamp}}` for dynamic data)
- [ ] Assertion steps (verify text content, element state)
- [ ] Cloud sync (Google Drive / OneDrive)
