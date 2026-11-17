import { en } from "../i18n/en";
import { isDpr, type SizePreset } from "../shared/types";
import { LIMITS, parseIntStrict } from "../validation/dimensions";

/** Every built-in size is checked by tests: each one must pass the limits at its own density. */
export const DEVICE_PRESETS: readonly SizePreset[] = [
  { id: "desktop", label: en.presets.desktop, width: 1440, height: 900, dpr: 1 },
  { id: "laptop", label: en.presets.laptop, width: 1366, height: 768, dpr: 1 },
  { id: "tablet", label: en.presets.tablet, width: 768, height: 1024, dpr: 2 },
  { id: "phone", label: en.presets.phone, width: 390, height: 844, dpr: 3 },
];

export const RESOLUTION_PRESETS: readonly SizePreset[] = [
  { id: "hd", label: en.presets.hd, width: 1280, height: 720, dpr: 1 },
  { id: "fhd", label: en.presets.fhd, width: 1920, height: 1080, dpr: 1 },
  { id: "qhd", label: en.presets.qhd, width: 2560, height: 1440, dpr: 1 },
  { id: "uhd4k", label: en.presets.uhd4k, width: 3840, height: 2160, dpr: 1 },
  { id: "uhd5k", label: en.presets.uhd5k, width: 5120, height: 2880, dpr: 1 },
  { id: "uhd6k", label: en.presets.uhd6k, width: 6144, height: 3456, dpr: 1 },
  { id: "uhd8k", label: en.presets.uhd8k, width: 7680, height: 4320, dpr: 1 },
];

export const MAX_SAVED_SIZES = 4;

export const ALL_PRESETS: readonly SizePreset[] = [...DEVICE_PRESETS, ...RESOLUTION_PRESETS];

/** The id of the dynamic "Monitor" preset built from the display's own resolution. */
export const MONITOR_PRESET_ID = "monitor";

/**
 * Builds the Monitor preset from a screen's resolution (CSS pixels). It is dynamic — the popup reads
 * `window.screen` and calls this once on open — and is kept out of ALL_PRESETS so the static
 * built-in set stays deterministic for tests. Out-of-range monitors return null instead of being
 * silently clamped; at 1× density any in-range monitor stays inside the pixel limits.
 */
export function monitorPreset(screenWidth: number, screenHeight: number): SizePreset | null {
  const w = parseIntStrict(screenWidth, LIMITS.minCss, LIMITS.maxCssWidth);
  const h = parseIntStrict(screenHeight, LIMITS.minCss, LIMITS.maxCssHeight);
  if (!w.ok || !h.ok) return null;
  return { id: MONITOR_PRESET_ID, label: en.presets.monitor, width: w.value, height: h.value, dpr: 1 };
}

export function sanitizePreset(raw: unknown): SizePreset | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) r[key] = (raw as Record<string, unknown>)[key];
  const w = parseIntStrict(r.width, LIMITS.minCss, LIMITS.maxCssWidth);
  const h = parseIntStrict(r.height, LIMITS.minCss, LIMITS.maxCssHeight);
  const dpr = typeof r.dpr === "number" ? r.dpr : Number(r.dpr);
  if (!w.ok || !h.ok || !isDpr(dpr)) return null;
  return savedPreset(w.value, h.value, dpr);
}

function savedPreset(width: number, height: number, dpr: SizePreset["dpr"]): SizePreset {
  return { id: `saved-${width}x${height}@${dpr}`, label: en.presets.saved, width, height, dpr };
}

export function addSavedSize(list: SizePreset[], width: number, height: number, dpr: SizePreset["dpr"]): SizePreset[] {
  const next = savedPreset(width, height, dpr);
  if (list.some((p) => p.id === next.id)) return list;
  return [...list, next].slice(-MAX_SAVED_SIZES);
}

export function removeSavedSize(list: SizePreset[], id: string): SizePreset[] {
  return list.filter((p) => p.id !== id);
}
