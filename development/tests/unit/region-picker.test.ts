import { describe, expect, test } from "bun:test";
import {
  ELEMENT_OVERLAY_EXPRESSION,
  REGION_OVERLAY_EXPRESSION,
  elementOverlayExpression,
  regionOverlayExpression,
} from "../../../src/capture/region-picker";

describe("injected picker expressions", () => {
  test("use the fixed light and dark palettes only", () => {
    const light = regionOverlayExpression({ theme: "light", motion: true });
    const dark = regionOverlayExpression({ theme: "dark", motion: true });
    expect(light).toContain('"accent":"#c2402b"');
    expect(dark).toContain('"accent":"#e0543d"');
    expect(light).toContain('"shadow":"4px 4px 0 #2e2118"');
    expect(dark).toContain('"shadow":"4px 4px 0 #ece4d2"');
  });

  test("carry no page-derived values and no legacy scan line or inset veil", () => {
    for (const expr of [REGION_OVERLAY_EXPRESSION, ELEMENT_OVERLAY_EXPRESSION]) {
      expect(expr).not.toContain('s.boxShadow = "inset');
      expect(expr).not.toContain("data-spectra-aura");
      expect(expr).toContain("data-spectra-runner");
      expect(expr).toContain("data-spectra-ticks");
    }
  });

  test("motion off hides the runner and drops the loops", () => {
    const still = regionOverlayExpression({ theme: "light", motion: false });
    expect(still).toContain('const MOTION = false');
    expect(still).toContain('runner.style.display = "none"');
    expect(elementOverlayExpression({ theme: "dark", motion: false })).toContain('const MOTION = false');
  });

  test("the element picker has a soft, bounce-free transition and a click-only finalize", () => {
    const expr = ELEMENT_OVERLAY_EXPRESSION;
    expect(expr).toContain(".28s");
    expect(expr).not.toContain("scale(1.03)");
    expect(expr).toContain('if (e.button !== 0) return');
  });
});
