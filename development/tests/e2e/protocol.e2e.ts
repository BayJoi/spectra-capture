/**
 * REAL-BROWSER TEST. It runs the production capture controller (src/capture) against a real
 * Chromium. Only the chrome.debugger wrapper is swapped for a DevTools websocket with the same
 * protocol calls. The popup, the download path and the offscreen document are NOT tested here.
 *
 *   CHROME_PATH="/path/to/chromium-or-chrome" bun run e2e
 *
 * Without CHROME_PATH the test is skipped (exit code 0).
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCapture, type CaptureEnv } from "../../../src/capture/capture-controller";
import { readImageInfo } from "../../../src/capture/image-validation";
import { applyViewport, clearViewport } from "../../../src/capture/viewport-emulation";
import { decodeBase64 } from "../../../src/shared/base64";
import { CaptureError } from "../../../src/shared/errors";
import type { CaptureOptions } from "../../../src/shared/types";
import { DevToolsTransport, launchBrowser, openPage } from "./devtools";

const binary = process.env.CHROME_PATH;
if (!binary) {
  console.log("SKIPPED: set CHROME_PATH to a Chromium-based browser binary to run the real-browser test.");
  process.exit(0);
}

const FIXTURES = join(import.meta.dir, "../fixtures");
const OUT = join(process.env.TMPDIR ?? "/tmp", "spectra-e2e");
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.includes("..")) return new Response("not found", { status: 404 });
    const file = Bun.file(join(FIXTURES, path === "/" ? "normal-page.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
const base = `http://127.0.0.1:${server.port}`;

const port = 9400 + Math.floor(Math.random() * 300);
const browserHandle = await launchBrowser(binary, port, join(OUT, "profile"));
const pageUrls = new Map<number, string>([[1, await openPage(browserHandle.browser, port)]]);
const transport = new DevToolsTransport(pageUrls);

async function navigate(path: string): Promise<void> {
  const url = `${base}/${path}`;
  await transport.attach(1);
  await transport.send(1, "Page.navigate", { url });
  for (let i = 0; i < 200; i++) {
    const state = await transport.send<{ result: { value: string } }>(1, "Runtime.evaluate", {
      expression: "location.href + '|' + document.readyState",
      returnByValue: true,
    });
    if (state.result.value === `${url}|complete`) break;
    await Bun.sleep(100);
  }
  await transport.detach(1);
}

interface Row {
  name: string;
  expected: string;
  actual: string;
  ms: number;
  pass: boolean;
}
const rows: Row[] = [];

function options(over: Partial<CaptureOptions>): CaptureOptions {
  return {
    theme: "light", overlayMotion: true, pickTimeout: false,
    width: 1440, height: 900, dpr: 1, mode: "viewport", format: "png",
    quality: 92, warmUp: false, confirmLarge: false,
    delay: 0, darkMode: false, hideFixed: false, saveAs: false,
    copyToClipboard: false, annotate: false, ...over,
  };
}

async function runCase(
  name: string,
  page: string,
  over: Partial<CaptureOptions>,
  expected: { w?: number; h?: number; minH?: number; code?: string },
  tabUrl?: string,
): Promise<void> {
  await navigate(page);
  const saved: { bytes: Uint8Array }[] = [];
  const env: CaptureEnv = {
    transport,
    async getActiveTab() {
      return { id: 1, url: tabUrl ?? `${base}/${page}` };
    },
    watchNavigation: () => ({ aborted: () => false, dispose: () => undefined }),
    async saveImage(_jobId, base64, _mime, filename) {
      const bytes = decodeBase64(base64);
      saved.push({ bytes });
      await writeFile(join(OUT, filename), bytes);
    },
    report: () => undefined,
    log: { info() {}, progress() {}, success() {}, warn() {}, error() {} },
    now: () => new Date(2026, 10, 14, 9, 5, 7),
  };

  const started = performance.now();
  let actual: string;
  let pass: boolean;
  try {
    const result = await runCapture("e2e", options(over), env);
    actual = `${result.width} × ${result.height}`;
    const okSize =
      (expected.w === undefined || result.width === expected.w) &&
      (expected.h === undefined || result.height === expected.h) &&
      (expected.minH === undefined || result.height >= expected.minH);
    const file = saved[0];
    const info = file ? readImageInfo(file.bytes) : null;
    pass = okSize && expected.code === undefined && info?.width === result.width && info?.height === result.height;
  } catch (err) {
    const code = err instanceof CaptureError ? err.code : "UNEXPECTED";
    actual = `refused: ${code}`;
    pass = expected.code === code;
    if (!(err instanceof CaptureError)) actual += ` (${String(err)})`;
  }
  const expectedText = expected.code
    ? `refused: ${expected.code}`
    : `${expected.w ?? "any"} × ${expected.minH ? `≥${expected.minH}` : expected.h ?? "any"}`;
  rows.push({ name, expected: expectedText, actual, ms: Math.round(performance.now() - started), pass });
}

// --- Viewport and device sizes (the presets) ---
await runCase("Desktop 1440 × 900 at 1×", "normal-page.html", { width: 1440, height: 900 }, { w: 1440, h: 900 });
await runCase("Spec example 1440 × 900 at 2× = 2880 × 1800", "normal-page.html", { width: 1440, height: 900, dpr: 2 }, { w: 2880, h: 1800 });
await runCase("Phone 390 × 844 at 3×", "normal-page.html", { width: 390, height: 844, dpr: 3 }, { w: 1170, h: 2532 });
await runCase("Tablet 768 × 1024 at 2×", "normal-page.html", { width: 768, height: 1024, dpr: 2 }, { w: 1536, h: 2048 });
await runCase("Laptop 1366 × 768 as JPEG", "normal-page.html", { width: 1366, height: 768, format: "jpeg", quality: 80 }, { w: 1366, h: 768 });
await runCase("Full HD 1920 × 1080", "normal-page.html", { width: 1920, height: 1080 }, { w: 1920, h: 1080 });

// --- Resolution presets: they must always pass the limits ---
await runCase("4K UHD 3840 × 2160 at 1×", "normal-page.html", { width: 3840, height: 2160 }, { w: 3840, h: 2160 });
await runCase("8K UHD 7680 × 4320 at 1×", "normal-page.html", { width: 7680, height: 4320 }, { w: 7680, h: 4320 });

// --- Full page ---
await runCase("Full page, long page 1440 × 900 at 1× = 1440 × 12000", "long-page.html", { width: 1440, height: 900, mode: "fullpage" }, { w: 1440, h: 12000 });
await runCase("Full page, fixed and sticky elements", "fixed-elements.html", { width: 1440, height: 900, mode: "fullpage" }, { w: 1440, minH: 900 });
await runCase("Full page with 'Scroll once' on lazy images", "lazy-images.html", { width: 1440, height: 900, mode: "fullpage", warmUp: true }, { w: 1440, minH: 2000 });

// --- Limits and refusals ---
await runCase("6K at 3× is refused before the browser is touched", "normal-page.html", { width: 6144, height: 3456, dpr: 3 }, { code: "TOO_LARGE" });
await runCase("Full page at 2× of 12000 px = 24000 px tall is refused", "long-page.html", { width: 1440, height: 900, dpr: 2, mode: "fullpage" }, { code: "TOO_LARGE" });
await runCase("Browser pages (chrome://) are refused", "normal-page.html", { width: 1440, height: 900 }, { code: "RESTRICTED_URL" }, "chrome://settings/");

// --- Aspect ratio: does the page lay itself out again for the new shape? ---
await navigate("viewport-units.html");
await transport.attach(1);
const cdp = { send: <T>(method: string, params?: Record<string, unknown>) => transport.send<T>(1, method, params) };
const heroSize = async (): Promise<string> => {
  const r = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
    expression: "`${innerWidth} x ${innerHeight} | hero ${Math.round(document.querySelector('.hero').getBoundingClientRect().height)} px tall`",
    returnByValue: true,
  });
  return r.result.value;
};
const shapes: Array<[string, number, number]> = [
  ["16:9 landscape 1920 × 1080", 1920, 1080],
  ["9:16 portrait 1080 × 1920", 1080, 1920],
  ["Phone 390 × 844", 390, 844],
];
for (const [name, w, h] of shapes) {
  await applyViewport(cdp, w, h, 1);
  await Bun.sleep(300);
  const actual = await heroSize();
  rows.push({ name: `Aspect ratio re-layout: ${name}`, expected: `hero ${h} px`, actual, ms: 0, pass: actual.startsWith(`${w} x`) && actual.includes(`hero ${h} px`) });
}
await clearViewport(cdp);
await transport.detach(1);

// --- Report ---
console.log("\nSpectra Capture · real-browser test");
console.log(`Browser: ${binary}`);
console.log("─".repeat(96));
for (const r of rows) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(56)} expected ${r.expected.padEnd(16)} got ${r.actual}${r.ms ? ` (${r.ms} ms)` : ""}`);
}
const failed = rows.filter((r) => !r.pass).length;
console.log("─".repeat(96));
console.log(`${rows.length - failed} passed, ${failed} failed. Output files: ${OUT}`);

browserHandle.browser.close();
browserHandle.stop();
server.stop();
process.exit(failed === 0 ? 0 : 1);
