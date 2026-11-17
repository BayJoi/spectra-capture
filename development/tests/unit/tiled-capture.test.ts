import { describe, expect, test } from "bun:test";
import { tileCssHeight } from "../../../src/capture/tiled-capture";
import { LIMITS } from "../../../src/validation/dimensions";

describe("tiled capture tile height", () => {
  for (const dpr of [1, 1.5, 2, 3]) {
    test(`stays under the per-side device-pixel cap at ${dpr}x`, () => {
      expect(tileCssHeight(dpr) * dpr).toBeLessThanOrEqual(LIMITS.maxOutputSide);
    });
  }

  test("shrinks as density grows", () => {
    expect(tileCssHeight(3)).toBeLessThan(tileCssHeight(1));
  });
});
