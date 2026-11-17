/**
 * REAL-BROWSER TEST of the popup's behaviour. It clicks and types in the real popup page, using
 * a stand-in for chrome.storage and chrome.runtime. It checks presets, locked aspect ratios,
 * density limits, validation, the theme switch, motion, and what would be sent to the worker.
 *
 *   CHROME_PATH="/path/to/chromium" bun run e2e
 */
import { join } from "node:path";
import { DEFAULT_PREFS } from "../../../src/settings/settings-store";
import { DevToolsTransport, launchBrowser, openPage } from "./devtools";

const binary = process.env.CHROME_PATH;
if (!binary) {
  console.log("SKIPPED: set CHROME_PATH to a Chromium-based browser binary to run the popup test.");
  process.exit(0);
}

const DIST = process.env.SPECTRA_DIST ?? join(import.meta.dir, "../../../dist");
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path.includes("..")) return new Response("not found", { status: 404 });
    const file = Bun.file(join(DIST, path === "/" ? "popup.html" : path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});

const stub = `(() => {
  window.__sent = [];
  const make = (data) => ({
    async get(key) { const out = {}; for (const k of Array.isArray(key) ? key : [key]) if (data[k] !== undefined) out[k] = data[k]; return out; },
    async set(items) { Object.assign(data, items); },
  });
  window.chrome = {
    storage: { local: make({ prefs: ${JSON.stringify(DEFAULT_PREFS)} }), session: make({}), onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener() {} }, sendMessage: async (message) => { window.__sent.push(message); return { ok: true, jobId: "test" }; }, getURL: (p) => p },
    tabs: { create() {} },
  };
})();`;

const port = 9750 + Math.floor(Math.random() * 100);
const browser = await launchBrowser(binary, port, join(import.meta.dir, "../../../.e2e-popup-profile"));
const transport = new DevToolsTransport(new Map([[1, await openPage(browser.browser, port)]]));
await transport.attach(1);
const send = <T>(method: string, params: Record<string, unknown> = {}) => transport.send<T>(1, method, params);

