import { en } from "../i18n/en";
import { DPR_OPTIONS, isDelay, isDpr, type CaptureMode, type CaptureOptions, type Dpr, type Region } from "../shared/types";

/**
 * Limits. All values are PROVISIONAL until they are measured on real browsers.
 * Out-of-range input is refused with a reason. It is never clamped without telling the user.
 */
export const LIMITS = {
  minCss: 200,
  maxCssWidth: 7680,
  maxCssHeight: 10000,
  /** Per-side output limit in device pixels. Commonly reported GPU and compositor limits sit near 16384. */
  maxOutputSide: 16384,
  /** Total output pixels that are refused. */
  maxOutputPixels: 100_000_000,
  /** Above this many pixels the user must confirm. */
  confirmPixels: 40_000_000,
  /**
   * Assumed document height for full-page size estimates. The real height is only known after the
   * page is measured, so the UI uses a realistic worst-case value to disable density options that
   * would certainly exceed the pixel budget. It is an estimate, not a hard page-height limit.
   */
  fullPageEstimateHeight: 6000,
  minQuality: 30,
  maxQuality: 100,
  defaultQuality: 92,
} as const;

export type FieldKey = "width" | "height" | "dpr" | "mode" | "format" | "quality";

export type Checked<T> = { ok: true; value: T } | { ok: false; fields: FieldKey[]; message: string };

const fieldMessage = (label: string, reason: string): string => `${label} ${reason}.`;

export type IntResult = { ok: true; value: number } | { ok: false; reason: string };

/** Accepts plain whole numbers only: digits for text, integers for numbers. No signs, decimals, or exponents. */
export function parseIntStrict(raw: unknown, min: number, max: number): IntResult {
  const r = en.reasons;
  let value: number;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: r.notFinite };
    if (!Number.isInteger(raw)) return { ok: false, reason: r.wholeNumber };
    value = raw;
  } else if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return { ok: false, reason: r.blank };
    if (!/^\d+$/.test(text)) return { ok: false, reason: r.digitsOnly };
    value = Number(text);
  } else {
    return { ok: false, reason: r.wrongType };
  }
  if (!Number.isSafeInteger(value)) return { ok: false, reason: r.tooBig };
  if (value < min) return { ok: false, reason: r.atLeast(min) };
  if (value > max) return { ok: false, reason: r.atMost(max) };
  return { ok: true, value };
}

/** A region is geometry only — four finite numbers with a positive area. */
function isRegion(value: unknown): value is Region {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const nums = [r.x, r.y, r.width, r.height];
  return (
    nums.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    (r.width as number) > 0 &&
    (r.height as number) > 0
  );
}

export function validateCaptureOptions(input: unknown): Checked<CaptureOptions> {
  const ui = en.ui;
  if (typeof input !== "object" || input === null) {
    return { ok: false, fields: [], message: `${en.ui.captureTitle} options ${en.reasons.missing}.` };
  }
  const r = input as Record<string, unknown>;

  const width = parseIntStrict(r.width, LIMITS.minCss, LIMITS.maxCssWidth);
  if (!width.ok) return { ok: false, fields: ["width"], message: fieldMessage(ui.width, width.reason) };
  const height = parseIntStrict(r.height, LIMITS.minCss, LIMITS.maxCssHeight);
  if (!height.ok) return { ok: false, fields: ["height"], message: fieldMessage(ui.height, height.reason) };

  const dpr = typeof r.dpr === "string" ? Number(r.dpr) : r.dpr;
  if (typeof dpr !== "number" || !isDpr(dpr)) {
    return { ok: false, fields: ["dpr"], message: fieldMessage(ui.density, en.reasons.oneOf(DPR_OPTIONS.join(", "))) };
  }
  if (!(["viewport", "fullpage", "region", "element"] as string[]).includes(String(r.mode))) {
    return { ok: false, fields: ["mode"], message: fieldMessage(ui.modeLabel, en.reasons.mode) };
  }
  const mode = r.mode as CaptureMode;
  const delay = typeof r.delay === "string" ? Number(r.delay) : r.delay;
  if (typeof delay !== "number" || !isDelay(delay)) {
    return { ok: false, fields: [], message: fieldMessage(ui.delayLabel, en.reasons.oneOf("0, 3, 5, 10")) };
  }
  if (r.format !== "png" && r.format !== "jpeg") {
    return { ok: false, fields: ["format"], message: fieldMessage(ui.format, en.reasons.format) };
  }
  const quality = parseIntStrict(r.quality ?? LIMITS.defaultQuality, LIMITS.minQuality, LIMITS.maxQuality);
  if (!quality.ok) return { ok: false, fields: ["quality"], message: fieldMessage(ui.qualityShort, quality.reason) };

  // Theme is a fixed allow-list and overlayMotion a boolean, so both are safe to pass to a CDP
  // expression. Missing values keep the historical defaults (light theme, animations on).
  const theme = r.theme === "dark" ? "dark" : "light";
  const overlayMotion = r.overlayMotion !== false;
  const pickTimeout = r.pickTimeout === true;

  return {
    ok: true,
    value: {
      theme,
      overlayMotion,
      pickTimeout,
      width: width.value,
      height: height.value,
      dpr,
      mode,
      format: r.format,
      quality: quality.value,
      warmUp: r.warmUp === true,
      confirmLarge: r.confirmLarge === true,
      delay,
      darkMode: r.darkMode === true,
      hideFixed: r.hideFixed === true,
      saveAs: r.saveAs === true,
      copyToClipboard: r.copyToClipboard === true,
      annotate: r.annotate === true,
      region: isRegion(r.region) ? r.region : undefined,
    },
  };
}

