# Research log

Researched 14–16 November 2026. Claims below are tied to the sources read at that time; browser policies change, so re-check before relying on them later.

## 1. Manifest V3

| Finding | Source |
| --- | --- |
| MV3 extensions use a service worker, an `action` and an object-form CSP under `content_security_policy.extension_pages`. | [Chrome MV3 migration guide](https://developer.chrome.com/docs/extensions/develop/migrate) |

**Decision:** target Chromium Manifest V3, with a baseline of Chromium 116.

## 2. `chrome.debugger` and CDP

| Finding | Source |
| --- | --- |
| `chrome.debugger` exposes the CDP `Emulation` and `Page` domains. `Emulation.setDeviceMetricsOverride` sets an exact CSS viewport and device scale factor; `Page.captureScreenshot` takes the picture. | [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger), [CDP Page domain](https://chromedevtools.github.io/devtools-protocol/tot/Page/) |
| Flat debugger sessions (for out-of-process iframes) need Chrome 125+. | [Chrome debugger API](https://developer.chrome.com/docs/extensions/reference/api/debugger) |
| Chrome 155–158 shipped stricter attach-time enterprise restrictions, then **rolled them back on 3–4 November 2026**: off by default in 158/159, server-side config for 155–157. | [Chrome Developers blog](https://developer.chrome.com/blog/debugger-enterprise-policy-restrictions), 8 September 2026 + rollback note |
| CDP sits below the origin model; `debugger` can reach `Runtime.evaluate`, network bodies and HttpOnly cookies. | [IEEE EuroSP 2023](https://www.computer.org/csdl/proceedings-article/eurosp/2023/651200a832/1OFthOyAM7e), "Chrowned by an Extension" |

**Decision:** attach only on an explicit capture action, to one tab; refuse already-attached tabs; watch navigation; detach in `finally` and on recovery; never expose CDP to page-derived data.

## 3. `activeTab` and tab detection

| Finding | Source |
| --- | --- |
| `activeTab` shows no install warning and grants temporary access after a user gesture. Closing the popup does not end it; navigating to a new document does. | [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) |
| Reading sensitive `Tab` properties (`url`, `title`, `favIconUrl`) requires the `tabs` permission, host permissions, or an `activeTab` grant. Without it, `tab.url` is `undefined`. | [Chrome tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) |
| Chrome 153 changed `activeTab` URL scrubbing so restricted-page URLs are hidden even with `activeTab`; the `tabs` permission restores them. | [Chromium bug 496615345](https://issues.chromium.org/issues/496615345), [repro](https://github.com/mrcoles/test-chrome-activetab-url) |
| A service worker's `lastFocusedWindow` can drift to a DevTools window; the popup's `currentWindow` is authoritative. A popup is not a tab, so `sender.tab` is absent for its messages. | [Chrome windows API](https://developer.chrome.com/docs/extensions/reference/api/windows), [Chrome runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime) |

**Decision:** the manifest requests the `tabs` permission so every tab's URL stays readable; the popup resolves the target tab freshly on each CAPTURE press in its own `currentWindow` context (skipping extension pages) and passes `{id, url}` in `START_CAPTURE`; the worker trusts it instead of re-deriving it. This was verified in a real Chromium run where the job passed the URL check without a test-only permission grant.

## 4. Downloads and notifications

| Finding | Source |
| --- | --- |
| In Chrome, `downloads.download`'s `saveAs` flag is not the user's "Ask where to save" preference — `PromptForDownload` governs. | [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/downloads/), [Chromium issue 41133685](https://issues.chromium.org/issues/41133685) |
| Blob URLs created in an extension page work with `downloads.download`; revoke them only after completion. | [Chrome downloads API](https://developer.chrome.com/docs/extensions/reference/downloads/) |
| `chrome.notifications.create()` shows a system notification and needs the `notifications` permission. | [Chrome notifications API](https://developer.chrome.com/docs/extensions/reference/api/notifications) |

**Decision:** omit `saveAs` so the browser preference governs; use a best-effort system notification as save confirmation. The user can switch it off in the Settings tab: the service worker reads the `notifications` preference from local storage and skips `notifications.create()` when it is false. MV3 cannot drop a declared permission at runtime, so the manifest permission stays.

## 5. Typeface

Inter 4.001 (variable, Google Fonts "latin" subset) is the single bundled typeface: SIL OFL 1.1, excellent small-size legibility, one 48 KB file, and a neutral sans that suits the washi/ink palette. A browser check found a real bug: the UA stylesheet puts its own font on `<body>`, so `html` used Inter while every visible control used the system font. The font is now pinned on `html`, `body`, form controls and code-like elements with a cross-platform system fallback stack. See `assets/fonts/README.md`.

## 6. Design research

Japanese-inspired restrained palette — washi paper, sumi ink, one vermilion accent (shu), indigo for selection — with planned space (ma), small seal-like tabs, and a faint shoji lattice. Sharp edges come from neo-brutalist and Swiss UI writing: square corners, 2 px ink borders, hard offset shadows, and a press effect that sinks a control into its shadow. Sources read on 15 November 2026 (utsubo.com, neubrutalism.com, onething.design, superdesign.dev); these are design essays, not standards, and the choices are recorded in `DESIGN.md`.

## 7. Motion libraries

React Bits is a large open-source catalogue of animated React components. Its licence is **MIT + Commons Clause**: free for personal and commercial use in apps, but the components themselves may not be sold or redistributed. [Source](https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md)

**Decision:** take inspiration only. The motion layer in `src/ui/` is written from scratch in plain CSS/TypeScript (no React, no dependency), animates only compositor-friendly properties, and is gated by the existing motion/reduced-motion switches. No component source was copied.

## 8. Licence change to Apache 2.0

Apache 2.0 is permissive, adds an explicit patent grant, and has no copyleft. [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)

**Decision:** the copyright owner relicensed the original MIT work to Apache 2.0. `LICENSE` contains the full text, `NOTICE` carries the attribution, and `licenses/THIRD_PARTY_LICENSES.txt` records every dependency, the Inter font's OFL licence, and inspiration credits.

## 9. Browser security research (2025–2026)

| Finding | Source |
| --- | --- |
| CDP operates below the origin model; `debugger` can reach `Runtime.evaluate`, network bodies and HttpOnly cookies. | [IEEE EuroSP 2023](https://www.computer.org/csdl/proceedings-article/eurosp/2023/651200a832/1OFthOyAM7e) |
| Chromium bugs in 2026 showed host restrictions not enforced across navigation under `chrome.debugger`. | [Chromium 511779676](https://issues.chromium.org/issues/511779676), [482198458](https://issues.chromium.org/issues/482198458) |
| Blob URLs are document-scoped; very large data URLs can destabilise a browser. | [Chrome offscreen docs](https://developer.chrome.com/docs/extensions/reference/api/offscreen) |
| Real-world screenshot-extensions abuse: injected GitLab extensions, a fake "Chrome MCP Server", "BragJack" CVE-2026-0628/55945. | [Unit 42](https://unit42.paloaltonetworks.com/high-risk-gen-ai-browser-extensions), [CSA Labs](https://labs.cloudsecurityalliance.org/research/csa-research-note-bragjack-agentic-browser-monoculture-20260) |

**Decisions:** attach only on user action with explicit attach, navigation watch and detach/recovery; no remote code, network calls, WebSocket or broad host permissions; fixed expressions plus strict gating; documented audit finding F1 and its fix in `SECURITY.md`.

## 10. Keeping docs current

Every feature change must update code, tests, screenshots and docs in one commit, following [MAINTENANCE.md](MAINTENANCE.md). This prevents the stale claims that affected earlier versions.

## 11. Interactive capture and CDP tooling (0.7.1)

Three parallel research passes covered region capture, CDP element inspection, and MV3 UI constraints.

| Finding | Source |
| --- | --- |
| `Page.captureScreenshot.clip` is in CSS pixels relative to the document; `captureBeyondViewport:true` is required for arbitrary regions. `fromSurface:false` ignores `clip`. | [CDP Page](https://chromedevtools.github.io/devtools-protocol/tot/Page/), [Chromium 40760789](https://issues.chromium.org/40760789) |
| Chrome silently repeats the top of a page past ~16,384 px per side — bounded tiles plus local stitching are the accepted workaround. | [chrome-devtools-mcp #2952](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/2952), [Chromium 40724721](https://issues.chromium.org/issues/40724721) |
| `Overlay.setInspectMode({mode:"searchForNode"})` draws Chrome's own highlight and emits `Overlay.inspectNodeRequested`; `mode:"captureAreaScreenshot"` emits `Overlay.screenshotRequested` with a DIP viewport. A raw `chrome.debugger` client receives these events — DevTools UI is not required. | [Overlay.pdl](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/public/devtools_protocol/domains/Overlay.pdl?format=TEXT), [DevTools InspectElementModeController](https://cdn.jsdelivr.net/gh/ChromeDevTools/devtools-frontend@main/front_end/panels/elements/InspectElementModeController.ts), [StackOverflow extension example](https://stackoverflow.com/questions/53366462/highlight-current-dom-element-in-chrome-extension-using-debuggerapi) |
| `DOM.getBoxModel` quads are relative to the node's local viewport; a `Page.captureScreenshot` clip needs document coordinates (add `cssLayoutViewport.pageX/pageY`, zoom and OOPiF offsets). | [CDP DOM](https://chromedevtools.github.io/devtools-protocol/tot/DOM/), [Puppeteer ElementHandle](https://github.com/puppeteer/puppeteer/blob/main/src/cdp/ElementHandle.ts) |
| The accessibility tree has roles (`button`, `article`, `region`) but **no `card` role and no bounding box**; bridge `backendDOMNodeId` to `DOM.getBoxModel`. Card detection is a DOM/CSS heuristic. | [AX profile](https://recursiveai.org/onehtml/docs/accessibility-chromium-profile/), [CDP Accessibility](https://chromedevtools.github.io/devtools-protocol/tot/Accessibility/) |
| `Runtime.evaluate` with `awaitPromise:true` can await a fixed-expression overlay that resolves a rectangle; `Runtime.addBinding` provides a page→extension channel. Injecting a `<style>` tag can be blocked by page CSP, but direct `el.style.*` property assignment is not. | [CDP Runtime](https://chromedevtools.github.io/devtools-protocol/tot/Runtime/), [MDN style-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/style-src) |
| `clipboardWrite` enables `navigator.clipboard.write` in extension pages; offscreen documents cannot be focused, so a focused extension tab is the reliable path (Chrome 157+ allows service workers). | [MDN clipboard](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Interact_with_the_clipboard), [Chrome offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen) |
| `Emulation.setEmulatedMedia({features:[{name:"prefers-color-scheme",value:"dark"}]})` emulates a site's dark scheme; `setAutoDarkModeOverride` forces one. Both must be restored. | [CDP Emulation](https://chromedevtools.github.io/devtools-protocol/tot/Emulation/), [DevTools rendering](https://developer.chrome.com/docs/devtools/rendering/emulate-css) |
| An open-source MV3 extension (OpenScreenShot) ships region, element, delayed, annotated and clipboard captures with empty `host_permissions`, using the same fixed-expression overlay approach. | [OpenScreenShot README](https://raw.githubusercontent.com/PGHQdev/OpenScreenShot/main/README.md), [region-select.ts](https://raw.githubusercontent.com/PGHQdev/OpenScreenShot/main/src/content/region-select.ts) |

**Decision:** ship the native CDP picker with a fixed-expression fallback, keep all page evaluation in compile-time constant strings, validate region geometry in the worker, and keep every effect reversible through the existing cleanup stack. No host permissions or content scripts were added.

**Follow-up finding (real-browser reports):** `Overlay.screenshotRequested.viewport` is already a document-relative clip — DevTools passes it straight into `Page.captureScreenshot` — so adding a scroll offset shifts the capture. More importantly, Chrome's native inspector highlight is drawn on the compositor surface and appears in `Page.captureScreenshot` even after `Overlay.hideHighlight()`. Even a full detach/re-attach with the native path left the blue box in element captures. The shipped design therefore **disables the native picker** and always uses a fixed-expression injected overlay, which is removed from the DOM before capture. It uses `pointer-events:none` so `elementFromPoint` can see the page, restores the document cursor, and falls back to the raw element under the pointer so every pick returns something. The popup closes during picking, and a fresh re-attached debugger session takes the final image so no overlay can be baked in and all content is rendered. Verified with a real-browser Playwright diagnostic (drag rect, element hover/click, overlay removal, cursor restore).

## 9. Overlay motion and paint performance

| Finding | Source |
| --- | --- |
| Only `opacity` and `transform` can be animated without repainting every frame; animating `box-shadow` forces continuous paint and can stutter even a desktop. | [Tobias Ahlin — animating box-shadow](https://tobiasahlin.com/blog/how-to-animate-box-shadow), [SitePoint](https://www.sitepoint.com/css-box-shadow-animation-performance) |
| A large `inset` shadow is especially expensive; prefer a translucent background for a full-viewport veil. | [MDN box-shadow](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/box-shadow) |
| `pointermove` can fire far above the display refresh rate; batching reads/writes into one `requestAnimationFrame` avoids layout thrash. | [MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) |
| Modern UI motion favours soft, short, bounce-free easing and settle-style feedback (magnet/spotlight patterns) rather than overshoot springs. | [React Bits](https://reactbits.dev) (Magnet, Glare Hover, SpotlightCard), [Motion examples](https://motion.dev/examples) |

**Decision:** the Area veil is a single translucent background, box-shadows stay static, ambient and settle motion are opacity-only, and pointer work is rAF-batched. Continuous feedback comes from two loops — one smooth opacity pulse shared by all four brackets and one small accent square tracing the perimeter — with the overlay and Element highlight fading in and out. The Element highlight uses a 0.28s `cubic-bezier(.2,.8,.2,1)` geometry transition (no overshoot, no scale stretch) with an opacity flash on target change. React Bits and Motion were visual reference only — no third-party code is used. The picker timeout is user-controlled and off by default: picking waits for the user rather than expiring after 60 s.
