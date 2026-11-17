# Testing (version 0.7.1)

This file records what was run, what passed, and what was **not** run. A test is only called passing when it actually ran.

## 0.7.1 — older test folders refreshed

- `development/tests/integration/README.md` was a v0.4.0 manual checklist: it referenced a DARK
  button and an "Advanced" section that no longer exist, skipped step 8, and described a multi-browser
  matrix. It is updated to 0.7.1, Chromium-only, and covers the four capture modes, the Monitor
  preset, all seven Settings switches, the picker visuals, the picker-timeout default and the theme
  switch.
- Fixed a real bug in `development/tests/e2e/ui-snapshots.ts`: the console-open scenario clicked a
  non-existent `#console-toggle`; it now clicks tab 4. The fixture docs use the current "Scroll for
  lazy images" label, and the raw-CDP double matches the `CdpTransport` signature.

## 0.7.1 — active tab highlight

- The popup Playwright suite checks that the selected page-tab card has its own `--tab-active`
  background token (distinct from the generic selection tint), and that the active tab's computed
  background differs from an inactive tab in both light and dark themes. Earlier seal-shadow edits
  were reverted — the reported problem was the tab card highlight, not the number badge.
- A regression check also confirms no `[data-magnetic]` elements remain; the fractional-pixel
  pointer transform that blurred labels on hover was removed.

## 0.7.1 — security review and code sweep

- A focused, source-first security review found no exploitable trust-boundary violation: no web page
  can send runtime messages (no `externally_connectable`), all CDP expressions interpolate only
  allow-listed theme/booleans, object construction is explicit-field (pollution-safe at the boundary),
  and there are no DOM-injection sinks. Applied its hardening notes anyway: countdown seconds are
  allow-listed at the interpolation point, target tab ids must be non-negative integers, stored
  filenames are re-sanitized before download.
- Code sweep fixes with tests: tile height now derives from density so 2×/3× full pages stay under the
  16k device-pixel cap; Element picks ignore non-primary clicks; inherited/polluted prototype
  properties cannot enter prefs; the saved-size dropdown label refreshes; picker cleanup runs at the
  start of every capture and during worker recovery; and the picker promise is always settled so a
  forced cleanup cannot hang the capture. The unreachable native-picker path and unused strings were
  removed.

## 0.7.1 — continuous overlay motion, fades and picker timeout

- The overlay now runs two infinite, lightweight animations while picking: one smooth opacity pulse
  shared by all four corner brackets (two-keyframe alternate ease, no stepped stops) and a small
  accent square tracing the whole selection perimeter. The picker Playwright suite samples computed
  styles 260 ms apart in a real browser and asserts the runner has moved and the bracket opacity has
  changed — proving the loops are live, not merely registered.
- Overlay and Element highlight fade in (0.22 s / 0.18 s); a successful pick plays a settle and fades
  out before the overlay is removed. The suite asserts the Element box has an `opacity` transition,
  reaches opacity 1 over a target and returns to 0 when the pointer is over empty space.
- `pickTimeout` defaults off: `pickRegion` receives a 24 h CDP ceiling rather than 60 s, and the
  `withTimeout` wrapper uses the same value, so the pick waits for the user. Unit tests cover the
  new `Prefs`/`CaptureOptions` field and its default.
- The Tools screenshot filenames were renamed to `popup-settings*`/`settings-list*`; all guide links,
  the generator and the docs index were updated, and the overlay screenshots were regenerated.

## 0.7.1 — picker performance and soft motion

- Research into the reported stutter pointed at paint-heavy work: a full-viewport `inset 0 0 0 9999px`
  shadow, a continuously animated `box-shadow`, and unthrottled geometry writes on every
  `pointermove`. The veil is now a single translucent background, box-shadows are static, motion is
  `opacity`-only, and both pickers batch pointer work into one `requestAnimationFrame` per frame.