await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: stub });
await send("Emulation.setDeviceMetricsOverride", { width: 380, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/popup.html` });
await Bun.sleep(1200);

/** Runs a script in the popup page and returns its JSON result. */
async function page<T>(script: string): Promise<T> {
  const r = await send<{ result: { value: string } }>("Runtime.evaluate", {
    expression: `JSON.stringify((() => { ${script} })())`,
    returnByValue: true,
  });
  return JSON.parse(r.result.value) as T;
}
const pause = (ms = 650): Promise<void> => Bun.sleep(ms);

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail: string): void => {
  checks.push({ name, pass, detail });
};

// 1. Presets fill the size, density, and ratio.
await page(`const s = document.getElementById('preset'); s.value = 'uhd6k'; s.dispatchEvent(new Event('change')); return {};`);
await pause();
const sixK = await page<{ w: string; h: string; dpr: string; ratio: string; estPx: string; disabled3x: boolean; disabled2x: boolean; mp: string }>(`
  return {
    w: document.getElementById('width').value, h: document.getElementById('height').value,
    dpr: document.getElementById('dpr').value, ratio: document.getElementById('ratio').value,
    estPx: document.getElementById('est-px').textContent, mp: document.getElementById('est-mp').textContent,
    disabled3x: [...document.getElementById('dpr').options].find(o => o.value === '3').disabled,
    disabled2x: [...document.getElementById('dpr').options].find(o => o.value === '2').disabled,
  };`);
check("6K preset fills 6144 × 3456 at 1×", sixK.w === "6144" && sixK.h === "3456" && sixK.dpr === "1", `${sixK.w} × ${sixK.h} @${sixK.dpr}×`);
check("6K preset selects the ratio it matches exactly (16:9)", sixK.ratio === "16:9", `ratio ${sixK.ratio}`);
check("6K shows the output size and megapixels", sixK.estPx.includes("6144 × 3456 px") && sixK.mp.includes("21.2"), `${sixK.estPx}${sixK.mp}`);
check("at 6K, 3× is greyed out (it would exceed the per-side limit)", sixK.disabled3x === true, `3× disabled=${sixK.disabled3x}`);
check("at 6K, 2× stays available (it needs confirmation, not refusal)", sixK.disabled2x === false, `2× disabled=${sixK.disabled2x}`);

// 2. Every built-in preset is accepted by the popup (no pixel-limit error).
const presetIds = await page<string[]>(`return [...document.getElementById('preset').options].map(o => o.value).filter(v => v !== 'custom');`);
let presetFailures: string[] = [];
for (const id of presetIds) {
  await page(`const s = document.getElementById('preset'); s.value = '${id}'; s.dispatchEvent(new Event('change')); return {};`);
  const invalid = await page<boolean>(`return ['width','height','dpr'].some(id => (document.getElementById(id)).getAttribute('aria-invalid') === 'true');`);
  if (invalid) presetFailures.push(id);
}
check(`all ${presetIds.length} presets are accepted without a limit error`, presetFailures.length === 0, presetFailures.length ? `failed: ${presetFailures.join(", ")}` : "none flagged");

// 3. Locked aspect ratio: typing a width changes the height.
await page(`const r = document.getElementById('ratio'); r.value = '16:9'; r.dispatchEvent(new Event('change')); return {};`);
await page(`const w = document.getElementById('width'); w.value = '1920'; w.dispatchEvent(new Event('input')); w.dispatchEvent(new Event('change')); return {};`);
await pause();
const locked = await page<{ h: string }>(`return { h: document.getElementById('height').value };`);
check("16:9 locked: typing width 1920 sets height 1080", locked.h === "1080", `height ${locked.h}`);

await page(`const h = document.getElementById('height'); h.value = '1000'; h.dispatchEvent(new Event('input')); return {};`);
const widthFromHeight = await page<{ w: string }>(`return { w: document.getElementById('width').value };`);
check("16:9 locked: typing height 1000 sets width 1778", widthFromHeight.w === "1778", `width ${widthFromHeight.w}`);

// 4. Validation: a zero width is flagged and never sent to the worker.
await page(`const r = document.getElementById('ratio'); r.value = 'free'; r.dispatchEvent(new Event('change')); return {};`);
await page(`const w = document.getElementById('width'); w.value = '0'; w.dispatchEvent(new Event('input')); w.dispatchEvent(new Event('change')); return {};`);
await page(`document.getElementById('capture').click(); return {};`);
await pause(300);
const rejected = await page<{ flagged: boolean; sent: number; warned: boolean }>(`
  return {
    flagged: document.getElementById('width').getAttribute('aria-invalid') === 'true',
    sent: window.__sent.length,
    warned: document.querySelector('.log') ? [...document.querySelectorAll('.log-row')].some(r => r.className.includes('level-warn') && r.textContent.includes('Width')) : false,
  };`);
check("zero width is flagged in red", rejected.flagged, `aria-invalid=${rejected.flagged}`);
check("zero width is NOT sent to the worker", rejected.sent === 0, `messages sent: ${rejected.sent}`);
check("zero width explains why in the Console", rejected.warned, `console warning present=${rejected.warned}`);

// 5. A valid capture is sent with the right options.
await page(`const w = document.getElementById('width'); w.value = '1440'; w.dispatchEvent(new Event('change')); const h = document.getElementById('height'); h.value = '900'; h.dispatchEvent(new Event('change')); const d = document.getElementById('dpr'); d.value = '2'; d.dispatchEvent(new Event('change')); return {};`);
await page(`document.getElementById('capture').click(); return {};`);
await pause(300);
const sent = await page<{ options: Record<string, unknown> } | null>(`return window.__sent[0] ? { options: window.__sent[0].options } : null;`);
check("a valid capture sends 1440 × 900 at 2× to the worker", sent?.options.width === 1440 && sent?.options.height === 900 && sent?.options.dpr === 2, JSON.stringify(sent?.options ?? null));

// 6. Theme switch and motion switch.
const beforeTheme = await page<string>(`return document.documentElement.dataset.theme;`);
await page(`document.getElementById('theme-toggle').click(); return {};`);
await pause(700);
const afterTheme = await page<{ theme: string; label: string }>(`return { theme: document.documentElement.dataset.theme, label: document.getElementById('theme-toggle').getAttribute('aria-checked') };`);
check("theme button switches light to dark", beforeTheme === "light" && afterTheme.theme === "dark" && afterTheme.label === "true", `${beforeTheme} → ${afterTheme.theme}, switch aria-checked ${afterTheme.label}`);

await page(`const m = document.getElementById('motion'); m.checked = false; m.dispatchEvent(new Event('change')); return {};`);
const motion = await page<string>(`return document.documentElement.dataset.motion;`);
check("turning motion off in Options sets data-motion=off", motion === "off", `data-motion=${motion}`);

// 7. Saved sizes: save, then the list grows.
await page(`const w = document.getElementById('width'); w.value = '1111'; w.dispatchEvent(new Event('change')); return {};`);
await page(`document.getElementById('save-size').click(); return {};`);
await pause(300);
const saved = await page<number>(`return [...document.getElementById('preset').options].filter(o => o.value.startsWith('saved-')).length;`);
check("Save size adds an entry to Saved sizes", saved === 1, `saved entries: ${saved}`);

// 8. Mobile width: the page is still narrow enough to fit the popup.
const width = await page<number>(`return document.body.getBoundingClientRect().width;`);
check("the popup is 380 px wide", width === 380, `width ${width}`);

// Report
console.log("\nSpectra Capture · popup behaviour test (real browser)");
console.log("─".repeat(96));
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name.padEnd(70)} ${c.detail}`);
const failed = checks.filter((c) => !c.pass).length;
console.log("─".repeat(96));
console.log(`${checks.length - failed} passed, ${failed} failed.`);

transport.detach(1);
browser.browser.close();
browser.stop();
server.stop();
process.exit(failed === 0 ? 0 : 1);
