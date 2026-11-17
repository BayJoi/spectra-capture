import { launchExtension, assert } from "./helpers";

/** Verifies the guide page: images, framed cards, reveal behaviour and step badges. */
async function main(): Promise<void> {
  const { context, extensionId, cleanup } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`chrome-extension://${extensionId}/help.html`);
    await page.evaluate(() => document.fonts.ready);
    await Bun.sleep(700);

    const stepCount = await page.$$eval(".steps li", (nodes) => nodes.length);
    assert(stepCount === 5, `expected 5 quick-start steps, got ${stepCount}`);

    const framed = await page.$$eval(".guide[data-spotlight]", (nodes) => nodes.length);
    assert(framed >= 8, `expected framed guide cards, got ${framed}`);

    await page.evaluate(() => window.scrollTo(0, 620));
    await Bun.sleep(500);
    const hidden = await page.$$eval("[data-reveal]", (nodes) =>
      nodes.filter((node) => {
        const r = node.getBoundingClientRect();
        return r.top < innerHeight && r.bottom > 0 && !node.classList.contains("is-in");
      }).length,
    );
    assert(hidden === 0, `${hidden} in-view elements are still hidden after scrolling`);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await Bun.sleep(900);
    const images = await page.$$eval("img", (nodes) =>
      nodes.map((node) => ({ src: node.getAttribute("src"), ok: node.complete && node.naturalWidth > 0 })),
    );
    const shots = images.filter((image) => image.src?.startsWith("screenshots/"));
    assert(shots.length >= 10, `expected the guide's section screenshots, got ${shots.length}`);
    assert(shots.every((image) => image.ok), `a guide screenshot failed to load: ${JSON.stringify(shots)}`);

    await page.click("#theme-toggle");
    await Bun.sleep(200);
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    assert(theme === "dark", `theme toggle failed: ${theme}`);
    const logo = await page.$eval(".hero-logo", (node) => node.getAttribute("src"));
    assert(logo?.includes("-dark.svg"), `brand artwork did not switch with the theme: ${logo}`);

    console.log(`PASS guide: ${stepCount} steps, ${framed} framed cards, ${shots.length} screenshots, reveal + theme OK`);
  } finally {
    await cleanup();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