- The picker Playwright suite guards this: it asserts the veil has no inset shadow and a plain
  translucent background, that no animation has a `boxShadow` keyframe, and that only bracket
  opacity pulses run with motion on.
- The element bounce was softened: the 0.28s geometry transition has no overshoot, the scale stretch
  was removed, and the settle is a brief opacity flash on a dedicated layer. The test asserts the
  transition duration, the presence of the opacity flash, and the absence of any `transform`
  keyframe on the highlight box. Research references: Motion's transform/opacity guidance and
  React Bits' magnet/settle patterns (inspiration only — no third-party code used).

## 0.7.1 — themed, animated picker overlays

- Unit tests cover the `CaptureOptions` fields: `theme` is allow-listed to `light`/`dark` (anything
  else falls back to light) and `overlayMotion` — now derived from the main Motion switch rather
  than a separate pref — defaults on.
- The picker Playwright suite now checks in a real browser that the Area box has the hard offset
  shadow and vermilion/ink palette of the current theme, that four corner brackets plus the shadow
  animate with motion on, that with motion off there are zero animations but the hard shadow and the
  dark-theme palette remain, and that the Element box carries a `left/width` morph transition.
- It also verifies the **target switch**: moving from a big element to a small one shrinks the box,
  a transform-based settle animation plays, and a click still resolves the element underneath.
- The tab is now labelled **Settings**; the `ui.tabTools` i18n key was kept so the UI-rules test still
  guards the fourth tab's wiring.

## 0.7.1 — guide spacing

- The note below the Area/Element screenshots was flush against the image frames because `.shot-grid`
  had only a top margin. Added a matching bottom margin; a real-browser measurement confirmed a 16px
  gap between the screenshot row and the note, and the guide screenshots were regenerated.

## 0.7.1 — picker cleanup / text selection

- **Root cause:** the area picker's capture-phase `pointerdown` handler calls `preventDefault()`.
  On a successful pick it removed only the `pointermove`/`pointerup` listeners, leaving `pointerdown`
  attached for the life of the document — so later clicks (and therefore text selection) were
  suppressed until the page was reloaded. The element picker and CDP emulation were not at fault.
- **Fix:** the picker's `clear()` now removes all four window listeners on both success and Escape,
  and publishes a release hook that `clearPickerArtifacts()` calls so a timed-out pick is cleaned up
  too. No `user-select` stylesheet was ever injected, so none is needed.
- **`bun run e2e:pw:picker`** (new Playwright suite) asserts in a real browser that a synthetic
  `pointerdown` is no longer cancelled after an area or element pick, that the overlay is gone, that
  a text drag selects text on the *same, unrefreshed* page, and that the forced cleanup expression
  removes listeners from a still-active picker.

## 0.7.1 — screenshots in the built extension

- `bun run screenshots:pw` now copies the regenerated images into `dist/screenshots/` as well, so the
  loaded extension's help page shows the current Tools screenshot. Verified by matching file hashes
  between `docs/screenshots/` and `dist/screenshots/`.

## 0.7.1 — save notification toggle

- Unit tests exercise `notifySaved()` directly with a stubbed Chrome API: it creates no notification
  when the stored `notifications` preference is false, creates one when true, and keeps the default
  (on) if the preference read fails. `sanitizePrefs()` defaults the preference to true and honours an
  explicit false.
- A real-browser check confirmed the new Tools checkbox is on by default and that unchecking it
  persists `notifications: false` to `chrome.storage.local`. The popup Playwright suite asserts the
  control exists and starts enabled; screenshots for the Settings tab were regenerated.

## 0.7.1 — monitor resolution preset

- Unit tests cover `monitorPreset()`: common resolutions map to a 1× preset inside the pixel limits,
  out-of-range or non-integer screen sizes return `null` (never silently clamped), and the dynamic
  entry is not part of the static `ALL_PRESETS` set.
