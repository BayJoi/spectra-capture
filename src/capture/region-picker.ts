import { CaptureError } from "../shared/errors";
import type { Region, Theme } from "../shared/types";
import type { CommandSender } from "./debugger-session";

export type PickKind = "region" | "element";

/** Style for the injected overlay. Both fields come from validated prefs, never from the page. */
export interface PickStyle {
  theme: Theme;
  motion: boolean;
}

interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
}

/** Reads the document scroll offset purely through CDP — no page JS, no interpolated expression. */
async function scrollOffset(send: CommandSender): Promise<{ x: number; y: number }> {
  const metrics = await send.send<{
    cssLayoutViewport?: { pageX?: number; pageY?: number };
    cssVisualViewport?: { pageX?: number; pageY?: number };
  }>("Page.getLayoutMetrics");
  const vp = metrics.cssLayoutViewport ?? metrics.cssVisualViewport;
  return { x: vp?.pageX ?? 0, y: vp?.pageY ?? 0 };
}

function toDocument(rect: ViewportRect, offset: { x: number; y: number }): Region {
  return {
    x: Math.max(0, Math.round(rect.x + offset.x)),
    y: Math.max(0, Math.round(rect.y + offset.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };
}

/**
 * Fixed palette constants for the injected overlay, mirroring the extension's light/dark tokens.
 * Only these fixed values (and booleans) are interpolated into the expression — never page data.
 */
function overlayConstants(style: PickStyle): string {
  const palette = style.theme === "dark"
    ? {
        veil: "rgba(8,6,4,0.42)", accent: "#e0543d", fill: "rgba(224,84,61,0.05)",
        tick: "#0f0d0b", shadow: "4px 4px 0 #ece4d2", flash: "rgba(224,84,61,0.16)",
      }
    : {
        veil: "rgba(20,16,12,0.34)", accent: "#c2402b", fill: "rgba(194,64,43,0.04)",
        tick: "#f7f2e6", shadow: "4px 4px 0 #2e2118", flash: "rgba(194,64,43,0.12)",
      };
  // Soft, no overshoot: a selection frame should land, not bounce or stretch.
  return `const C = ${JSON.stringify(palette)}; const MOTION = ${style.motion ? "true" : "false"}; const EASE = 'cubic-bezier(.2,.8,.2,1)';`;
}

/**
 * Shared corner brackets and motion. The old full-width scan line and animated box-shadow are gone:
 * the line read as a stray divider and animating shadows repaints the page. One smooth alternate
 * opacity pulse drives all four brackets together; a small accent square traces the whole perimeter.
 * Both animations touch only opacity/transform, so they stay on the compositor.
 */
const CORNER_TICKS = `
  // All four brackets share one layer so a single smooth opacity animation pulses them together.
  const ticksLayer = document.createElement("div");
  ticksLayer.setAttribute("data-spectra-ticks", "1");
  const ls = ticksLayer.style;
  ls.position = "absolute"; ls.inset = "0"; ls.pointerEvents = "none";
  const corner = (h, v) => {
    const t = document.createElement("div");
    t.setAttribute("data-spectra-tick", "1");
    const ts = t.style;
    ts.position = "absolute"; ts.width = "16px"; ts.height = "16px";
    ts.pointerEvents = "none"; ts.borderStyle = "solid"; ts.borderColor = C.accent;
    ts.borderWidth = "0";
    if (h === "l") ts.left = "-4px"; else ts.right = "-4px";
    if (v === "t") ts.top = "-4px"; else ts.bottom = "-4px";
    ts.borderTopWidth = v === "t" ? "3px" : "0";
    ts.borderBottomWidth = v === "b" ? "3px" : "0";
    ts.borderLeftWidth = h === "l" ? "3px" : "0";
    ts.borderRightWidth = h === "r" ? "3px" : "0";
    ticksLayer.appendChild(t);
  };
  corner("l","t"); corner("r","t"); corner("l","b"); corner("r","b");
  box.appendChild(ticksLayer);
  const flash = document.createElement("div");
  flash.setAttribute("data-spectra-flash", "1");
  const fs = flash.style;
  fs.position = "absolute"; fs.inset = "0"; fs.background = C.flash;
  fs.opacity = "0"; fs.pointerEvents = "none";
  box.appendChild(flash);
  // A small accent square that traces the whole perimeter. It is one absolutely-positioned 12px
  // element, so animating left/top is trivial compared with the old full-width line or a shadow.
  const runner = document.createElement("div");
  runner.setAttribute("data-spectra-runner", "1");
  const rs = runner.style;
  rs.position = "absolute"; rs.left = "0"; rs.top = "0"; rs.width = "12px"; rs.height = "12px";
  rs.marginLeft = "-6px"; rs.marginTop = "-6px";
  rs.background = C.accent; rs.opacity = "0.9"; rs.pointerEvents = "none";
  box.appendChild(runner);
  const anims = [];
  if (MOTION) {
    // A two-keyframe alternate ease gives a genuinely smooth sine-like pulse (no stepped stops).
    anims.push(ticksLayer.animate(
      [{ opacity: 0.45 }, { opacity: 1 }],
      { duration: 1700, iterations: Infinity, direction: "alternate", easing: "ease-in-out" },
    ));
    anims.push(runner.animate(
      [
        { left: "0%", top: "0%" },
        { left: "100%", top: "0%" },
        { left: "100%", top: "100%" },
        { left: "0%", top: "100%" },
        { left: "0%", top: "0%" },
      ],
      { duration: 5200, iterations: Infinity, easing: "linear" },
    ));
  } else {
    runner.style.display = "none";
  }
  const settle = () => {
    if (!MOTION) return;
    const a = flash.animate([{ opacity: 0 }, { opacity: 0.9 }, { opacity: 0 }], {
      duration: 320, easing: "ease-out",
    });
    anims.push(a);
    a.onfinish = () => { const i = anims.indexOf(a); if (i >= 0) anims.splice(i, 1); };
  };
`;

/** Area picker overlay: hard drop shadow, corner brackets and an opacity settle, all theme-matched. */
export function regionOverlayExpression(style: PickStyle): string {
  return `new Promise((resolve) => {
  ${overlayConstants(style)}
  const root = document.createElement("div");
  root.setAttribute("data-spectra-picker", "1");
  const s = root.style;
  s.position = "fixed"; s.inset = "0"; s.zIndex = "2147483647";
  s.pointerEvents = "none";
  // A plain translucent background is one composited layer. The old "inset 0 0 0 9999px" shadow
  // repainted the entire viewport whenever the box moved and stuttered the whole browser.
  s.background = C.veil;
  const oldCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";
  const box = document.createElement("div");
  const bs = box.style;
  bs.position = "absolute"; bs.display = "none";
  bs.border = "2px solid " + C.accent;
  bs.background = C.fill;
  bs.boxShadow = C.shadow;
  bs.pointerEvents = "none";
  // No geometry transition while dragging: pointermove fires far faster than a frame, and starting
  // a new transition on every event caused continuous layout/paint. Writes are rAF-batched below.
  ${CORNER_TICKS}
  root.appendChild(box);
  document.documentElement.appendChild(root);
  if (MOTION) root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE });
  let sx = 0, sy = 0, lastX = 0, lastY = 0, active = false, raf = 0;
  let settled = false, finishTimer = 0;
  const stopInput = () => {
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("keydown", key, true);
  };
  const finalize = (r) => {
    if (settled) return;
    settled = true;
    if (finishTimer) clearTimeout(finishTimer);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    stopInput();
    anims.forEach((a) => { try { a.cancel(); } catch (e) {} });
    root.remove();
    document.documentElement.style.cursor = oldCursor;
    delete window.__spectraPickerRelease;
    // Always settle the page promise: an external cleanup while picking must abort the job,
    // not leave Runtime.evaluate(awaitPromise) hanging until the CDP timeout.
    resolve(r);
  };
  const clear = () => finalize(null);
  // On success, stop input first, then play the settle and a short fade before finalizing.
  const done = (r) => {
    if (settled) return;
    stopInput();
    if (r && MOTION) {
      settle();
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 190, easing: "ease-in" });
      finishTimer = setTimeout(() => finalize(r), 210);
    } else finalize(r);
  };
  const paint = () => {
    raf = 0;
    if (!active) return;
    const x = Math.min(sx, lastX), y = Math.min(sy, lastY);
    bs.left = x + "px"; bs.top = y + "px";
    bs.width = Math.abs(lastX - sx) + "px";
    bs.height = Math.abs(lastY - sy) + "px";
  };
  const move = (e) => {
    if (!active) return;
    lastX = e.clientX; lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(paint);
  };
  const up = (e) => {
    if (!active) return;
    active = false;
    const r = { x: Math.min(sx, e.clientX), y: Math.min(sy, e.clientY),
                width: Math.abs(e.clientX - sx), height: Math.abs(e.clientY - sy) };
    done(r.width >= 2 && r.height >= 2 ? r : null);
  };
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    sx = e.clientX; sy = e.clientY; active = true;
    bs.display = "block";
    bs.left = sx + "px"; bs.top = sy + "px"; bs.width = "0px"; bs.height = "0px";
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); done(null); }
  };
  window.__spectraPickerRelease = clear;
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("keydown", key, true);
})`;
}

/**
 * Element picker overlay. A click snaps to the element under the pointer; the box morphs between
 * targets with a short settle and is theme-matched like Area.
 */
export function elementOverlayExpression(style: PickStyle): string {
  return `new Promise((resolve) => {
  ${overlayConstants(style)}
  const root = document.createElement("div");
  root.setAttribute("data-spectra-picker", "1");
  const s = root.style;
  s.position = "fixed"; s.inset = "0"; s.zIndex = "2147483647";
  s.pointerEvents = "none";
  s.background = C.veil;
  const oldCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";
  document.documentElement.appendChild(root);
  if (MOTION) root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE });
  const mark = document.createElement("div");
  const box = mark;
  const ms = mark.style;
  ms.position = "fixed"; ms.pointerEvents = "none"; ms.display = "block"; ms.opacity = "0";
  ms.border = "2px solid " + C.accent;
  ms.background = C.fill;
  ms.boxShadow = C.shadow;
  // Long, soft and bounce-free. Target changes are discrete, so a single layout transition here is
  // cheap; the overshoot and scale pop were removed because they stretched the frame noticeably.
  if (MOTION) ms.transition = "left .28s " + EASE + ",top .28s " + EASE + ",width .28s " + EASE + ",height .28s " + EASE + ",opacity .18s " + EASE;
  ${CORNER_TICKS}
  root.appendChild(mark);

  const SEMANTIC = /^(A|BUTTON|IMG|SVG|CANVAS|VIDEO|IFRAME|TABLE|ARTICLE|SECTION|FIGURE|LI|FORM)$/;
  let current = null, lastEl = null, lastX = 0, lastY = 0, raf = 0;
  const rectOut = (r) => ({ x: r.left, y: r.top, width: r.width, height: r.height });
  const applyMark = (r) => {
    ms.display = "block";
    ms.left = r.left + "px"; ms.top = r.top + "px";
    ms.width = r.width + "px"; ms.height = r.height + "px";
  };
  const meaningful = (el) => {
    if (!el || el === document.documentElement || el === document.body) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 48 || r.height < 32) return null;
    if (SEMANTIC.test(el.tagName)) return el;
    const cs = getComputedStyle(el);
    if (cs.display === "inline") return null;
    if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.boxShadow !== "none" || parseFloat(cs.borderRadius) > 0) return el;
    return null;
  };
  // elementFromPoint + getBoundingClientRect on every pointermove is expensive; batch to one read
  // and one write per frame. The geometry transition above then handles the discrete target change.
  const flushMove = () => {
    raf = 0;
    const hit = document.elementFromPoint(lastX, lastY);
    let el = meaningful(hit);
    if (!el && hit && hit !== document.body && hit !== document.documentElement) {
      const r = hit.getBoundingClientRect();
      if (r.width >= 48 && r.height >= 32) el = hit;
    }
    if (!el) { current = null; lastEl = null; ms.opacity = "0"; return; }
    const changed = el !== lastEl;
    current = el; lastEl = el;
    ms.opacity = "1";
    applyMark(el.getBoundingClientRect());
    if (MOTION && changed) settle();
  };
  const move = (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (!raf) raf = requestAnimationFrame(flushMove);
  };
  const down = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
  };
  let settled = false, finishTimer = 0;
  const stopInput = () => {
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointermove", move, true);
    window.removeEventListener("pointerup", up, true);
    window.removeEventListener("keydown", key, true);
  };
  const finalize = (out) => {
    if (settled) return;
    settled = true;
    if (finishTimer) clearTimeout(finishTimer);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    stopInput();
    anims.forEach((a) => { try { a.cancel(); } catch (e) {} });
    root.remove();
    document.documentElement.style.cursor = oldCursor;
    delete window.__spectraPickerRelease;
    resolve(out);
  };
  const clear = () => finalize(null);
  const done = (out) => {
    if (settled) return;
    stopInput();
    if (out && MOTION) {
      settle();
      ms.opacity = "0";
      root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 190, easing: "ease-in" });
      finishTimer = setTimeout(() => finalize(out), 210);
    } else finalize(out);
  };
  const up = (e) => {
    if (e.button !== 0) return; // right/middle click must not finalize a pick
    done(current ? rectOut(current.getBoundingClientRect()) : null);
  };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); finalize(null); }
  };
  window.__spectraPickerRelease = clear;
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move, true);
  window.addEventListener("pointerup", up, true);
  window.addEventListener("keydown", key, true);
})`;
}

/** Default expressions for docs/screenshots: light theme, animations on. */
export const REGION_OVERLAY_EXPRESSION = regionOverlayExpression({ theme: "light", motion: true });
export const ELEMENT_OVERLAY_EXPRESSION = elementOverlayExpression({ theme: "light", motion: true });

async function injected(
  send: CommandSender,
  kind: PickKind,
  style: PickStyle,
  timeoutMs: number,
): Promise<Region> {
  const expression = kind === "region"
    ? regionOverlayExpression(style)
    : elementOverlayExpression(style);
  // The caller wraps this in a slightly longer timeout; keep this one at the pick ceiling itself.
  const response = await send.send<{ result?: { value?: ViewportRect | null } }>(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    },
    timeoutMs,
  );
  const rect = response.result?.value;
  if (!rect || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    throw new CaptureError("SELECTION_CANCELLED");
  }
  // The overlay removed itself before resolving; read the scroll offset now for document coords.
  const offset = await scrollOffset(send);
  return toDocument(rect, offset);
}

/**
 * Picks a region or element on the page using a fixed-expression overlay injected through the
 * existing CDP session. No host permissions, no content scripts, and no overlay baked into the image.
 */
export async function pickRegion(
  send: CommandSender,
  kind: PickKind,
  style: PickStyle,
  timeoutMs: number,
): Promise<Region> {
  try {
    return await injected(send, kind, style, timeoutMs);
  } catch (err) {
    if (err instanceof CaptureError && err.code === "SELECTION_CANCELLED") throw err;
    throw new CaptureError("SELECTION_FAILED");
  }
}
