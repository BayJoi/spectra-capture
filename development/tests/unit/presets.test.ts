import { describe, expect, test } from "bun:test";
import { ALL_PRESETS, DEVICE_PRESETS, MAX_SAVED_SIZES, MONITOR_PRESET_ID, addSavedSize, monitorPreset, removeSavedSize, sanitizePreset } from "../../../src/settings/presets";
import { LIMITS, assessOutput } from "../../../src/validation/dimensions";

describe("built-in presets never trigger a pixel-limit error", () => {
  for (const preset of ALL_PRESETS) {
    test(`${preset.id}: ${preset.width} × ${preset.height} at ${preset.dpr}× is ok`, () => {
      expect(assessOutput(preset.width, preset.height, preset.dpr).verdict).toBe("ok");
    });
  }

  test("preset ids are unique", () => {
    const ids = ALL_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every preset is inside the input limits", () => {
    for (const p of ALL_PRESETS) {
      expect(p.width).toBeGreaterThanOrEqual(LIMITS.minCss);
      expect(p.width).toBeLessThanOrEqual(LIMITS.maxCssWidth);
      expect(p.height).toBeLessThanOrEqual(LIMITS.maxCssHeight);
    }
  });

  test("the 8K preset is the largest and does not need confirmation", () => {
    const eightK = ALL_PRESETS.find((p) => p.id === "uhd8k");
    expect(eightK && assessOutput(eightK.width, eightK.height, eightK.dpr).verdict).toBe("ok");
  });

  test("device presets use their own density", () => {
    expect(DEVICE_PRESETS.find((p) => p.id === "phone")?.dpr).toBe(3);
  });
});

describe("monitor resolution preset", () => {
  test("detects a common resolution at 1x", () => {
    const p = monitorPreset(1920, 1080);
    expect(p).toEqual({
      id: MONITOR_PRESET_ID,
      label: expect.any(String),
      width: 1920,
      height: 1080,
      dpr: 1,
    });
  });

  test("stays inside the pixel limits for every supported monitor size", () => {
    const sizes: Array<[number, number]> = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [5120, 2880], [7680, 4320]];
    for (const [w, h] of sizes) {
      const p = monitorPreset(w, h);
      expect(p && assessOutput(p.width, p.height, p.dpr).verdict).toBe("ok");
    }
  });

  test("out-of-range or non-integer screens are refused, not clamped", () => {
    expect(monitorPreset(100, 100)).toBeNull();
    expect(monitorPreset(9000, 1080)).toBeNull();
    expect(monitorPreset(1920, 11000)).toBeNull();
    expect(monitorPreset(1920.5, 1080)).toBeNull();
  });

  test("inherited properties cannot forge a saved size", () => {
    const forged = Object.create({ width: 900, height: 700, dpr: 1 });
    // sanitizePreset is fed own keys only, so a prototype-only value produces null.
    expect(Object.keys(forged)).toHaveLength(0);
    expect(sanitizePreset(forged)).toBeNull();
  });

  test("the monitor preset is not part of the static built-in set", () => {
    expect(ALL_PRESETS.some((p) => p.id === MONITOR_PRESET_ID)).toBe(false);
  });
});

describe("saved sizes", () => {
  test("saving the same size twice does not add a duplicate", () => {
    const once = addSavedSize([], 1024, 768, 1);
    expect(addSavedSize(once, 1024, 768, 1)).toHaveLength(1);
  });

  test("the same size at another density is a different saved size", () => {
    expect(addSavedSize(addSavedSize([], 1024, 768, 1), 1024, 768, 2)).toHaveLength(2);
  });

  test("the list is capped and drops the oldest entry", () => {
    let list: ReturnType<typeof addSavedSize> = [];
    for (let i = 0; i < MAX_SAVED_SIZES + 2; i++) list = addSavedSize(list, 300 + i, 500, 1);
    expect(list).toHaveLength(MAX_SAVED_SIZES);
    expect(list[0]?.width).toBe(302);
  });

  test("removing a saved size by id", () => {
    const list = addSavedSize([], 900, 700, 1);
    expect(removeSavedSize(list, "saved-900x700@1")).toEqual([]);
  });
});
