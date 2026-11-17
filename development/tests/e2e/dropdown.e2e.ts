/**
 * REAL-BROWSER TEST of the dropdowns. It clicks each dropdown with a real mouse press, scrolls a
 * list with a real mouse wheel, and checks that the list stays open. It also checks that a list
 * opens every time, including when its chosen item is near the bottom.
 *
 *   CHROME_PATH="/path/to/chromium" bun development/tests/e2e/dropdown.e2e.ts
 *   CHROME_PATH=... SPECTRA_DIST=/some/built/folder bun development/tests/e2e/dropdown.e2e.ts   (defaults to dist/)
 */
import { join } from "node:path";
import { DEFAULT_PREFS } from "../../../src/settings/settings-store";
import { DevToolsTransport, launchBrowser, openPage } from "./devtools";

const binary = process.env.CHROME_PATH;
if (!binary) {
  console.log("SKIPPED: set CHROME_PATH to a Chromium-based browser binary to run the dropdown test.");
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
  const make = (data) => ({
    async get(key) { const out = {}; for (const k of Array.isArray(key) ? key : [key]) if (data[k] !== undefined) out[k] = data[k]; return out; },
    async set(items) { Object.assign(data, items); },
  });
  window.chrome = {
    storage: { local: make({ prefs: ${JSON.stringify(DEFAULT_PREFS)} }), session: make({}), onChanged: { addListener() {} } },
    runtime: { sendMessage: async () => ({ ok: true, jobId: "test" }), getURL: (p) => p, onMessage: { addListener() {} } },
    tabs: { create() {} },
  };
})();`;

const port = 9800 + Math.floor(Math.random() * 100);
const browser = await launchBrowser(binary, port, join(import.meta.dir, "../../../.e2e-dropdown-profile"));
const transport = new DevToolsTransport(new Map([[1, await openPage(browser.browser, port)]]));
await transport.attach(1);
const send = <T>(method: string, params: Record<string, unknown> = {}) => transport.send<T>(1, method, params);

await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: stub });
await send("Emulation.setDeviceMetricsOverride", { width: 380, height: 600, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `http://127.0.0.1:${server.port}/popup.html` });
await Bun.sleep(1200);

/** Runs a script in the popup and returns its JSON value. */
async function evalJson<T>(body: string): Promise<T> {
  const r = await send<{ result: { value: string } }>("Runtime.evaluate", {
    expression: `JSON.stringify((() => { ${body} })())`,
    returnByValue: true,
  });
  return JSON.parse(r.result.value) as T;
}

/** A real mouse press and release at the centre of an element. */
async function clickElement(selector: string, index = 0): Promise<void> {
  const point = await evalJson<{ x: number; y: number } | null>(`
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
  if (!point) throw new Error(`No element ${selector} at index ${index}`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

const isOpen = (): Promise<boolean> => evalJson<boolean>(`return !!document.querySelector('.dd-panel.is-open');`);
const pause = (ms = 450): Promise<void> => Bun.sleep(ms);

interface Check { name: string; pass: boolean; detail: string }
const checks: Check[] = [];
const check = (name: string, pass: boolean, detail = ""): void => {
  checks.push({ name, pass, detail });
};

// 1. A dropdown opens on a real click.
await clickElement(".dd-button", 0);
await pause();
check("preset list opens on a click", await isOpen());

// 2. Scrolling inside the open list does not close it.
const listPoint = await evalJson<{ x: number; y: number }>(`const r = document.querySelector('.dd-panel').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };`);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: listPoint.x, y: listPoint.y, deltaX: 0, deltaY: 90 });
await pause(400);
const scrolled = await evalJson<number>(`return document.querySelector('.dd-panel') ? document.querySelector('.dd-panel').scrollTop : -1;`);
check("preset list really scrolls with the mouse wheel", scrolled > 0, `scrollTop ${scrolled}`);
check("the list stays open after scrolling", await isOpen());

// 3. Closing it with Escape.
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await pause(350);
check("Escape closes the list", !(await isOpen()));

// 4. A list opens even when its chosen item is at the bottom (the case that used to close at once).
await evalJson<null>(`const s = document.getElementById('ratio'); s.value = s.options[s.options.length - 1].value; s.dispatchEvent(new Event('change', { bubbles: true })); return null;`);
await clickElement(".dd-button", 1);
await pause(600);
check("ratio list opens when its chosen item is at the bottom", await isOpen());
await clickElement(".dd-button", 1);
await pause(350);

// 5. Opening and closing many times: every open must stick.
let stuck = 0;
for (let i = 0; i < 6; i++) {
  await clickElement(".dd-button", i % 2);
  await pause(380);
  if (await isOpen()) stuck++;
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await pause(300);
}
check("6 open and close cycles on the size page all stay open", stuck === 6, `${stuck} of 6 stayed open`);

// 6. The Output page: density and format open, and a click on an item chooses it.
await clickElement(".tab", 1);
await pause(650);
await clickElement(".dd-button", 2);
await pause(450);
check("density list opens on the Output page", await isOpen());
await clickElement(".dd-option", 0);
await pause(450);
const chosen = await evalJson<{ value: string; open: boolean }>(`return { value: document.getElementById('dpr').value, open: !!document.querySelector('.dd-panel.is-open') };`);
check("clicking an item chooses it and closes the list", chosen.value === "1" && !chosen.open, `value ${chosen.value}, open ${chosen.open}`);
await clickElement(".dd-button", 3);
await pause(450);
check("format list opens on the Output page", await isOpen());

const failed = checks.filter((c) => !c.pass);
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed.`);

await transport.detach(1);
browser.browser.close();
browser.stop();
server.stop();
process.exit(failed.length === 0 ? 0 : 1);
