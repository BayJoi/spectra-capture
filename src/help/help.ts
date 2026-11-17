import { chromeKv } from "../shared/kv";
import { loadPrefs, savePrefs } from "../settings/settings-store";
import { setMotion, switchTheme } from "../popup/motion";
import { hydrateButtons } from "../ui/button";
import { enrichMotion } from "../ui/motion-extra";
import { applyBrandTheme } from "../ui/brand";

/** Guide behaviour: theme switch (shared with the popup), scroll reveals, table of contents, reading bar. */

const local = chromeKv(chrome.storage.local as chrome.storage.StorageArea);
const themeToggle = document.getElementById("theme-toggle") as HTMLButtonElement;
const readingBar = document.getElementById("reading-bar") as HTMLElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function applyTheme(theme: "light" | "dark", animate: boolean): void {
  const apply = (): void => {
    document.documentElement.dataset.theme = theme;
    applyBrandTheme(theme);
  };
  if (animate) switchTheme(apply);
  else apply();
  themeToggle.setAttribute("aria-checked", String(theme === "dark"));
  themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
}

function setupToc(): void {
  const links = new Map<string, HTMLAnchorElement>();
  document.querySelectorAll<HTMLAnchorElement>(".toc a").forEach((link) => links.set(link.hash.slice(1), link));
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        links.forEach((link) => link.removeAttribute("aria-current"));
        links.get(entry.target.id)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-35% 0px -55% 0px" },
  );
  document.querySelectorAll<HTMLElement>("section.guide").forEach((section) => observer.observe(section));
}

function setupReadingBar(): void {
  const update = (): void => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = max > 0 ? window.scrollY / max : 0;
    readingBar.style.transform = `scaleX(${Math.min(1, Math.max(0, ratio))})`;
  };
  window.addEventListener("scroll", update, { passive: true });
  update();
}

async function boot(): Promise<void> {
  const prefs = await loadPrefs(local);
  const motionOn = prefs.motion && !reduced;
  setMotion(motionOn);
  applyTheme(prefs.theme, false);
  themeToggle.addEventListener("click", async () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next, true);
    await savePrefs(local, { ...prefs, theme: next });
  });
  hydrateButtons(document);
  enrichMotion(document);
  setupToc();
  setupReadingBar();
}

void boot();
