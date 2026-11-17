# Build

The extension is produced from one source tree with Bun. The capture pipeline, validation, image checks, file naming, download flow, i18n and UI are all in shared source; there is a single target.

## Commands

| Command | Output | Description |
| --- | --- | --- |
| `bun run build` | `dist/` | Builds and validates the extension |
| `bun run check` | `dist/` | Typecheck, unit tests and build |

`bun run validate` re-validates `dist/` against the manifest and CSP rules.

## Target details

### Chromium MV3 — `dist/`

- Manifest V3, ES-module service worker (`service-worker.js`).
- `chrome.debugger` sets `Emulation.setDeviceMetricsOverride` and takes the screenshot.
- `chrome.offscreen` creates a temporary blob URL for `chrome.downloads`.
- Job record and console live in `chrome.storage.session`.
- Four capture modes: `viewport`, `fullpage`, `region` and `element`. The interactive modes use a
  fixed-expression injected overlay (the native CDP inspector highlight leaks into captures), close
  the popup, then detach and re-attach the debugger for a clean final capture.
- Optional capture effects: `Emulation.setEmulatedMedia` (dark), injected style for sticky elements,
  and an in-page countdown. Tall pages are captured in tiles and stitched with `OffscreenCanvas`.
- `copy.html` writes a PNG to the clipboard; `annotate.html` is a canvas editor. Both are opened in
  a focused tab with the image passed through `chrome.storage.session`.
- Permissions: `activeTab`, `debugger`, `downloads`, `offscreen`, `storage`, `notifications`, `tabs`,
  `clipboardWrite`.
- Minimum Chromium 116 (manifest baseline).

## Validation

`scripts/validate.ts` rejects extra permissions, host or content-script access, a loose CSP, inline scripts/handlers, `eval`/`new Function`, remote URL strings in executable code, and manifest references to missing files. It also requires a service worker, an `action` with a popup and an object-form CSP under `extension_pages`.
