import { DELAY_OPTIONS } from "../shared/types";
import type { CommandSender } from "./debugger-session";

/** Emulates the site's own dark colour scheme. Restored by the returned function. */
export async function applyDarkMode(send: CommandSender): Promise<() => Promise<void>> {
  await send.send("Emulation.setEmulatedMedia", {
    media: "",
    features: [{ name: "prefers-color-scheme", value: "dark" }],
  });
  return async () => {
    await send.send("Emulation.setEmulatedMedia", { media: "", features: [] }).catch(() => undefined);
  };
}

/** Hides position:fixed/sticky elements so a full-page capture has no repeated headers. */
const HIDE_FIXED_EXPRESSION = `(() => {
  let n = 0;
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'sticky') && el.getBoundingClientRect().width > 0) {
      el.setAttribute('data-spectra-fixed', '1');
      el.style.setProperty('visibility', 'hidden', 'important');
      n++;
    }
  }
  return n;
})()`;

const RESTORE_FIXED_EXPRESSION = `(() => {
  let n = 0;
  const all = document.querySelectorAll('[data-spectra-fixed]');
  for (const el of all) {
    el.style.removeProperty('visibility');
    el.removeAttribute('data-spectra-fixed');
    n++;
  }
  return n;
})()`;

export async function applyHideFixed(send: CommandSender): Promise<() => Promise<void>> {
  await send.send("Runtime.evaluate", { expression: HIDE_FIXED_EXPRESSION, returnByValue: true });
  return async () => {
    await send.send("Runtime.evaluate", { expression: RESTORE_FIXED_EXPRESSION, returnByValue: true }).catch(
      () => undefined,
    );
  };
}

/** Removes any injected picker/countdown nodes and restores the cursor and CDP overlay state. */
export const CLEAN_ARTIFACTS_EXPRESSION = `(() => {
  // The picker's pointerdown handler cancels the default action; if Runtime.evaluate timed out it
  // never got to remove its listeners, so use the release hook it left behind. Without this, clicks
  // and text selection stay broken on the page until it is reloaded.
  try { if (typeof window.__spectraPickerRelease === 'function') window.__spectraPickerRelease(); } catch (e) {}
  delete window.__spectraPickerRelease;
  document.querySelectorAll('[data-spectra-picker],[data-spectra-countdown]').forEach((n) => n.remove());
  document.documentElement.style.cursor = '';
  document.body.style.cursor = '';
  return true;
})()`;

export async function clearPickerArtifacts(send: CommandSender): Promise<void> {
  await send.send("Overlay.setInspectMode", { mode: "none" }).catch(() => undefined);
  await send.send("Overlay.hideHighlight").catch(() => undefined);
  await send.send("Runtime.evaluate", { expression: CLEAN_ARTIFACTS_EXPRESSION, returnByValue: true }).catch(
    () => undefined,
  );
}

/**
 * Shows a countdown in the page so the user can set up a hover menu, then resolves. The only
 * interpolated value is a validated delay from the fixed DELAY_OPTIONS set — never page data.
 */
export async function runCountdown(send: CommandSender, seconds: number): Promise<void> {
  // Validate at the interpolation point too, so this function is safe regardless of its caller.
  const safe = (DELAY_OPTIONS as readonly number[]).includes(seconds) ? Math.trunc(seconds) : 0;
  if (safe <= 0) return;
  const expression = `new Promise((resolve) => {
    const root = document.createElement('div');
    root.setAttribute('data-spectra-countdown', '1');
    const s = root.style;
    s.position = 'fixed'; s.zIndex = '2147483647';
    s.left = '50%'; s.top = '24px'; s.transform = 'translateX(-50%)';
    s.padding = '12px 20px'; s.background = '#2e2118'; s.color = '#f7f2e6';
    s.border = '2px solid #e2603b'; s.boxShadow = '6px 6px 0 rgba(0,0,0,0.35)';
    s.font = '600 13px Inter, system-ui, sans-serif'; s.letterSpacing = '0.08em';
    s.pointerEvents = 'none';
    root.textContent = '${safe}';
    document.documentElement.appendChild(root);
    let left = ${safe};
    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        root.remove();
        resolve(true);
      } else {
        root.textContent = String(left);
      }
    }, 1000);
  })`;
  await send.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
}
