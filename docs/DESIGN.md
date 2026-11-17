# Design

Spectra Capture is a 380 × 600 CSS pixel popup (plus a guide page). This file records the visual
decisions and why they were made. The research behind them is in `RESEARCH.md`, sections 5 and 6.

## Look

Japanese-inspired restraint. Space is planned, not left over. Every page has a fixed height and a
measured fit, so the empty areas are deliberate. The palette is washi (paper) and sumi (ink).
Vermilion (shu) is the one warm accent — the active tab seal, the progress bar, the capture
button's shadow. Indigo (aizome) marks selection and focus only. A shoji-style lattice sits behind
the page at 4–5% opacity. Tabs are numbered like small seals.

Sharp edges. Every corner is square (`border-radius: 0`, enforced by a test). Controls have a 2 px
ink border and a hard offset shadow with no blur; a pressed control sinks into its shadow. There
are no gradients on controls. The only motion background is the calm shader in the header, which
is off when motion is off.

## Type

One bundled typeface: Inter 4.001, variable weight 100–900, in one WOFF2 file (48 KB, Latin
subset). Three weights are used: Light (300) for hints,
Medium (500) for body text, Bold (700) for emphasis such as the title and the capture button.
Uppercase labels use wide letter-spacing. A system sans-serif stack is the emergency fallback if
the bundled font cannot load. There is no font-check Console entry: the font is bundled and the
browser loads it silently. See `assets/fonts/README.md`.

Arrows and the swap icon are SVG because they sit outside the font's Latin subset. A unit test
checks every non-ASCII character in visible text against that subset.

## Controls

Every button is built on a native `<button>` — keyboard activation, focus, disabled state and
assistive-technology semantics come from the browser — and upgraded by the custom layer in
`src/ui/button.ts` (`ui-btn` classes, an icon slot and a press plate). If CSS fails, the native
button still works. There is one button language across the popup and the guide: primary,
ghost, icon, tab, toggle and dropdown variants.

## Pages

The four tabs are numbered like hanko seals; the active page's number is a vermilion seal. The
selected **tab card** carries its own `--tab-active` background wash — a clearly visible warm tint in
light mode and the established look in dark — so it reads as highlighted in both themes. The generic
selection tints were too pale in light mode. No transform is used on hover: fractional-pixel magnetic
tracking blurred labels, so it was removed from the motion layer entirely.

1. **Size** — preset, width and height with the swap button, aspect ratio, and a viewfinder. The
   preset list has a Display group with a dynamic **Monitor** entry (the screen resolution detected
   from `window.screen` on open, at 1×) alongside Devices, Resolutions and saved sizes. Because it is
   an ordinary `SizePreset`, selection, syncing, density gating and validation need no special cases.
   The viewfinder is a framed card with its own hard shadow and a clear gap above the footer separator,
   so it reads as a distinct preview rather than blending into the capture area.
2. **Output** — visible or full page, area or element, density, format, JPEG quality, a receipt with
   the exact output, and the settings buttons.
3. **Settings** — delay, dark mode for capture, hide sticky elements, Save As, clipboard copy,
   annotate, **Save notifications** and **Picker timeout**. All are the same styled `tool-row`
   checkboxes. Notifications are on by default and read in the worker; the timeout is off by default.
   Picker motion is derived from the main Motion switch (and reduced motion), with the current theme
   passed to the injected highlight so it matches the popup.
4. **Console** — every step and problem in plain words, with Copy and Clear. The number on its tab
   counts warnings and errors.

The capture button stays at the bottom of every page. Nothing is shown as a pop-up message;
problems go to the Console.

## Dropdowns

Each dropdown is a button and an animated list over a hidden native `<select>`, so the select keeps
the value. The list is a `listbox` linked by `aria-controls`, and the active option is exposed with
`aria-activedescendant`.

Mouse: a click opens or closes the list; a click on an item chooses it; clicking outside closes it;
wheel scrolling never closes it; hovering only highlights. Keyboard: arrows move, Home/End jump,
Enter or Space choose, Escape or Tab close; Arrow Down/Up opens a closed list. The list scrolls
only itself and follows its button on resize or scroll.

## Motion