- A real-browser check loaded the built popup: a "Display" group with `Monitor · W × H @1×` appeared,
  and selecting it set width/height to the detected `window.screen` size. The popup Playwright suite
  now asserts this on every run.

## 0.7.1 — theme transition

- Theme switches apply instantly. A View Transition circular reveal and a CSS colour fade were both
  tried and removed: the reveal's rasterised snapshots flickered the tab bar, numbers and popup, and
  fading `background-color` flashed light → dark on every popup open because the saved theme is
  applied asynchronously. Only the switch thumb's tab-indicator slide remains.

## 0.7.1 — theme-switch motion

- The theme switch uses the same sliding highlight as the page-tab indicator in the popup, guide and editor.
  The thumb's computed transition (`transform`, 0.45s, `cubic-bezier(.2, .8, .2, 1)`) matches the tab
  indicator exactly. A frame-by-frame sample confirmed the slide is visible.

## 0.7.1 — viewfinder readout

- The Size viewfinder was reported with two long strings overlapping in its 18px readout. Full-page
  mode now shows only the short width in the viewfinder, with the height note in a one-line hint
  below; a cancelled count-up prevents stale values. Verified visually with a real-browser capture
  of the popup in full-page mode.

## 0.7.1 — density persistence and picker docs

- **DPR persistence** was reported: choosing 3× then switching modes lost the choice. Cause:
  `renderDensity()` mutated `prefs` when clamping the displayed density. Fixed by tracking the
  chosen density separately so it is restored whenever the current size/mode allows it. Verified in
  a real browser with a mode-switch diagnostic.
- **Guide screenshots** for Area and Element capture are generated by running the actual overlay
  expressions on a real page during `bun run screenshots:pw`, so they show the genuine picker UI.
- **Playwright popup test** now checks the four modes and the fourth Settings tab.

## 0.7.1 — picker accuracy and UI polish

- **Area selection** was reported as sometimes capturing the wrong region. Root cause: the native
  `Overlay.screenshotRequested.viewport` is already a document-relative clip, but the code added a
  scroll offset, shifting picks on scrolled pages. Now used directly, with a unit-test regression.
- **Highlight/cursor leftovers** were reported: Chrome's native highlight was baked into element
  captures and the crosshair cursor stayed after picking. The picker now clears CDP highlight +
  inspect mode and any injected overlay nodes before capture, restores the page cursor, and waits a
  frame for the compositor.
- **Settings tab** text and spacing were trimmed to match the other tabs; screenshots regenerated.
- **Banner** updated to v0.7.1 with the four-mode tagline.

## 0.7.1 — capture modes and tools

- **New CDP modules** for interactive selection (`region-picker.ts`), page effects (`effects.ts`),
  tiled stitching (`tiled-capture.ts`) and region capture. Unit tests cover the new option fields,
  delay/region validation, the four-tab popup and the four capture modes.
- **Playwright** verifies the Settings tab, its seven switches and the presence of all four
  capture modes; the guide test now checks 11 framed sections and 15 screenshot references.
- **Screenshots** regenerated from the real build, including `popup-settings.png`,
  `popup-settings-bottom.png` and `settings-list.png`.
- **Not verified in this environment:** a real Area/Element pick in a browser (the CDP picker path
  is covered by source research and the fixed-expression fallback by code review), the clipboard
  write and the annotation editor end-to-end, and tiled stitching on an actual very tall page. These
  need a manual pass in Chromium.

## 0.7.1 — tab detection and size gating

- **`RESTRICTED_URL` on a normal https page** was reproduced by the reporter. Cause: without the
  `tabs` permission, Chrome returns `undefined` for `tab.url` on tabs outside the current
  `activeTab` grant, and the popup cached the tab at open time. Fixed by requesting `tabs`,
  resolving the tab freshly on every capture, and skipping extension pages. Verified in a real
  Chromium run: the job now advances past the URL check to the debugger stage with the shipped
  manifest and no test-only permission grant.
