import { describe, expect, test } from "bun:test";
import { isCapturableUrl, runCapture } from "../../../src/capture/capture-controller";
import { WARM_UP_EXPRESSION } from "../../../src/capture/page-metrics";
import { FakeTransport, baseOptions, makeEnv } from "./helpers";

const viewport = (overrides: Record<string, unknown> = {}) => ({ ...baseOptions, ...overrides });
const fullpage = (overrides: Record<string, unknown> = {}) => ({ ...baseOptions, mode: "fullpage", ...overrides });

describe("viewport capture", () => {
  test("emulates, captures, verifies, detaches in the right order, and names the file", async () => {
    const fake = new FakeTransport();
    fake.imageWidth = 2880;
    fake.imageHeight = 1800;
    const harness = makeEnv(fake);

    const result = await runCapture("job-1", viewport({ width: 1440, height: 900, dpr: 2 }), harness.env);

    expect(result).toEqual({ filename: "spectra-capture_1440x900_dpr2_viewport_2026-11-14_09-05-07.png", width: 2880, height: 1800 });
    expect(fake.attachCalls).toEqual(["1.3"]);
    expect(fake.paramsFor("Emulation.setDeviceMetricsOverride")).toEqual({
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    expect(fake.paramsFor("Page.captureScreenshot")).toEqual({
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    expect(fake.methods()).toEqual([
      // Stale-overlay cleanup runs first on every capture, then the normal flow.
      "Overlay.setInspectMode",
      "Overlay.hideHighlight",
      "Runtime.evaluate",
      "Emulation.setDeviceMetricsOverride",
      "Runtime.evaluate",
      "Page.captureScreenshot",
      "Emulation.clearDeviceMetricsOverride",
      "Debugger.detach",
    ]);
    expect(harness.saved).toHaveLength(1);
    expect(harness.saved[0]?.mime).toBe("image/png");
  });

  test("JPEG sends a quality value, PNG does not", async () => {
    const fake = new FakeTransport();
    fake.imageWidth = 1440;
    fake.imageHeight = 900;
    await runCapture("j", viewport({ format: "jpeg", quality: 80 }), makeEnv(fake).env);
    expect(fake.paramsFor("Page.captureScreenshot")).toMatchObject({ format: "jpeg", quality: 80 });
  });

  test("warm-up runs the bounded scroll expression and logs the step count", async () => {
    const fake = new FakeTransport();
    fake.imageWidth = 1440;
    fake.imageHeight = 900;
    const harness = makeEnv(fake);
    await runCapture("j", viewport({ warmUp: true }), harness.env);
    const expressions = fake.calls.map((c) => c.params?.expression);
    expect(expressions).toContain(WARM_UP_EXPRESSION);
    expect(harness.logs.some((l) => l.message.includes("Scrolled 3 step(s)"))).toBe(true);
  });

  test("refuses output that is too large before touching the browser", async () => {
    const fake = new FakeTransport();
    await expect(runCapture("j", viewport({ width: 5000, height: 5000, dpr: 3 }), makeEnv(fake).env)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    expect(fake.attachCalls).toEqual([]);
    expect(fake.methods()).toEqual([]);
  });

  test("a wrong-size image is refused, not saved, and cleanup still runs", async () => {
    const fake = new FakeTransport();
    fake.imageWidth = 1440;
    fake.imageHeight = 900;
    const harness = makeEnv(fake);
    await expect(runCapture("j", viewport({ width: 1440, height: 900, dpr: 2 }), harness.env)).rejects.toMatchObject({
      code: "IMAGE_INVALID",
    });
    expect(harness.saved).toHaveLength(0);
    expect(fake.clearCount).toBe(1);
    expect(fake.detachCount).toBe(1);
  });
});

describe("full-page capture", () => {
  test("uses the CSS content height in an explicit clip with captureBeyondViewport", async () => {
    const fake = new FakeTransport();
    fake.contentSize = { x: 0, y: 0, width: 1440, height: 3200.2 };
    fake.imageWidth = 2880;
    fake.imageHeight = 6402;
    const harness = makeEnv(fake);

    const result = await runCapture("j", fullpage({ width: 1440, height: 900, dpr: 2 }), harness.env);

    expect(fake.paramsFor("Page.captureScreenshot")).toEqual({
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1440, height: 3201, scale: 1 },
    });
    expect(result).toMatchObject({ width: 2880, height: 6402 });
  });

  test("asks for confirmation above the threshold, and cleans up while asking", async () => {
    const fake = new FakeTransport();
    fake.contentSize = { x: 0, y: 0, width: 1920, height: 6000 };
    const harness = makeEnv(fake);

    await expect(runCapture("j", fullpage({ width: 1920, height: 900, dpr: 2 }), harness.env)).rejects.toMatchObject({
      code: "CONFIRM_REQUIRED",
      details: { pixels: 46_080_000 },
    });
    expect(fake.detachCount).toBe(1);
    expect(harness.saved).toHaveLength(0);
  });

  test("completes once the user confirms", async () => {
    const fake = new FakeTransport();
    fake.contentSize = { x: 0, y: 0, width: 1920, height: 6000 };
    fake.imageWidth = 3840;
    fake.imageHeight = 12000;
    const harness = makeEnv(fake);
    const result = await runCapture("j", fullpage({ width: 1920, height: 900, dpr: 2, confirmLarge: true }), harness.env);
    expect(result).toMatchObject({ width: 3840, height: 12000 });
    expect(harness.saved).toHaveLength(1);
  });

  test("refuses a page whose output exceeds the per-side limit, after measuring it", async () => {
    const fake = new FakeTransport();
    fake.contentSize = { x: 0, y: 0, width: 1440, height: 6000 };
    await expect(runCapture("j", fullpage({ width: 1440, height: 900, dpr: 3 }), makeEnv(fake).env)).rejects.toMatchObject({
      code: "TOO_LARGE",
    });
    expect(fake.detachCount).toBe(1);
  });
});

describe("failure and cleanup", () => {
  test("a protocol error is reported as PROTOCOL and cleanup still clears and detaches", async () => {
    const fake = new FakeTransport();
    fake.captureError = new Error("internal detail");
    const harness = makeEnv(fake);
    await expect(runCapture("j", viewport(), harness.env)).rejects.toMatchObject({ code: "PROTOCOL" });
    expect(fake.clearCount).toBe(1);
    expect(fake.detachCount).toBe(1);
    expect(harness.saved).toHaveLength(0);
  });

  test("a hung screenshot times out and cleanup still runs", async () => {
    const fake = new FakeTransport();
    fake.hangOnCapture = true;
    const harness = makeEnv(fake, { timeouts: { capture: 40 } });
    await expect(runCapture("j", viewport(), harness.env)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fake.clearCount).toBe(1);
    expect(fake.detachCount).toBe(1);
  });

  test("navigating before the page is ready is refused and cleaned up", async () => {
    const fake = new FakeTransport();
    const harness = makeEnv(fake, { navigated: true });
    await expect(runCapture("j", viewport(), harness.env)).rejects.toMatchObject({ code: "NAVIGATED" });
    expect(fake.detachCount).toBe(1);
    expect(harness.disposed()).toBe(1);
  });

  test("navigating during the capture discards the image", async () => {
    const fake = new FakeTransport();
    fake.imageWidth = 1440;
    fake.imageHeight = 900;
    const harness = makeEnv(fake);
    fake.onCapture = () => harness.setNavigated(true);
    await expect(runCapture("j", viewport(), harness.env)).rejects.toMatchObject({ code: "NAVIGATED" });
    expect(harness.saved).toHaveLength(0);
    expect(fake.detachCount).toBe(1);
  });

  test("the user cancelling the browser banner mid-capture never triggers a detach of ours", async () => {
    const fake = new FakeTransport();
    fake.imageWidth = 1440;
    fake.imageHeight = 900;
    const harness = makeEnv(fake);
    fake.onCapture = () => fake.emitDetach(7, "canceled_by_user");
    await expect(runCapture("j", viewport(), harness.env)).rejects.toMatchObject({ code: "DETACHED" });
    expect(fake.detachCount).toBe(0);
    expect(fake.clearCount).toBe(0);
    expect(harness.saved).toHaveLength(0);
  });

  test("another debugger on the tab is refused without attaching or detaching anything", async () => {
    const fake = new FakeTransport();
    fake.targets = [{ tabId: 7, attached: true }];
    await expect(runCapture("j", viewport(), makeEnv(fake).env)).rejects.toMatchObject({ code: "DEBUGGER_BUSY" });
    expect(fake.attachCalls).toEqual([]);
    expect(fake.detachCount).toBe(0);
  });

  test("an enterprise policy block is reported distinctly", async () => {
    const fake = new FakeTransport();
    fake.attachError = new Error("Screenshot capture is restricted by policy.");
    await expect(runCapture("j", viewport(), makeEnv(fake).env)).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(fake.detachCount).toBe(0);
  });

  test("error text from the browser that contains a URL is never echoed", async () => {
    const fake = new FakeTransport();
    fake.attachError = new Error("Cannot access https://private.example/account");
    const err = await runCapture("j", viewport(), makeEnv(fake).env).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "RESTRICTED_URL" });
    expect(String((err as Error).message)).not.toContain("private.example");
  });
});

describe("refusals before any browser work", () => {
  test("invalid input is refused with the field name", async () => {
    const fake = new FakeTransport();
    const err = await runCapture("j", viewport({ width: "0" }), makeEnv(fake).env).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "INVALID_INPUT" });
    expect((err as Error).message).toContain("Width");
    expect(fake.methods()).toEqual([]);
  });

  test("restricted pages are refused and nothing is attached", async () => {
    const fake = new FakeTransport();
    const harness = makeEnv(fake, { url: "chrome-extension://abcd/secret-page.html" });
    const err = await runCapture("j", viewport(), harness.env).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "RESTRICTED_URL" });
    expect((err as Error).message).not.toContain("secret");
    expect(fake.attachCalls).toEqual([]);
  });

  test("no active tab is reported", async () => {
    const fake = new FakeTransport();
    const harness = makeEnv(fake);
    await expect(runCapture("j", viewport(), { ...harness.env, getActiveTab: async () => undefined })).rejects.toMatchObject({
      code: "NO_ACTIVE_TAB",
    });
  });
});

describe("isCapturableUrl", () => {
  test("accepts http and https only", () => {
    expect(isCapturableUrl("https://example.com/")).toBe(true);
    expect(isCapturableUrl("http://localhost:8000/fixture.html")).toBe(true);
    expect(isCapturableUrl("http://127.0.0.1:5173/")).toBe(true);
    expect(isCapturableUrl("http://192.168.1.20:8080/local.html")).toBe(true);
    for (const url of ["chrome://settings", "chrome-extension://x/y", "file:///etc/hosts", "about:blank", "javascript:alert(1)", "", undefined, "not a url"]) {
      expect(isCapturableUrl(url)).toBe(false);
    }
  });
});