Motion is short, purposeful and layered. The base layer slides pages, flashes the viewfinder when
the ratio changes, deals dropdown options in sequence and resolves the status line from random
characters. The extra layer in `src/ui/motion-extra.ts` adds spotlight cards,
staggered section reveals, a hero entrance, a scanning viewfinder line, breathing corner marks, a
shimmering progress bar and reading bar, a stamp on the active tab seal, a soft focus pulse and a
subtle parallax on the guide mascot. The LIGHT/DARK switch deliberately reuses the page-tab
indicator's motion: the highlight thumb glides across with the same 0.45s
`cubic-bezier(.2, .8, .2, 1)` `translateX` — in the popup, the guide and the annotation editor. The
theme itself applies instantly: document snapshots (View Transitions) and background-colour fades
both caused visible flicker, so colours switch immediately while only the thumb slides.

The Area and Element pickers carry the same visual language onto the page itself. Their overlay uses
the popup's light or dark palette — including the hard offset shadow shared by the buttons, but with
a much lighter fill so the page underneath stays readable. All four corner brackets share one smooth
opacity pulse, and a small accent square traces the whole selection; two lightweight animations run
continuously while a pick is active. The whole overlay
and the Element highlight fade in, and a successful pick settles and fades out before removal. The
dimming veil is a single translucent background, never a giant inset shadow, and box-shadows are
static: animating either repaints the whole page on every frame and made the Area picker stutter the
browser. Pointer
reads and geometry writes are batched into one `requestAnimationFrame` per frame. A full-width scan
line and a scale/overshoot bounce were both tried and removed — the line read as a stray divider and
the bounce stretched the frame. The Element highlight now glides between targets with a soft,
bounce-free 0.28s transition. This layer has its own Settings switch and also respects global Motion
and reduced motion; with it off the overlay is still fully styled but instant.

These are original plain CSS/TS implementations inspired by public galleries such as React Bits
and Motion; no code from those projects is used. Only `transform`, `opacity` and custom properties
are animated, all pointer effects are rAF-throttled, and every effect is a no-op when motion is off
or the OS asks for reduced motion. The animated status text is decorative (`aria-hidden`); stable
text goes to a separate live region so a screen reader announces it once.

## Framing

The brand rings are five exact 20-unit arcs on a normalised `pathLength` of 100, so the colours
meet without dark gaps. The mascot has no teardrop under its eye. Light and dark variants of the
mark and mascot use the same geometry.

The "deep" tone is one warm brown (`#2e2118`) used for light-mode ink, borders and active fills,
and for dark-mode fields — so the dark parts of the theme switch and other controls look the same
in both themes instead of drifting toward near-black.

Guide sections are framed cards with a 2 px ink border, a hard offset shadow and a vermilion top
rule. Cards carry a pointer-follow spotlight. The quick-start badges are square number stamps with
their own hard shadow. The popup keeps its tighter frame, with the same language of borders and
shadows carried down to the checkboxes and dropdowns. Each guide section that describes a control
also shows a small, cropped screenshot of that exact control, generated from the real build.

## Selection states

Active and selected states use a shared `--select` / `--select-hover` wash derived from the vermilion
accent, plus a 3 px accent bar. The active guide TOC item gets the wash, a stronger number and an
inset accent hairline so it is obvious in both light and dark themes; the same language is used for
the active popup tab and the highlighted/selected dropdown option. Hover states use a lighter
`--select-hover` wash. Focus keeps the indigo outline, which is reserved for keyboard focus.

## Theme-aware artwork and highlights

The shimmer sweep and the active-button wash use the `--shimmer` token: a light wash on the dark
buttons of light mode, a dark wash on the light buttons of dark mode. Both logo SVGs have a dark
variant (`spectra-mark-dark.svg` and `spectra-mascot-dark.svg`) selected whenever the theme
changes, so the artwork's backing and border always match the surrounding paper. The shimmer
pseudo-elements are clipped to their host buttons, so no highlight can escape and drift across a
page.

## Accessibility

Tab and arrow keys move through controls; Left/Right move between tabs; Home/End jump to the first
and last tab. Every control has a visible focus outline. Invalid fields get `aria-invalid`, a
visible error message reference (`aria-describedby`) and a colour that is not the only signal.
The status, console badge and console list are live regions. Interactive targets are at least
24 × 24 px. Contrast was checked for both themes; the lowest text pair (light text on vermilion)
is about 4.7:1. `prefers-contrast: more` strengthens hairlines and secondary text.

There are no keyboard shortcuts for opening the popup or starting a capture; they were removed in
0.5.2 because they were unreliable.

## What was removed

In 0.5.0 the live page preview went (the screencast stage with zoom and pan). In 0.5.1 the ratio
thumbnails went too, with their tab. In 0.6.0 the monospaced font, the "no fallback" claim, dead
CSS and stale preview ignore entry went. The popup still has three pages.
