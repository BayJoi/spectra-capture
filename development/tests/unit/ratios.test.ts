import { describe, expect, test } from "bun:test";
import { FREE, heightFor, isRatioId, ratioOfSize, widthFor } from "../../../src/validation/ratios";

describe("aspect ratios", () => {
  test("a locked ratio gives the matching height", () => {
    expect(heightFor(1920, "16:9")).toBe(1080);
    expect(heightFor(1440, "16:10")).toBe(900);
    expect(heightFor(1000, "4:5")).toBe(1250);
  });

  test("a locked ratio gives the matching width", () => {
    expect(widthFor(1080, "16:9")).toBe(1920);
    expect(widthFor(900, "16:10")).toBe(1440);
  });

  test("a free ratio locks nothing", () => {
    expect(heightFor(1234, FREE)).toBeNull();
    expect(widthFor(567, FREE)).toBeNull();
  });

  test("a size reports the ratio it matches, or free when none matches", () => {
    expect(ratioOfSize(3840, 2160)).toBe("16:9");
    expect(ratioOfSize(1440, 900)).toBe("16:10");
    expect(ratioOfSize(1234, 567)).toBe(FREE);
  });

  test("only the listed ratios and free are accepted", () => {
    expect(isRatioId("4:5")).toBe(true);
    expect(isRatioId(FREE)).toBe(true);
    expect(isRatioId("7:3")).toBe(false);
    expect(isRatioId(undefined)).toBe(false);
  });
});
