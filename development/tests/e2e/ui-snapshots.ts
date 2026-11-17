/**
 * Renders the real popup in a real Chromium, with a stand-in for chrome.storage, and saves
 * screenshots. It checks the look, not the behaviour. Run `bun run build` first.
 *
 *   CHROME_PATH="/path/to/chromium" bun run snapshots
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_PREFS } from "../../../src/settings/settings-store";
import { DevToolsTransport, launchBrowser, openPage } from "./devtools";

const binary = process.env.CHROME_PATH;
if (!binary) {
  console.log("SKIPPED: set CHROME_PATH to a Chromium-based browser binary to run the snapshots.");
  process.exit(0);
}

const DIST = process.env.SPECTRA_DIST ?? join(import.meta.dir, "../../../dist");
const OUT = join(process.env.TMPDIR ?? "/tmp", "spectra-ui");
await mkdir(OUT, { recursive: true });

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.includes("..")) return new Response("not found", { status: 404 });
    const file = Bun.file(join(DIST, path === "/" ? "popup.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

/** A stand-in for chrome.storage and chrome.runtime. The popup code itself is the real one. */
const stub = (state: Record<string, unknown>): string => `
  window.__STUB = ${JSON.stringify(state)};
  (() => {
    const make = (data) => ({
      async get(key) { const out = {}; for (const k of Array.isArray(key) ? key : [key]) if (data[k] !== undefined) out[k] = data[k]; return out; },
      async set(items) { Object.assign(data, items); },
    });
    window.chrome = {
      storage: { local: make({ prefs: window.__STUB.prefs }), session: make({ job: window.__STUB.job, logs: window.__STUB.logs }), onChanged: { addListener() {} } },
      runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: true, jobId: "demo" }), getURL: (p) => p },
      tabs: { create() {} },
    };
  })();`;

const now = Date.now();
const logs = [
  { id: "1", time: now - 9000, level: "progress", source: "sw", message: "Capture started." },
  { id: "2", time: now - 8000, level: "info", source: "sw", message: "Debugger attached (protocol 1.3)." },
  { id: "3", time: now - 6000, level: "warn", source: "sw", message: "The image is 2881 × 1800 px (expected 2880 × 1800). Accepted as rounding." },
  { id: "4", time: now - 4000, level: "success", source: "sw", message: "Saved spectra-capture_1440x900_dpr2_viewport_2026-11-14_09-05-07.png (2880 × 1800 px)." },
];

const scenarios: Array<{ name: string; prefs: Record<string, unknown>; job?: Record<string, unknown>; logs?: unknown[]; open?: boolean }> = [
  { name: "light-idle", prefs: { ...DEFAULT_PREFS, width: 1440, height: 900, dpr: 1, ratio: "16:10" } },
  { name: "dark-idle", prefs: { ...DEFAULT_PREFS, width: 2160, height: 1440, dpr: 3, ratio: "3:2", theme: "dark" } },
  { name: "light-done-console", prefs: { ...DEFAULT_PREFS, width: 2160, height: 1440, dpr: 3, ratio: "3:2" }, job: { jobId: "demo", status: "done", step: "Saved", progress: 5, updatedAt: now }, logs, open: true },
  { name: "dark-running", prefs: { ...DEFAULT_PREFS, width: 3840, height: 2160, dpr: 1, ratio: "16:9", theme: "dark", mode: "fullpage" }, job: { jobId: "demo", status: "running", step: "Capturing", progress: 4, updatedAt: now } },
  { name: "light-needs-confirm", prefs: { ...DEFAULT_PREFS, width: 4000, height: 4000, dpr: 2, ratio: "1:1" }, job: { jobId: "demo", status: "needs-confirm", step: "Waiting for confirmation", pixels: 64000000, progress: 4, updatedAt: now } },
];

const debugPort = 9800 + Math.floor(Math.random() * 150);
const browserHandle = await launchBrowser(binary, debugPort, join(OUT, "profile"));

for (const scenario of scenarios) {
  const transport = new DevToolsTransport(new Map([[1, await openPage(browserHandle.browser, debugPort)]]));
  await transport.attach(1);
  const send = <T>(method: string, params: Record<string, unknown> = {}) => transport.send<T>(1, method, params);
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: stub({ prefs: scenario.prefs, job: scenario.job, logs: scenario.logs ?? [] }),
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 380, height: 900, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/popup.html` });
  await Bun.sleep(1500);
  if (scenario.open) {
    // The Console is page tab 4; there is no separate console-toggle element.
    await send("Runtime.evaluate", { expression: "document.getElementById('tab-4').click()", returnByValue: true });
    await Bun.sleep(600);
  }
  const shot = await send<{ data: string }>("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await Bun.write(join(OUT, `${scenario.name}.png`), Buffer.from(shot.data, "base64"));
  console.log(`saved ${join(OUT, `${scenario.name}.png`)}`);
  await transport.detach(1);
}

browserHandle.browser.close();
browserHandle.stop();
server.stop();
