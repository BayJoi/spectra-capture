# Manual browser steps (version 0.7.1)

The automated Playwright tests load the real unpacked extension in Chromium, but a human pass is
still useful for devices and visual checks. Install the extension first (see INSTALL.txt). Then do
these steps in each Chromium-based browser you want to record. This project is Chromium Manifest V3
only — there is no Firefox or MV2 build. Record results in `docs/TESTING.md`, not in
`docs/COMPATIBILITY.md` (that file describes supported features, not test results).

## Setup

1. Serve the fixture pages from the `development/tests/fixtures` folder:

       cd development/tests/fixtures
       python3 -m http.server 8765 --bind 127.0.0.1

2. Open `http://127.0.0.1:8765/normal-page.html` in the browser.

## Steps

1. **Basic size.** Set 1440 × 900, pixel density 1×, Visible, PNG. Press Capture. Expect a file
   named `spectra-capture_1440x900_dpr1_viewport_....png`. Open it. Expect 1440 × 900 pixels.
2. **Density.** Density 2×. Expect 2880 × 1800 pixels.
3. **Monitor preset.** Open the preset list. Under the Display group, choose Monitor. Expect the
   width and height to become your screen's resolution at 1×, and the density controls to keep working.
4. **Full page.** Open `long-page.html`. 1440 × 900, Full page, 1×. Expect 1440 × 12000 pixels.
5. **Dropdowns.** Open the preset list and scroll it with the mouse wheel. Expect it to stay open.
   Open the ratio list when its chosen item is at the bottom. Expect it to open and stay open.
6. **Swap.** Press the swap button. Expect the width and height to change places.
7. **Busy debugger.** Open DevTools on the same tab. Press Capture. Expect a message that another
   debugger is open.
8. **Browser page.** Open a `chrome://` page and press Capture. Expect the message that the page
   cannot be captured.
9. **Capture modes.** On the Output page (tab 2), try Visible, Full page, Area and Element. Area and
   Element show a picker with corner brackets and a small square that travels around the perimeter;
   press Escape to cancel. There is no text-selection mode. The picker waits indefinitely by default;
   tick "Picker timeout" on the Settings tab to end it after 60 seconds.
10. **Settings tab.** On tab 3 (Settings), check all seven switches: delay, dark mode for capture,
    hide sticky elements, Save As, copy to clipboard, annotate and save notifications (on by
    default). Tick "Picker timeout" and confirm an Area pick ends after 60 seconds.
11. **Theme, motion and dark capture.** Use the theme switch in the header to change the popup between
    light and dark. On the Output page, turn off "Motion effects" and check that the picker brackets
    and runner become still. On the Settings tab, tick "Dark mode for capture" to capture the site's
    dark colour scheme; "Save notifications" is on by default and can be turned off here.

Write down the browser name and version, the Chromium version, the operating system, and the result
of each step. Write the saved file's width and height too. A step that was not run stays "not run".
