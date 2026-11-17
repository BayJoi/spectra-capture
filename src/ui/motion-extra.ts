/**
 * Extra motion, written from scratch in plain CSS/TS. Ideas (magnetic buttons, spotlight cards,
 * staggered text, reading shimmer) are inspired by public motion libraries such as React Bits,
 * but no source from those projects is used — React Bits is MIT + Commons Clause.
 *
 * Everything here animates only transform / opacity / custom properties, runs on
 * requestAnimationFrame, and is a no-op when motion is off or the OS asks for reduced motion.
 */
import { motionOn } from "../popup/motion";

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
const enabled = (): boolean => motionOn() && !reduced();

/** Pointer-follow highlight for framed cards. Sets --mx/--my as percentages. */
export function attachSpotlight(root: ParentNode = document): void {
  if (!enabled()) return;
  root.querySelectorAll<HTMLElement>("[data-spotlight]").forEach((host) => {
    if (host.dataset.spotlightReady) return;
    host.dataset.spotlightReady = "1";
    let frame = 0;
    let px = 50;
    let py = 50;
    const draw = (): void => {
      frame = 0;
      host.style.setProperty("--mx", `${px.toFixed(1)}%`);
      host.style.setProperty("--my", `${py.toFixed(1)}%`);
    };
    host.addEventListener(
      "pointermove",
      (event) => {
        if (!enabled()) return;
        const box = host.getBoundingClientRect();
        px = ((event.clientX - box.left) / box.width) * 100;
        py = ((event.clientY - box.top) / box.height) * 100;
        if (!frame) frame = requestAnimationFrame(draw);
      },
      { passive: true },
    );
    host.addEventListener("pointerleave", () => {
      px = 50;
      py = 50;
      if (!frame) frame = requestAnimationFrame(draw);
    });
  });
}

/** Stagger children with a --i index so CSS can deal them in sequence. */
export function stagger(children: ArrayLike<HTMLElement>): void {
  Array.from(children).forEach((child, index) => child.style.setProperty("--i", String(index)));
}

/**
 * Reveals elements as they enter the viewport, with a staggered transform. Falls back to showing
 * everything immediately when motion is off, so no content is ever left hidden.
 */
export function revealOnScroll(root: ParentNode = document): void {
  const items = root.querySelectorAll<HTMLElement>("[data-reveal]");
  if (!enabled() || !("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-in"));
    return;
  }
  stagger(items);
  const observer = new IntersectionObserver(
    (entries) => {
      // Stagger only within the current batch and cap it: a global index gives late sections
      // multi-second delays, which reads as the UI being slow while scrolling.
      const arriving = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      // Process every arriving entry: dropping any from the batch leaves it permanently hidden,
      // because IntersectionObserver only fires again when intersection actually changes.
      arriving.forEach((entry, index) => {
        const target = entry.target as HTMLElement;
        target.style.setProperty("--i", String(Math.min(index, 3)));
        target.classList.add("is-in");
        observer.unobserve(target);
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px 0px 0px" },
  );
  items.forEach((item) => observer.observe(item));
}

/** Slow parallax for decorative art, capped and rAF-throttled. */
export function attachParallax(root: ParentNode = document): void {
  if (!enabled()) return;
  const targets = root.querySelectorAll<HTMLElement>("[data-parallax]");
  if (targets.length === 0) return;
  let frame = 0;
  const draw = (): void => {
    frame = 0;
    const offset = Math.min(24, window.scrollY * 0.06);
    targets.forEach((target) => {
      const speed = Number(target.dataset.parallax ?? "1");
      target.style.setProperty("--parallax", `${(offset * speed).toFixed(1)}px`);
    });
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!frame) frame = requestAnimationFrame(draw);
    },
    { passive: true },
  );
  draw();
}

/** Sets up every extra effect in one call. Safe to call from the popup and the guide. */
export function enrichMotion(root: ParentNode = document): void {
  // Spotlight/reveal only on the guide's real cards. The popup is a fixed 380×600 layout, so
  // lighting its groups up with a pointer highlight produces flicker and ugly blocks.
  // Buttons deliberately do NOT get a magnetic transform: fractional-pixel pointer tracking made
  // their labels blur on hover and fought the CSS hard-shadow hover states.
  const isGuide = Boolean(root.querySelector?.(".layout"));
  if (isGuide) {
    root.querySelectorAll<HTMLElement>(".guide, .pages div").forEach((node) => {
      if (!node.hasAttribute("data-spotlight")) node.setAttribute("data-spotlight", "");
    });
    root.querySelectorAll<HTMLElement>(".guide, .pages div, .steps li").forEach((node) => {
      if (!node.hasAttribute("data-reveal")) node.setAttribute("data-reveal", "");
    });
  }
  const hero = root.querySelector<HTMLElement>(".hero");
  if (hero && !hero.hasAttribute("data-enter")) {
    hero.setAttribute("data-enter", "");
    stagger(hero.children as HTMLCollectionOf<HTMLElement>);
  }
  const mascot = root.querySelector<HTMLElement>(".hero-logo");
  if (mascot && !mascot.hasAttribute("data-parallax")) mascot.setAttribute("data-parallax", "1");

  attachSpotlight(root);
  revealOnScroll(root);
  attachParallax(root);
}
