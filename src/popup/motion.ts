/**
 * Small motion helpers. Each one checks motionOn() first, so turning motion off makes every effect
 * instant. Only transform, opacity and short text changes are animated.
 */

const GLYPHS = "!<>-_\\/[]{}=+*^?#";
const frames = new WeakMap<HTMLElement, number>();

export function motionOn(): boolean {
  return document.documentElement.dataset.motion === "on";
}

export function setMotion(on: boolean): void {
  document.documentElement.dataset.motion = on ? "on" : "off";
}

/** Text that resolves from random glyphs into the final text. */
export function scramble(el: HTMLElement, text: string, ms = 480): void {
  cancelAnimationFrame(frames.get(el) ?? 0);
  if (!motionOn()) {
    el.textContent = text;
    return;
  }
  const start = performance.now();
  const frame = (now: number): void => {
    const progress = Math.min(1, (now - start) / ms);
    const revealed = Math.floor(progress * text.length);
    el.textContent = [...text]
      .map((ch, i) => (i < revealed || ch === " " ? ch : (GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "#")))
      .join("");
    if (progress < 1) frames.set(el, requestAnimationFrame(frame));
    else el.textContent = text;
  };
  frames.set(el, requestAnimationFrame(frame));
}

/** Stops a running count-up so it cannot write a stale value back into a cleared element. */
export function cancelCountUp(el: HTMLElement): void {
  cancelAnimationFrame(frames.get(el) ?? 0);
  frames.delete(el);
}

/** Counts a number up to its value. */
export function countUp(el: HTMLElement, to: number, suffix = "", ms = 420): void {
  cancelAnimationFrame(frames.get(el) ?? 0);
  const label = (v: number): string => `${v.toFixed(1)}${suffix}`;
  if (!motionOn()) {
    el.textContent = label(to);
    return;
  }
  const start = performance.now();
  const frame = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = label(to * (1 - (1 - t) ** 3));
    if (t < 1) frames.set(el, requestAnimationFrame(frame));
  };
  frames.set(el, requestAnimationFrame(frame));
}

/** Moves the highlight of a segmented control under the selected option. */
export function placeThumb(group: HTMLElement): void {
  const label = group.querySelector<HTMLInputElement>("input:checked")?.closest("label");
  if (!label) return;
  group.style.setProperty("--thumb-x", `${label.offsetLeft}px`);
  group.style.setProperty("--thumb-w", `${label.offsetWidth}px`);
}

/** Adds a class for one animation run, then removes it when that run ends. */
export function pulse(el: HTMLElement, className: string): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  const done = (event: AnimationEvent): void => {
    if (event.target !== el) return;
    el.classList.remove(className);
    el.removeEventListener("animationend", done);
  };
  el.addEventListener("animationend", done);
}

const RIPPLE_TARGETS = ".ghost, .btn-row button, .primary, .swap, .help-link, .tab, .dd-button";

/** A square ripple starts where a button was pressed. */
export function attachRipples(root: Document): void {
  root.addEventListener("pointerdown", (event) => {
    const host = (event.target as Element | null)?.closest<HTMLElement>(RIPPLE_TARGETS);
    if (!host || !motionOn() || host.matches(":disabled")) return;
    const box = host.getBoundingClientRect();
    const size = Math.max(box.width, box.height) * 2;
    const ripple = document.createElement("span");
    ripple.className = "ripple";
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - box.left - size / 2}px`;
    ripple.style.top = `${event.clientY - box.top - size / 2}px`;
    host.append(ripple);
    ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
  });
}

/**
 * Applies a theme change directly. Document snapshots and colour fades both caused visible flicker,
 * so colours switch immediately and only the switch thumb slides.
 */
export function switchTheme(apply: () => void): void {
  apply();
}