- **Impossible full-page sizes** (e.g. 6K at 2× ≈ 245 MP) could be selected and were only refused
  at capture time. Fixed by checking total pixels against a realistic full-page height estimate in
  `allowedDprs()` and `validateRequest()`, clamping a saved density that is no longer allowed, and
  showing the estimated dimensions in the OUTPUT receipt. Regression tests added.
- **Verified:** typecheck clean; **144 unit tests pass**; build and manifest validation pass; all
  three Playwright suites pass.

## Commands

```sh
bun run build:user     # default user build: build + validation, NO dependencies needed
bun run build          # same build step (alias)
bun install            # developer only: installs TypeScript, types and Playwright
bun run typecheck      # strict TypeScript check, including noUnusedLocals/Parameters
bun test               # unit tests
bun run build          # build plus manifest/CSP validation
bun run check          # typecheck + unit tests + build
bun run build:dev      # full developer gate: check + validation + Playwright + screenshots
bun run e2e            # raw-CDP browser tests (needs a local Chromium build)
bun run e2e:pw         # Playwright: popup UI + font + ARIA + message flow
bun run e2e:pw:popup   # Playwright: real extension message flow
bun run e2e:pw:guide   # Playwright: guide images, framed cards, reveal, theme
bun run e2e:pw:picker  # Playwright: picker cleanup, motion and selection
bun run screenshots:pw # regenerates docs/screenshots from the real build
```

## What ran and passed

- **Typecheck:** passed with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals` and `noUnusedParameters`.
- **Unit tests:** all pass. They cover validation, dimensions, ratios, filenames, settings, presets, cleanup, image headers, job storage, protocol flow and UI rules.
- **Build:** passed `scripts/validate.ts` for the MV3 output in `dist/`.
- **Playwright popup test:** passed. It loaded the real extension in Chromium, opened the real popup, and verified the font, controls, custom button layer, live regions, tab switching and dropdown ARIA.
- **Playwright message-flow test:** passed. The popup's `START_CAPTURE` (now carrying the resolved target tab) reached the real service worker, a job record was created and reached a terminal state, console entries and the badge were written back, and an assertion guards against a `RESTRICTED_URL` regression.
- **Playwright guide test:** passed. Five quick-start steps, nine framed cards, thirteen cropped section screenshots loading successfully, no in-view element left hidden after scrolling, the theme toggle working, and the brand artwork swapping to its dark variant.
- **Screenshot generation:** passed. Sixteen images are produced from the real extension: control crops at 3× device resolution with padding, and full popup/guide views at CSS resolution. The guide embeds thirteen of them.
- **Source security audit:** one confirmed medium finding (MV3 worker unload) was fixed; all other reviewed surfaces were explicitly rejected as non-findings. See `SECURITY.md`.
- **Manifest validation:** the project's own `scripts/validate.ts` passes; it enforces the Chromium MV3 manifest shape, permissions, CSP and asset references.

## Known tooling constraint

Playwright drives Chromium over CDP, so `chrome.debugger` cannot also attach to a page in the same browser. A real debugger-based screenshot cannot be exercised in that context; the message-flow test verifies the extension wiring instead. The screenshot pipeline itself is covered by `development/tests/e2e/protocol.e2e.ts`, which launches a separate browser with a raw CDP socket and exercises `runCapture()` directly.

## Not run in this work

- `bun run e2e` — the raw-CDP browser tests need a local headless Chromium build, which was not available in this environment. No pass claim is made for tests that did not run.
- Captures on real pages at the stated pixel limits. The 16,384 px side and 100 MP total remain provisional until measured on real hardware.
- Screen readers and Windows/macOS text rendering. The Playwright checks are programmatic, not a manual VoiceOver or NVDA pass.

## Font verification

The bundled WOFF2 was decompressed and its name record read directly: `Inter-RegularVersion 4.001`. The Playwright popup test then confirmed the browser actually loads and uses it. The CSS declares a system sans-serif fallback.
