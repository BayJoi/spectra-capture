import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkDimensions, readImageInfo, readImageInfoFromBase64 } from "../../../src/capture/image-validation";
import { pngHeaderBase64 } from "./helpers";

describe("image header parsing", () => {
  test("reads PNG width and height from the IHDR chunk", () => {
    const bytes = new Uint8Array(Buffer.from(pngHeaderBase64(2880, 1800), "base64"));
    expect(readImageInfo(bytes)).toEqual({ format: "png", width: 2880, height: 1800 });
  });

  test("reads JPEG width and height from the start-of-frame marker", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20,
      0x00, 0x00, 0x00, 0x00,
    ]);
    expect(readImageInfo(jpeg)).toEqual({ format: "jpeg", width: 800, height: 600 });
  });

  test("returns null for data that is not an image", () => {
    expect(readImageInfo(new Uint8Array(32))).toBeNull();
  });

  test("reads the real extension icon file from disk", async () => {
    const bytes = new Uint8Array(await Bun.file(join(import.meta.dir, "../../../public/icons/icon-128.png")).arrayBuffer());
    expect(readImageInfo(bytes)).toEqual({ format: "png", width: 128, height: 128 });
  });

  test("base64 path returns null for corrupt input instead of throwing", () => {
    expect(readImageInfoFromBase64(`!!!!${"A".repeat(80)}`)).toBeNull();
  });

  test("base64 path reads a valid PNG header", () => {
    expect(readImageInfoFromBase64(pngHeaderBase64(640, 480))).toMatchObject({ width: 640, height: 480 });
  });
});

describe("checkDimensions", () => {
  test("exact match passes silently", () => {
    const check = checkDimensions({ format: "png", width: 2880, height: 1800 }, 2880, 1800);
    expect(check).toMatchObject({ ok: true });
    expect(check.ok && check.warning).toBeUndefined();
  });

  test("a small rounding difference passes with a warning", () => {
    const check = checkDimensions({ format: "png", width: 2881, height: 1800 }, 2880, 1800);
    expect(check.ok).toBe(true);
    expect(check.ok && check.warning).toContain("rounding");
  });

  test("a large mismatch is refused so a wrong file is never saved", () => {
    const check = checkDimensions({ format: "png", width: 1440, height: 900 }, 2880, 1800);
    expect(check.ok).toBe(false);
  });

  test("an unreadable header is refused", () => {
    expect(checkDimensions(null, 10, 10).ok).toBe(false);
  });
});
