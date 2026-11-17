import { describe, expect, test } from "bun:test";
import { buildFilename, formatStamp, safeDownloadName, sanitizeFilenamePart } from "../../../src/validation/filename";

const when = new Date(2026, 10, 14, 9, 5, 7);

describe("sanitizeFilenamePart", () => {
  test("replaces spaces, punctuation and separators", () => {
    expect(sanitizeFilenamePart("My Page: 1/2?*")).toBe("My_Page_1_2");
  });

  test("cannot produce path traversal", () => {
    const cleaned = sanitizeFilenamePart("../../etc/passwd");
    expect(cleaned).toBe("etc_passwd");
    expect(cleaned).not.toContain("/");
    expect(cleaned).not.toContain("..");
  });

  test("falls back to a generic name when nothing is left", () => {
    expect(sanitizeFilenamePart("!!!")).toBe("capture");
  });

  test("caps the length", () => {
    expect(sanitizeFilenamePart("a".repeat(300)).length).toBe(96);
  });
});

describe("formatStamp", () => {
  test("uses local time with zero padding", () => {
    expect(formatStamp(when)).toBe("2026-11-14_09-05-07");
  });
});

describe("safeDownloadName", () => {
  test("re-sanitizes a stored filename while keeping the right extension", () => {
    expect(safeDownloadName("../../etc/passwd.shot.png")).toBe("etc_passwd_shot.png");
    expect(safeDownloadName("notes.JPEG")).toBe("notes.jpg");
    expect(safeDownloadName("a/b")).toBe("a_b.png");
  });
});

describe("buildFilename", () => {
  test("builds a generic PNG name with the app name, size, density, mode and time", () => {
    expect(buildFilename({ width: 1440, height: 900, dpr: 2, mode: "viewport", format: "png" }, when)).toBe(
      "spectra-capture_1440x900_dpr2_viewport_2026-11-14_09-05-07.png",
    );
  });

  test("writes a fractional density with an underscore, not a dot", () => {
    const name = buildFilename({ width: 800, height: 600, dpr: 1.5, mode: "fullpage", format: "jpeg" }, when);
    expect(name).toContain("dpr1_5");
    expect(name.endsWith(".jpg")).toBe(true);
    expect(name.split(".").length).toBe(2);
  });

  test("never contains a page title or URL", () => {
    const name = buildFilename({ width: 390, height: 844, dpr: 1, mode: "fullpage", format: "png" }, when);
    expect(name).not.toMatch(/https?|www|\.com|title/i);
  });
});
