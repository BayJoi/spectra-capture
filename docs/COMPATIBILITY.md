# Compatibility

Spectra Capture is a Chromium Manifest V3 extension. Facts checked in November 2026; sources are in [RESEARCH.md](RESEARCH.md).

## Supported browsers

| Browser | Status |
| --- | --- |
| Chrome 116+ | Designed for it; not measured on this machine. |
| Edge, Brave, Vivaldi, Opera, Helium | Chromium-based; expected to work. Helium was reported working by the project owner, not measured here. |

The MV3 build needs `chrome.debugger` (Chromium 96+) and `chrome.offscreen` (Chromium 109+); the manifest baseline is 116. Flat debugger sessions need 125+. The Area/Element pickers use `Overlay.setInspectMode`, which is available in Chromium 116+; older versions fall back to the injected overlay. Clipboard copy needs Chrome 116+ with `clipboardWrite`.

Enterprise policies can block debugging or screenshots. Chrome 155–158 shipped stricter attach-time debugger checks, but Google **rolled them back on 3–4 November 2026**: they are off by default in 158/159 and remain a server-side config for 155–157. The extension classifies either state into stable error codes and reports them in the Console rather than showing raw browser text.

## Supported pages

`isCapturableUrl()` accepts `http:` and `https:` URLs only. That includes local development servers (`localhost`, `127.0.0.1`, other loopback addresses), LAN addresses and local network services. It does not depend on a public DNS name or a TLS certificate.

Refused: `chrome://`, `edge://`, `about:`, the New Tab page, extension pages, web-store pages and `file://` URLs. The Console reports `RESTRICTED_URL` and nothing is attached or changed. The popup resolves the target tab freshly on every capture and passes it to the worker explicitly. The `tabs` permission keeps each tab's URL readable even when one of the extension's own pages is active.

## Capture modes

| Mode | How it works | Notes |
| --- | --- | --- |
| Visible | `Page.captureScreenshot` of the emulated viewport | Fastest; exact size. |
| Full page | Explicit document-relative clip; tiled and stitched for very tall pages | Sticky elements can be hidden from Settings. |
| Area | An injected drag overlay, then a fresh capture session | Press Escape to cancel. No extra permission. Themed highlight with optional motion. |
| Element | A fixed-expression `elementFromPoint` overlay, then a fresh capture session | Buttons/landmarks come from semantics; "cards" are a heuristic. The highlight morphs smoothly between targets. |
| Both | The popup closes while picking; the debugger re-attaches before the final capture | Keeps the popup out of the way and guarantees no highlight overlay is baked into the image. |

Dark-mode capture asks the site for `prefers-color-scheme: dark`; sites without a dark theme look unchanged. Selection temporarily extends the debugger session, so the debugging banner stays visible a little longer.

## Font

The same Inter 4.001 WOFF2 is bundled in the build. The popup looks the same on every operating system; if the bundled font cannot load, a system sans-serif is used instead. There is no font-check log entry.
