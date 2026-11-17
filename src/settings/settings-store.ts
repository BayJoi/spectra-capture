import type { KeyValueArea } from "../shared/kv";
import { isDelay, isDpr, type CaptureMode, type Dpr, type Prefs, type Theme } from "../shared/types";
import { LIMITS, parseIntStrict } from "../validation/dimensions";
import { isRatioId, FREE } from "../validation/ratios";
import { MAX_SAVED_SIZES, sanitizePreset } from "./presets";

export const PREFS_KEY = "prefs";

export const DEFAULT_PREFS: Prefs = {
  width: 1440,
  height: 900,
  dpr: 1,
  mode: "viewport",
  format: "png",
  quality: LIMITS.defaultQuality,
  warmUp: false,
  ratio: FREE,
  theme: "light",
  motion: true,
  savedSizes: [],
  delay: 0,
  darkMode: false,
  hideFixed: false,
  saveAs: false,
  copyToClipboard: false,
  annotate: false,
  notifications: true,
  pickTimeout: false,
};

/**
 * Rebuilds the preferences field by field. Unknown keys (such as a URL or a title) are dropped,
 * so storage can only ever hold the fields listed in Prefs.
 */
export function sanitizePrefs(raw: unknown): Prefs {
  // Copy only own enumerable keys: inherited/polluted prototype properties must never become prefs.
  const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const r: Record<string, unknown> = {};
  for (const key of Object.keys(source)) r[key] = source[key];
  const width = parseIntStrict(r.width, LIMITS.minCss, LIMITS.maxCssWidth);
  const height = parseIntStrict(r.height, LIMITS.minCss, LIMITS.maxCssHeight);
  const quality = parseIntStrict(r.quality, LIMITS.minQuality, LIMITS.maxQuality);
  const dprValue = typeof r.dpr === "string" ? Number(r.dpr) : r.dpr;
  // Cap before mapping so a corrupted/oversized stored list cannot cause unbounded work.
  const savedSizes = Array.isArray(r.savedSizes)
    ? r.savedSizes.slice(-MAX_SAVED_SIZES).map(sanitizePreset).filter((p): p is NonNullable<typeof p> => p !== null)
    : [];

  return {
    width: width.ok ? width.value : DEFAULT_PREFS.width,
    height: height.ok ? height.value : DEFAULT_PREFS.height,
    dpr: typeof dprValue === "number" && isDpr(dprValue) ? (dprValue as Dpr) : DEFAULT_PREFS.dpr,
    mode: (["viewport", "fullpage", "region", "element"] as string[]).includes(String(r.mode))
      ? (r.mode as CaptureMode)
      : "viewport",
    format: r.format === "jpeg" ? "jpeg" : "png",
    quality: quality.ok ? quality.value : DEFAULT_PREFS.quality,
    warmUp: r.warmUp === true,
    ratio: isRatioId(r.ratio) ? r.ratio : FREE,
    theme: (r.theme === "dark" ? "dark" : "light") as Theme,
    motion: r.motion !== false,
    savedSizes: savedSizes.slice(-MAX_SAVED_SIZES),
    delay: typeof r.delay === "number" && isDelay(r.delay) ? r.delay : 0,
    darkMode: r.darkMode === true,
    hideFixed: r.hideFixed === true,
    saveAs: r.saveAs === true,
    copyToClipboard: r.copyToClipboard === true,
    annotate: r.annotate === true,
    notifications: r.notifications !== false,
    pickTimeout: r.pickTimeout === true,
  };
}

export async function loadPrefs(area: KeyValueArea): Promise<Prefs> {
  return sanitizePrefs((await area.get(PREFS_KEY))[PREFS_KEY]);
}

export async function savePrefs(area: KeyValueArea, prefs: Prefs): Promise<void> {
  await area.set({ [PREFS_KEY]: sanitizePrefs(prefs) });
}

export async function resetPrefs(area: KeyValueArea): Promise<Prefs> {
  await savePrefs(area, DEFAULT_PREFS);
  return { ...DEFAULT_PREFS, savedSizes: [] };
}