export const toMegapixels = (pixels: number): number => Math.round(pixels / 100_000) / 10;

export interface OutputAssessment {
  outW: number;
  outH: number;
  pixels: number;
  verdict: "ok" | "confirm" | "reject";
  message: string;
}

/** Works out the output size in device pixels and whether it is allowed. This is the one place limits are checked. */
export function assessOutput(cssWidth: number, cssHeight: number, dpr: number): OutputAssessment {
  const outW = Math.round(cssWidth * dpr);
  const outH = Math.round(cssHeight * dpr);
  const pixels = outW * outH;
  const base = { outW, outH, pixels, message: "" };
  if (outW > LIMITS.maxOutputSide || outH > LIMITS.maxOutputSide) {
    return { ...base, verdict: "reject", message: en.reasons.perSide(outW, outH, LIMITS.maxOutputSide) };
  }
  if (pixels > LIMITS.maxOutputPixels) {
    const mp = String(toMegapixels(pixels));
    return { ...base, verdict: "reject", message: en.reasons.totalPixels(mp, String(toMegapixels(LIMITS.maxOutputPixels))) };
  }
  return { ...base, verdict: pixels > LIMITS.confirmPixels ? "confirm" : "ok" };
}

/**
 * Pixel densities that can be used at this size. For full-page mode the real document height is
 * not known in the popup, so we estimate with `fullPageEstimateHeight` and check both the per-side
 * limit and the total pixel budget. This prevents selecting an option (e.g. 6K at 2× full page)
 * that would certainly be refused at capture time.
 */
export function allowedDprs(width: number, height: number, mode: CaptureMode): Dpr[] {
  // Region/element sizes are not known until the user picks, so all densities remain available;
  // the worker gates the picked rectangle before capture.
  if (mode === "region" || mode === "element") return [...DPR_OPTIONS];
  const h = mode === "fullpage" ? LIMITS.fullPageEstimateHeight : height;
  return DPR_OPTIONS.filter((dpr) => assessOutput(width, h, dpr).verdict !== "reject");
}

/** Full check used by the popup before it starts a capture. */
export function validateRequest(input: unknown): Checked<CaptureOptions> {
  const checked = validateCaptureOptions(input);
  if (!checked.ok) return checked;
  const o = checked.value;
  if (o.mode === "region" || o.mode === "element") {
    // Size is chosen interactively; gate happens in the worker once the rectangle is known.
    return checked;
  }
  const estimateHeight = o.mode === "fullpage" ? LIMITS.fullPageEstimateHeight : o.height;
  const assessment = assessOutput(o.width, estimateHeight, o.dpr);
  if (assessment.verdict === "reject") {
    return { ok: false, fields: ["width", "height", "dpr"], message: assessment.message };
  }
  return checked;
}
