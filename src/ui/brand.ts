import type { Theme } from "../shared/types";

/** Swaps all brand artworks to the variant that matches the active theme. */
export function applyBrandTheme(theme: Theme, root: ParentNode = document): void {
  const suffix = theme === "dark" ? "-dark" : "";
  root.querySelectorAll<HTMLImageElement>("img[data-brand]").forEach((image) => {
    const base = image.dataset.brand;
    if (!base) return;
    const next = `brand/${base}${suffix}.svg`;
    if (image.getAttribute("src") !== next) image.setAttribute("src", next);
  });
}
