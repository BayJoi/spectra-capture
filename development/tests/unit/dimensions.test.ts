import { describe, expect, test } from "bun:test";
import { allowedDprs, assessOutput, LIMITS, parseIntStrict, toMegapixels, validateCaptureOptions, validateRequest } from "../../../src/validation/dimensions";
import { baseOptions } from "./helpers";

describe("parseIntStrict", () => {
  const accepted: Array<[unknown, number]> = [
    ["1440", 1440],
    [" 800 ", 800],
    [640, 640],
  ];
  for (const [raw, value] of accepted) {
    test(`accepts ${JSON.stringify(raw)}`, () => {
      expect(parseIntStrict(raw, 200, 7680)).toEqual({ ok: true, value });
    });
  }

  const rejected: unknown[] = ["", "   ", "0", "-5", "12.5", "1e3", "0x10", "NaN", "Infinity", "199", 12.5, NaN, Infinity, 99999, null, undefined, {}];
  for (const raw of rejected) {
    test(`rejects ${String(raw)}`, () => {
      expect(parseIntStrict(raw, 200, 7680).ok).toBe(false);
    });
  }

  test("explains a blank value in plain English", () => {
    expect(parseIntStrict("", 200, 7680)).toEqual({ ok: false, reason: "is blank" });
  });
});

describe("validateCaptureOptions", () => {
  test("accepts a complete valid request", () => {
    expect(validateCaptureOptions(baseOptions).ok).toBe(true);
  });

  test("names the field and the reason in the message", () => {
    const result = validateCaptureOptions({ ...baseOptions, width: "0" });
    expect(result).toEqual({ ok: false, fields: ["width"], message: "Width must be at least 200." });
  });

  test("accepts DPR given as a select string", () => {
    const result = validateCaptureOptions({ ...baseOptions, dpr: "1.5" });
    expect(result.ok && result.value.dpr).toBe(1.5);
  });

  test("rejects a DPR outside the supported list", () => {
    expect(validateCaptureOptions({ ...baseOptions, dpr: 4 })).toMatchObject({ ok: false, fields: ["dpr"] });
  });

  test("rejects unknown modes and formats", () => {
    expect(validateCaptureOptions({ ...baseOptions, mode: "tiles" })).toMatchObject({ ok: false, fields: ["mode"] });
    expect(validateCaptureOptions({ ...baseOptions, format: "webp" })).toMatchObject({ ok: false, fields: ["format"] });
  });

  test("uses the default quality when none is given", () => {
    const { quality: _omit, ...rest } = baseOptions;
    const result = validateCaptureOptions(rest);
    expect(result.ok && result.value.quality).toBe(LIMITS.defaultQuality);
  });

  test("rejects a missing options object", () => {
    expect(validateCaptureOptions(undefined)).toMatchObject({ ok: false });
  });
});

describe("assessOutput", () => {
  test("1440 × 900 at 1× is ok and gives 1440 × 900 px", () => {
    expect(assessOutput(1440, 900, 1)).toMatchObject({ outW: 1440, outH: 900, verdict: "ok" });
  });

  test("DPR multiplies the output size", () => {
    expect(assessOutput(1440, 900, 2)).toMatchObject({ outW: 2880, outH: 1800, verdict: "ok" });
  });

  test("about 64 MP asks for confirmation", () => {
    expect(assessOutput(4000, 4000, 2).verdict).toBe("confirm");
  });

  test("225 MP is refused on total pixels", () => {
    const result = assessOutput(5000, 5000, 3);
    expect(result.verdict).toBe("reject");
    expect(result.message).toContain("MP");
  });

  test("a side above the per-side limit is refused", () => {
    const result = assessOutput(9000, 1000, 2);
    expect(result.verdict).toBe("reject");
    expect(result.message).toContain("limit per side");
  });

  test("megapixel formatting keeps one decimal", () => {
    expect(toMegapixels(46_080_000)).toBe(46.1);
  });
});

