import { launchExtension, assert } from "./helpers";

/** Checks the real popup UI: font, custom buttons, tab navigation, dropdown ARIA and live regions. */
async function main(): Promise<void> {
  const { context, extensionId, cleanup } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await page.waitForSelector("#capture");

    for (const selector of ["html", "body", "#width", "#capture-label", ".tab", ".check"]) {
      const font = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)!).fontFamily, selector);
      assert(/^Inter/.test(font), `expected Inter on ${selector}, got: ${font}`);
    }

    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return document.fonts.check('500 12px "Inter"');
    });
    assert(loaded, "the bundled Inter font did not load in the popup");

    const ids = [
      "preset", "width", "height", "swap", "ratio", "dpr", "format", "quality",
      "warm-up", "motion", "save-size", "delete-size", "reset", "log-copy",
      "log-clear", "capture", "theme-toggle", "help-link", "tab-1", "tab-2", "tab-3", "tab-4",
      "delay", "dark-mode", "hide-fixed", "save-as", "copy-clipboard", "annotate", "notifications",
      "pick-timeout",
    ];
    for (const id of ids) {
      assert((await page.$(`#${id}`)) !== null, `missing control: #${id}`);
    }

    // The dynamic Monitor preset detects the display resolution on open and applies it like any preset.
    const screenSize = await page.evaluate(() => ({ w: window.screen.width, h: window.screen.height }));
    assert((await page.$("#preset option[value='monitor']")) !== null, "missing Monitor preset option");
    await page.selectOption("#preset", "monitor");
    const applied = await page.evaluate(() => ({
      width: (document.getElementById("width") as HTMLInputElement).value,
      height: (document.getElementById("height") as HTMLInputElement).value,
    }));
    assert(applied.width === String(screenSize.w) && applied.height === String(screenSize.h),
      `Monitor preset did not apply the detected resolution: ${applied.width}x${applied.height} vs ${screenSize.w}x${screenSize.h}`);
    await page.selectOption("#preset", "custom");

    const custom = await page.$$eval("button", (buttons) =>
      buttons.filter((button) => button.classList.contains("ui-btn")).length,
    );
    const total = await page.$$eval("button", (buttons) => buttons.length);
    assert(custom === total, `every button should be custom (${custom}/${total})`);

    assert((await page.$("#status-live[aria-live='polite']")) !== null, "missing status live region");
    assert((await page.$("#console-badge[aria-live='polite']")) !== null, "missing console badge live region");
    assert((await page.$("#field-error[role='alert']")) !== null, "missing field error region");

    await page.click("#tab-2");
    assert((await page.$eval("#tab-2", (node) => node.getAttribute("aria-selected"))) === "true", "tab 2 did not activate");

    // No magnetic transforms: fractional-pixel pointer tracking blurred labels on hover.
    assert((await page.$$("[data-magnetic]")).length === 0, "magnetic hover transform must stay off");

    // The active page-tab CARD needs a clearly visible highlight in both themes (this was nearly
    // invisible in light mode when it reused the generic, much paler selection tint).
    const tabBg = (selector: string): Promise<string> =>
      page.$eval(selector, (node) => getComputedStyle(node).backgroundColor);
    const tabTokens = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return { active: s.getPropertyValue("--tab-active").trim(), hover: s.getPropertyValue("--select-hover").trim() };
    });
    assert(tabTokens.active.length > 0 && tabTokens.active !== tabTokens.hover,
      `the active tab needs its own highlight token, got ${JSON.stringify(tabTokens)}`);
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") {
        await page.click("#theme-toggle");
        await page.waitForTimeout(250);
      }
      const active = await tabBg("#tab-2");
      const idle = await tabBg("#tab-3");
      assert(active !== "rgba(0, 0, 0, 0)" && active !== idle,
        `${theme} active tab highlight is not visible: active=${active}, idle=${idle}`);
    }
    await page.click("#theme-toggle");
    await page.waitForTimeout(250);

    await page.click("#tab-3");
    assert((await page.$eval("#tab-3", (node) => node.getAttribute("aria-selected"))) === "true", "tab 3 did not activate");
    assert((await page.$eval("#notifications", (node) => (node as HTMLInputElement).checked)) === true,
      "save notifications should be enabled by default");
    assert((await page.$eval("#pick-timeout", (node) => (node as HTMLInputElement).checked)) === false,
      "picker timeout should be off by default");
    await page.click("#tab-4");
    assert((await page.$eval("#tab-4", (node) => node.getAttribute("aria-selected"))) === "true", "tab 4 did not activate");
    const modeValues = await page.$$eval('input[name="mode"]', (nodes) => nodes.map((n) => (n as HTMLInputElement).value));
    for (const mode of ["viewport", "fullpage", "region", "element"]) {
      assert(modeValues.includes(mode), `missing capture mode: ${mode}`);
    }
    await page.click("#tab-1");

    await page.click(".dd-button");
    await page.waitForSelector(".dd-panel.is-open");
    const controls = await page.$eval(".dd-button", (node) => node.getAttribute("aria-controls"));
    const activeDescendant = await page.$eval(".dd-button", (node) => node.getAttribute("aria-activedescendant"));
    assert(controls, "dropdown button has no aria-controls");
    assert(activeDescendant, "dropdown button has no aria-activedescendant");
    assert((await page.$(`#${activeDescendant}`)) !== null, "aria-activedescendant points to a missing option");
    await page.keyboard.press("Escape");

    const guide = await context.newPage();
    await guide.goto(`chrome-extension://${extensionId}/help.html`);
    await guide.waitForSelector("h1");
    for (const selector of ["html", "body", "h1", ".guide p", "code"]) {
      const font = await guide.evaluate((sel) => getComputedStyle(document.querySelector(sel)!).fontFamily, selector);
      assert(/^Inter/.test(font), `expected Inter on guide ${selector}, got: ${font}`);
    }
    const framed = await guide.$$eval(".guide[data-spotlight]", (nodes) => nodes.length);
    assert(framed > 0, "guide sections are not framed with the spotlight card treatment");
    await guide.close();

    const logs = await page.$$eval("#log", (nodes) => nodes.length);
    assert(logs === 1, "console log region missing");
    const consoleText = await page.$eval("#log", (node) => node.textContent ?? "");
    assert(!consoleText.includes("Font check"), "the font-check noise entry is still in the console");

    console.log(`PASS popup: font, ${total} custom buttons, live regions, tabs and dropdown ARIA (${extensionId})`);
  } finally {
    await cleanup();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
