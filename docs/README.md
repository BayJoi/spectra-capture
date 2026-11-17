# Documentation index

Start at the [project README](../README.md). These documents go deeper.

| Document | Purpose |
| --- | --- |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Supported Chromium browsers, capture modes and limits. |
| [SECURITY.md](SECURITY.md) | Permissions, trust boundaries, mitigations and residual risks. |
| [TESTING.md](TESTING.md) | Commands, what actually ran, tooling constraints and untested areas. |
| [DESIGN.md](DESIGN.md) | Palette, typography, custom controls, pages, motion and accessibility. |
| [RESEARCH.md](RESEARCH.md) | Dated research with sources behind the API, interactive-capture, font and design decisions. |
| [MAINTENANCE.md](MAINTENANCE.md) | Checklist to keep code, tests, screenshots and docs in sync on every change. |

## Visuals

| Screen | File |
| --- | --- |
| Size page | [popup-size.png](screenshots/popup-size.png) |
| Output page | [popup-output.png](screenshots/popup-output.png) |
| Console page | [popup-console.png](screenshots/popup-console.png) |
| Dark theme | [popup-dark.png](screenshots/popup-dark.png) |
| Guide hero | [guide-hero.png](screenshots/guide-hero.png) |
| Guide sections | [guide-sections.png](screenshots/guide-sections.png) |
| Area selection | [area-selection.png](screenshots/area-selection.png) |
| Element selection | [element-selection.png](screenshots/element-selection.png) |

| Detail crop | File |
| --- | --- |
| Size fields | [size-controls.png](screenshots/size-controls.png) |
| Viewfinder | [viewfinder.png](screenshots/viewfinder.png) |
| Aspect ratio | [ratio-dropdown.png](screenshots/ratio-dropdown.png) |
| Output controls | [output-controls.png](screenshots/output-controls.png) |
| Receipt | [receipt.png](screenshots/receipt.png) |
| Options checkboxes | [options-checkboxes.png](screenshots/options-checkboxes.png) |
| Console tools | [console-tools.png](screenshots/console-tools.png) |
| Capture button | [capture-button.png](screenshots/capture-button.png) |
| Light theme switch | [theme-switch.png](screenshots/theme-switch.png) |
| Dark theme switch | [theme-switch-dark.png](screenshots/theme-switch-dark.png) |

Screenshots are generated from the real built extension with `bun run screenshots:pw`. Control
crops are captured at 3× device resolution with padding so they stay sharp and uncropped when the
guide displays them larger; full popup and guide views use CSS/1× resolution to keep file sizes
small.

## Legal

Project licence: [Apache 2.0](../LICENSE) with [NOTICE](../NOTICE).
Third-party components, font licence and inspiration credits:
[licenses/THIRD_PARTY_LICENSES.txt](../licenses/THIRD_PARTY_LICENSES.txt).
Font details: [assets/fonts/README.md](../assets/fonts/README.md).

All source code was written by AI assistants; see [Made with AI](../README.md#made-with-ai).

All test and development tooling lives in [`development/tests/`](../development/tests/), not in the shipped extension.
