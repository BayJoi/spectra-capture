import { cp } from "node:fs/promises";
import { join } from "node:path";
import { launchExtension } from "./helpers";
import { ELEMENT_OVERLAY_EXPRESSION, REGION_OVERLAY_EXPRESSION } from "../../../src/capture/region-picker";

/** Regenerates every documentation screenshot from the real built extension. */
async function main(): Promise<void> {
  const out = join(import.meta.dir, "..", "..", "..", "docs", "screenshots");
  // Tiny control crops need a high device pixel ratio or they look soft when the guide scales
  // them up. Full-page guide shots are captured at 1x to keep their file size reasonable.
  const popupRun = await launchExtension("dist", false, 3);
  const guideRun = await launchExtension("dist", false, 1);
  try {
    const popup = await popupRun.context.newPage();
    await popup.goto(`chrome-extension://${popupRun.extensionId}/popup.html`);
    await popup.waitForSelector("#capture");
    await popup.evaluate(() => document.fonts.ready);
    await Bun.sleep(900);

    const frame = popup.locator("#frame");
    const viewport = popup.viewportSize() ?? { width: 1280, height: 720 };
    /** Screenshot a control with breathing room so buttons are never clipped at the edges. */
    const detail = async (
      selector: string,
      name: string,
      padX = 14,
      padTop = 14,
      padBottom = 14,
    ): Promise<void> => {
      const box = await popup.locator(selector).boundingBox();
      if (!box) throw new Error(`cannot find ${selector} for ${name}`);
      const x = Math.max(0, box.x - padX);
      const y = Math.max(0, box.y - padTop);
      await popup.screenshot({
        path: join(out, name),
        clip: {
          x,
          y,
          width: Math.min(viewport.width - x, box.width + padX * 2),
          height: Math.min(viewport.height - y, box.height + padTop + padBottom),
        },
        scale: "device",
      });
    };

    // Whole popup pages stay at CSS resolution for predictable layout in the docs.
    await frame.screenshot({ path: join(out, "popup-size.png"), scale: "css" });
    await detail("#theme-toggle", "theme-switch.png", 10, 4, 10);
    await detail(".size-row", "size-controls.png");
    await detail(".viewfinder", "viewfinder.png", 14, 10, 4);
    await detail("#ratio + .dd-button", "ratio-dropdown.png");
    await detail("#capture", "capture-button.png", 10);

    await popup.click("#tab-2");
    await Bun.sleep(650);
    await frame.screenshot({ path: join(out, "popup-output.png"), scale: "css" });
    await detail(".row-3", "output-controls.png");
    await detail(".check-row", "options-checkboxes.png");
    await detail(".receipt", "receipt.png");

    await popup.click("#tab-3");
    await Bun.sleep(650);
    await frame.screenshot({ path: join(out, "popup-settings.png"), scale: "css" });
    await detail(".tool-list", "settings-list.png", 14, 10, 10);
    await popup.evaluate(() => { const p = document.querySelector("#page-3"); if (p) p.scrollTop = p.scrollHeight; });
    await Bun.sleep(350);
    await frame.screenshot({ path: join(out, "popup-settings-bottom.png"), scale: "css" });

    await popup.click("#tab-4");
    await Bun.sleep(650);
    await frame.screenshot({ path: join(out, "popup-console.png"), scale: "css" });
    await detail(".console-tools", "console-tools.png", 16, 6, 4);

    await popup.click("#tab-1");
    await Bun.sleep(500);
    await popup.click("#theme-toggle");
    await Bun.sleep(750);
    await frame.screenshot({ path: join(out, "popup-dark.png"), scale: "css" });
    await detail("#theme-toggle", "theme-switch-dark.png", 10, 4, 10);

    const guide = await guideRun.context.newPage();
    await guide.setViewportSize({ width: 1440, height: 900 });
    await guide.goto(`chrome-extension://${guideRun.extensionId}/help.html`);
    await guide.evaluate(() => document.fonts.ready);
    await Bun.sleep(1100);
    await guide.screenshot({ path: join(out, "guide-hero.png") });
    await guide.evaluate(() => window.scrollTo(0, 760));
    await Bun.sleep(900);
    await guide.screenshot({ path: join(out, "guide-sections.png") });

    // Interactive picker shots: run the exact overlay expressions on a real page, capture the UI,
    // then cancel so they never leave anything behind.
    await guide.evaluate(() => window.scrollTo(0, 0));
    await Bun.sleep(500);
    await guide.evaluate((expr) => {
      (window as unknown as Record<string, unknown>).__spectraPick = eval(expr);
    }, REGION_OVERLAY_EXPRESSION);
    await guide.mouse.move(520, 220);
    await guide.mouse.down();
    await guide.mouse.move(1060, 520, { steps: 6 });
    await Bun.sleep(250);
    await guide.screenshot({ path: join(out, "area-selection.png") });
    await guide.mouse.up();
    await Bun.sleep(250);

    await guide.evaluate((expr) => {
      (window as unknown as Record<string, unknown>).__spectraPick = eval(expr);
    }, ELEMENT_OVERLAY_EXPRESSION);
    await guide.mouse.move(720, 300);
    await Bun.sleep(300);
    await guide.screenshot({ path: join(out, "element-selection.png") });
    await guide.keyboard.press("Escape");
    await Bun.sleep(250);

    // Keep the loaded extension in sync: the build copies these into dist, but screenshots are
    // regenerated after the build, so copy again or the guide shows stale images until the next build.
    await cp(out, join(import.meta.dir, "..", "..", "..", "dist", "screenshots"), { recursive: true });
    console.log("Regenerated all documentation screenshots at print-friendly resolution.");
  } finally {
    await popupRun.cleanup();
    await guideRun.cleanup();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