describe("allowedDprs and validateRequest", () => {
  test("6K allows 1×, 1.5× and 2× but not 3× (3× would be over the per-side limit)", () => {
    expect(allowedDprs(6144, 3456, "viewport")).toEqual([1, 1.5, 2]);
  });

  test("full page uses a height estimate so impossible density options are disabled", () => {
    // 7680px full page at 1.5x is ~104 MP with the estimated height — over the 100 MP budget.
    expect(allowedDprs(7680, 0, "fullpage")).toEqual([1]);
    expect(allowedDprs(1440, 0, "fullpage")).toEqual([1, 1.5, 2]);
    // 6K at 2x full page would be ~245 MP at the estimated height — refuse it up front.
    expect(allowedDprs(6144, 0, "fullpage")).toEqual([1, 1.5]);
  });

  test("validateRequest refuses an oversized full-page density before capture", () => {
    const result = validateRequest({ ...baseOptions, mode: "fullpage", width: 6144, height: 3456, dpr: 2 });
    expect(result).toMatchObject({ ok: false, fields: ["width", "height", "dpr"] });
  });

  test("validateRequest refuses an oversized viewport and names both size fields", () => {
    const result = validateRequest({ ...baseOptions, width: 5000, height: 5000, dpr: 3 });
    expect(result).toMatchObject({ ok: false, fields: ["width", "height", "dpr"] });
  });

  test("validateRequest accepts a normal size", () => {
    expect(validateRequest(baseOptions).ok).toBe(true);
  });

  test("region and element modes keep all densities and defer the size gate", () => {
    expect(allowedDprs(6144, 0, "region")).toEqual([1, 1.5, 2, 3]);
    expect(allowedDprs(6144, 0, "element")).toEqual([1, 1.5, 2, 3]);
    expect(validateRequest({ ...baseOptions, mode: "region", width: 7680, height: 5000, dpr: 3 }).ok).toBe(true);
  });

  test("accepts the new tool options and a valid delay", () => {
    const result = validateCaptureOptions({
      ...baseOptions,
      delay: "5",
      darkMode: true,
      hideFixed: true,
      saveAs: true,
      copyToClipboard: true,
      annotate: true,
      region: { x: 10, y: 20, width: 800, height: 600 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.delay).toBe(5);
      expect(result.value.darkMode).toBe(true);
      expect(result.value.hideFixed).toBe(true);
      expect(result.value.saveAs).toBe(true);
      expect(result.value.copyToClipboard).toBe(true);
      expect(result.value.annotate).toBe(true);
      expect(result.value.region).toEqual({ x: 10, y: 20, width: 800, height: 600 });
    }
  });

  test("theme and overlay motion are validated and default sensibly", () => {
    const dark = validateCaptureOptions({ ...baseOptions, theme: "dark", overlayMotion: true });
    expect(dark.ok && dark.value.theme).toBe("dark");
    expect(dark.ok && dark.value.overlayMotion).toBe(true);

    const off = validateCaptureOptions({ ...baseOptions, theme: "light", overlayMotion: false });
    expect(off.ok && off.value.theme).toBe("light");
    expect(off.ok && off.value.overlayMotion).toBe(false);

    // Any unexpected theme string is treated as light; a missing motion flag keeps animations on.
    const fallback = validateCaptureOptions({ ...baseOptions, theme: "neon" });
    expect(fallback.ok && fallback.value.theme).toBe("light");
    expect(fallback.ok && fallback.value.overlayMotion).toBe(true);
  });

  test("picker timeout defaults off and can be enabled", () => {
    const off = validateCaptureOptions({ ...baseOptions });
    expect(off.ok && off.value.pickTimeout).toBe(false);
    const on = validateCaptureOptions({ ...baseOptions, pickTimeout: true });
    expect(on.ok && on.value.pickTimeout).toBe(true);
  });

  test("rejects an invalid delay and a malformed region", () => {
    expect(validateCaptureOptions({ ...baseOptions, delay: 7 }).ok).toBe(false);
    // Malformed region geometry is ignored, not trusted — the worker picks the real region.
    const bad = validateCaptureOptions({ ...baseOptions, region: { x: 0, y: 0, width: -4, height: 10 } });
    expect(bad.ok).toBe(true);
    if (bad.ok) expect(bad.value.region).toBeUndefined();
  });
});
