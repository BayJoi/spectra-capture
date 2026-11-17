# Security and privacy (version 0.7.1)

## Summary

- The `debugger` permission can inspect and control a page. Treat this extension as sensitive.
- The debugger is attached only after a capture button press, to one explicit tab, and detached before the file is saved.
- The extension sends nothing over the network. No remote font, script, image or style is loaded.
- No install-time all-sites access, cookies, web requests, native messaging or debugging port.
- A source-first audit found one concrete boundary defect (an MV3 worker-unload case), now fixed; the other reviewed surfaces were not findings. Details below.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Identifies the tab and grants one-shot access after a user gesture. |
| `debugger` | Sets the viewport and takes the picture. |
| `offscreen` | Creates a temporary blob URL for the download. |
| `downloads` | Saves the picture and reports failures. We never request `downloads.open`. |
| `storage` | Settings (local) and the job/console record (session). |
| `notifications` | Best-effort confirmation that a screenshot was saved. The permission stays declared, but the notification is only shown when the user leaves "Save notifications" on in the Settings tab; the worker reads that preference before creating it. |
| `tabs` | Reads each tab's URL/title/favicon metadata so the target page can be identified reliably. No page content. |
| `clipboardWrite` | Lets the copy page write the captured PNG to the system clipboard. |

## Trust boundaries

| Boundary | Control |
| --- | --- |
| Web page → extension | None. Pages cannot send extension messages or read extension state. No `externally_connectable`, no content scripts. |
| Popup → worker | Only `START_CAPTURE` is accepted; all options are re-validated in the worker. |
| Worker → offscreen | Only messages with `target: "offscreen"` are handled; only extension contexts can send them. |
| Page content → logs | Only fixed messages and numbers are logged. Raw browser error text is never shown because it may contain a URL. |
| Page content → file name | Built only from validated integers, fixed enums and a timestamp; title and URL are never used. |
| Storage → settings | Preferences are rebuilt field by field; unknown keys are dropped. |
| Page → extension (region picker) | The injected overlay and bindings use fixed expression strings; page-derived geometry is validated as four finite numbers and a positive area, then re-gated in the worker. |
| Page → extension (effects) | Countdown, sticky-hiding and overlay code are compile-time constants; no page string is ever interpolated into an evaluated expression. |

## Threats and mitigations

- **A web page starts a capture.** It cannot — only the popup can send a start message.
- **Taking over someone else's debugger.** `DebuggerSession.attach()` refuses a tab that already reports an attached debugger and never force-detaches another client.
- **Detaching someone else's session.** We detach only sessions we attached ourselves; a browser detach clears the recorded tab.
- **Navigation during capture.** `watchTabNavigation()` flags a new `loading` status and the job is discarded rather than saved against the wrong page.
- **Worker restart mid-job (audit finding F1, medium, fixed).** MV3 service workers can unload mid-capture. The job records the attached tab; on the next wake `recover()` detaches the debugger for the recorded tab and marks the job `INTERRUPTED`.
- **Oversized output.** `assessOutput()` gates before viewport work and after full-page or region measurement; >40 MP needs confirmation, >100 MP is refused. Very tall pages are captured as bounded slices and stitched locally instead of relying on one compositor capture.
- **Interactive selection.** The picker is a fixed-expression overlay injected through the existing CDP session. It uses `pointer-events:none` so it cannot intercept page input, restores the cursor, and removes itself before capture — including all window listeners (the area picker's `pointerdown` handler cancels the default action, so leaving it attached would suppress text selection until refresh). A fresh debugger session takes the final image, so no CDP highlight or overlay animation can be baked in. The user can cancel with Escape; the job is cleaned up and no file is written. The only values interpolated into the expression are the validated theme (`light`/`dark`) and booleans from the user's own settings; no page data is ever read into it.
- **Page effects are temporary.** Dark-mode and sticky-element changes are undone in the cleanup stack, and restored after an event-page restart via the recorded job. A capture never leaves the page altered.
- **Corrupt or empty image.** PNG/JPEG headers are parsed and dimensions compared with the expected size (0.2% tolerance) before saving.
- **Path traversal in filenames.** `sanitizeFilenamePart()` keeps only `[A-Za-z0-9_-]`.
- **Enterprise restrictions.** Chrome 155–158 attach-time debugger policy checks were rolled back in November 2026; the extension classifies either state into stable error codes without logging raw browser messages.

## Source audit results

A source-first review of `src/`, the build scripts and the manifest produced one finding and a set of explicitly rejected candidates.

| Surface | Result |
| --- | --- |
| MV3 worker unload (F1) | **Confirmed, fixed.** See above. |
| `Runtime.evaluate` | Rejected: all expressions are hardcoded, no page or message data is interpolated; results are re-gated. |
| Filename sanitisation | Rejected: validated integers/enums only, whitelist filter; no separators or traversal. |
| Storage sanitisation | Rejected: unknown keys dropped, fields strictly re-validated; per-extension storage is not page-writable. |
| Popup→worker / worker→offscreen messages | Rejected: same-extension senders only, options re-validated, chunk size capped. |
| Blob URL lifecycle | Rejected: extension-origin-scoped URLs, revoked in `finally`, offscreen document closed. |
| Build validation | Not a security boundary (source/manifest are trusted inputs), but kept as defence in depth. |

## Browser vulnerability research (2025–2026)

Sources and dates are in `RESEARCH.md`, section 9. The issues that matter for this design:

- **CDP sits below the origin model.** A `debugger` attachment can reach `Runtime.evaluate`, network bodies and HttpOnly cookies. **Mitigation here:** attach only to one explicit active tab, refuse already-attached tabs, watch navigation, detach in `finally` and on recovery. We never intercept network or evaluate page-derived expressions.
- **Blob/data URL download pitfalls.** Huge data URLs can destabilise the browser and blob URLs are document-scoped. **Mitigation:** a small offscreen document with reason `BLOBS`; every URL is revoked in `finally`.
- **Malicious screenshot extensions in the wild (2025–2026).** GitLab-injected extensions, a fake "Chrome MCP Server" with `debugger`/broad host permissions/WebSocket C2, and "BragJack" CVE-2026-0628/55945 show that screenshot + network combinations are a real abuse class. **Mitigation:** this project has no remote code, no WebSocket, no telemetry and no network requests at all.

## Residual risks

- The debugging banner is unavoidable on every capture and cannot be hidden.
- `debugger` is powerful by design; install only from a source you trust.
- Blob URL → `chrome.downloads` across extension contexts is reliable in Chromium; that path is exercised in development tests.
- Screenshots can contain private data. The extension neither encrypts nor deletes saved files.

## Planned hardening (not yet implemented)

- Keep the service worker alive for the whole job with a `runtime.connect` port, so an unload mid-capture is exceptional rather than routine. Recovery is in place regardless.
- Offer an `activeTab`-only capture mode for users who do not need viewport emulation, removing the `debugger` permission entirely.
- Run an automated accessibility audit (axe/Lighthouse) in CI alongside the existing Playwright tests.
- Exercise the interactive Area/Element pickers and the annotation editor in a real browser as part of the automated suite.

## Test browser note

`development/tests/e2e` launches its own headless Chromium with a debugging port; `development/tests/playwright` loads the real unpacked extension in Playwright's Chromium. Neither is part of the shipped extension, and neither contacts a remote service.
