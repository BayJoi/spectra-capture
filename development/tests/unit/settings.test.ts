import { describe, expect, test } from "bun:test";
import { DEFAULT_PREFS, PREFS_KEY, loadPrefs, resetPrefs, sanitizePrefs, savePrefs } from "../../../src/settings/settings-store";
import { MAX_SAVED_SIZES } from "../../../src/settings/presets";
import { MemoryArea } from "./helpers";

describe("sanitizePrefs", () => {
  test("drops every key that is not a preference, including URLs and titles", () => {
    const dirty = {
      width: 1000,
      height: 700,
      url: "https://bank.example/account",
      title: "Private statement",
      tabId: 3,
      dpr: 2,
      savedSizes: [{ id: "x", label: "https://bank.example title", width: 800, height: 600, dpr: 1, url: "x" }],
    };
    const clean = sanitizePrefs(dirty);
    expect(Object.keys(clean).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
    expect(JSON.stringify(clean)).not.toContain("bank");
    expect(clean.savedSizes[0]).toEqual({ id: "saved-800x600@1", label: "Saved", width: 800, height: 600, dpr: 1 });
  });

  test("falls back to defaults for every invalid field", () => {
    const clean = sanitizePrefs({ width: "0", height: 1e9, dpr: 4, mode: "tiles", format: "webp", quality: 5, ratio: "7:3", theme: "blue" });
    expect(clean).toEqual(DEFAULT_PREFS);
  });

  test("accepts numeric strings from older or hand-edited storage", () => {
    expect(sanitizePrefs({ width: "1366" }).width).toBe(1366);
  });

  test("keeps a valid ratio and theme, and turns motion on unless it is turned off", () => {
    expect(sanitizePrefs({ ratio: "16:9", theme: "dark", motion: false })).toMatchObject({ ratio: "16:9", theme: "dark", motion: false });
    expect(sanitizePrefs({}).motion).toBe(true);
  });

  test("notifications are on by default and can be turned off", () => {
    expect(sanitizePrefs({}).notifications).toBe(true);
    expect(sanitizePrefs({ notifications: false }).notifications).toBe(false);
    expect(sanitizePrefs({ notifications: true }).notifications).toBe(true);
  });

  test("inherited and polluted prototype properties are ignored", () => {
    const inherited = Object.create({ width: 1000, theme: "dark", notifications: false });
    const clean = sanitizePrefs(inherited);
    expect(clean.width).toBe(DEFAULT_PREFS.width);
    expect(clean.theme).toBe(DEFAULT_PREFS.theme);
    expect(clean.notifications).toBe(true);
    expect(Object.keys(clean).sort()).toEqual(Object.keys(DEFAULT_PREFS).sort());
  });

  test("picker timeout is off by default", () => {
    expect(sanitizePrefs({}).pickTimeout).toBe(false);
    expect(sanitizePrefs({ pickTimeout: true }).pickTimeout).toBe(true);
  });

  test("keeps only the newest saved sizes", () => {
    const sizes = Array.from({ length: 9 }, (_, i) => ({ width: 300 + i, height: 400, dpr: 1 }));
    expect(sanitizePrefs({ savedSizes: sizes }).savedSizes).toHaveLength(MAX_SAVED_SIZES);
  });

  test("handles non-object input", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
  });
});

describe("settings storage", () => {
  test("empty storage gives the defaults", async () => {
    expect(await loadPrefs(new MemoryArea())).toEqual(DEFAULT_PREFS);
  });

  test("save then load round-trips and stores only the prefs key", async () => {
    const area = new MemoryArea();
    await savePrefs(area, { ...DEFAULT_PREFS, width: 1280, height: 720, dpr: 1.5, format: "jpeg", quality: 80, theme: "dark" });
    expect(Object.keys(area.data)).toEqual([PREFS_KEY]);
    expect(await loadPrefs(area)).toMatchObject({ width: 1280, height: 720, dpr: 1.5, format: "jpeg", quality: 80, theme: "dark" });
  });

  test("reset restores the defaults and clears saved sizes", async () => {
    const area = new MemoryArea();
    await savePrefs(area, { ...DEFAULT_PREFS, width: 1111, savedSizes: [{ id: "x", label: "x", width: 500, height: 500, dpr: 1 }] });
    expect(await resetPrefs(area)).toEqual({ ...DEFAULT_PREFS, savedSizes: [] });
    expect(await loadPrefs(area)).toEqual(DEFAULT_PREFS);
  });
});
