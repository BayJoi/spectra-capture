import { launchExtension, assert } from "./helpers";
import {
  ELEMENT_OVERLAY_EXPRESSION,
  REGION_OVERLAY_EXPRESSION,
  regionOverlayExpression,
} from "../../../src/capture/region-picker";
import { CLEAN_ARTIFACTS_EXPRESSION } from "../../../src/capture/effects";

/**
 * Regression guard for "text selection stops working after a capture until refresh", plus the
 * themed/animated overlay behaviour. The picker installs capture-phase window listeners whose
 * pointerdown calls preventDefault(); they must all be released on success and on timeout.
 */
async function main(): Promise<void> {
  const { context, cleanup } = await launchExtension();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto("data:text/html,<style>body{margin:0;font:16px Arial;padding:40px}div[id=card]{width:300px;height:120px;background:rgb(238,238,238);margin-top:20px}div[id=chip]{width:60px;height:40px;background:rgb(200,100,100);margin-top:10px}</style><p id='t'>Hello selectable world with plenty of text to select here.</p><div id='card'></div><div id='chip'></div>");
    await page.waitForSelector("#t");

    const defaultPrevented = (): Promise<boolean> =>
      page.evaluate(() => {
        const event = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      });
    const start = (expr: string): Promise<void> =>
      page.evaluate((source) => {
        (window as unknown as Record<string, unknown>).__pick = eval(source);
      }, expr);
    const finish = (): Promise<{ x: number; y: number; width: number; height: number } | null> =>
      page.evaluate(async () => (await (window as unknown as Record<string, unknown>).__pick) as never);

    // --- Area overlay styling: hard shadow, theme palette, corner brackets + opacity pulses. ---
    await start(REGION_OVERLAY_EXPRESSION);
    const styled = await page.evaluate(() => {
      const box = document.querySelector("[data-spectra-picker] > div") as HTMLElement;
      const ticks = document.querySelectorAll("[data-spectra-tick]").length;
      const animations = Array.from(document.querySelectorAll("[data-spectra-picker] *"))
        .reduce((n, el) => n + el.getAnimations().length, 0);
      const shadowAnimated = Array.from(document.querySelectorAll("[data-spectra-picker] *"))
        .some((el) => el.getAnimations().some((a) =>
          (a.effect as KeyframeEffect).getKeyframes().some((k) => "boxShadow" in k)));
      const looping = Array.from(document.querySelectorAll("[data-spectra-picker] *"))
        .reduce((n, el) => n + el.getAnimations().filter((a) =>
          (a.effect as AnimationEffect | null)?.getTiming().iterations === Infinity).length, 0);
      const veil = document.querySelector("[data-spectra-picker]") as HTMLElement;
      const runner = document.querySelector("[data-spectra-runner]") as HTMLElement;
      const ticksLayer = document.querySelector("[data-spectra-ticks]") as HTMLElement;
      return {
        shadow: box.style.boxShadow, border: box.style.border, ticks, animations, shadowAnimated,
        looping, runner: runner.style.display, pulse: ticksLayer.getAnimations().length,
        veilShadow: veil.style.boxShadow, veilBackground: veil.style.background,
      };
    });
    assert(styled.shadow.includes("4px 4px 0"), `area box needs a hard drop shadow, got ${styled.shadow}`);
    assert(styled.shadow.includes("46, 33, 24"), `light-theme shadow should use the ink line, got ${styled.shadow}`);
    assert(styled.border.includes("194, 64, 43"), `light-theme border should use vermilion, got ${styled.border}`);
    assert(styled.ticks === 4, `expected four corner ticks, got ${styled.ticks}`);
    assert(styled.looping === 2, `expected exactly two looping animations (pulse + runner), got ${styled.looping}`);
    assert(styled.pulse === 1, "all four brackets should share one smooth pulse animation");
    assert(styled.runner === "", "the perimeter runner should be visible with motion on");
    assert(!styled.shadowAnimated, "box-shadow must be static — animating it repaints on every frame");
    assert(styled.veilShadow === "", `the veil must not use a giant inset shadow, got ${styled.veilShadow}`);
    assert(styled.veilBackground.includes("rgba"), "the veil should be a single translucent background layer");

    await page.mouse.move(40, 60);
    await page.mouse.down();
    await page.mouse.move(320, 140, { steps: 6 });
    // Sample while the (now full-size) box is visible to prove the loops are actually running.
    const sample = (): Promise<{ runner: string; pulse: string }> => page.evaluate(() => {
      const r = document.querySelector("[data-spectra-runner]") as HTMLElement;
      return {
        runner: getComputedStyle(r).left + "/" + getComputedStyle(r).top,
        pulse: getComputedStyle(document.querySelector("[data-spectra-ticks]") as HTMLElement).opacity,
      };
    });
    const before = await sample();
    await page.waitForTimeout(260);
    const after = await sample();
    assert(before.runner !== after.runner, `runner should move continuously: ${before.runner} -> ${after.runner}`);
    assert(before.pulse !== after.pulse,
      `bracket opacity should pulse continuously: ${JSON.stringify({ before, after })}`);
    await page.mouse.up();
    const area = await finish();
    assert(area && area.width > 200, `area pick returned no region: ${JSON.stringify(area)}`);
    assert((await defaultPrevented()) === false, "area pick left a pointerdown listener that suppresses clicks");
    assert((await page.$("[data-spectra-picker]")) === null, "area picker overlay was not removed");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    // Text selection works again on the same, unrefreshed page.
    await page.mouse.move(44, 44);
    await page.mouse.down();
    await page.mouse.move(420, 44, { steps: 10 });
    await page.mouse.up();
    const selected = await page.evaluate(() => window.getSelection()?.toString() ?? "");
    assert(selected.length > 0, "text could not be selected after an area pick without refreshing");
    await page.evaluate(() => window.getSelection()?.removeAllRanges());

    // --- Motion off: no animations, but the hard shadow and theme styling remain. ---
    await start(regionOverlayExpression({ theme: "dark", motion: false }));
    const quiet = await page.evaluate(() => {
      const box = document.querySelector("[data-spectra-picker] > div") as HTMLElement;
      const animations = Array.from(document.querySelectorAll("[data-spectra-picker] *"))
        .reduce((n, el) => n + el.getAnimations().length, 0);
      const runner = document.querySelector("[data-spectra-runner]") as HTMLElement;
      return {
        shadow: box.style.boxShadow, transition: box.style.transition, animations,
        runner: runner.style.display,
      };
    });
    assert(quiet.animations === 0, `motion off should remove all overlay animations, got ${quiet.animations}`);
    assert(quiet.runner === "none", "the perimeter runner should be hidden with motion off");
    assert(quiet.transition === "", `motion off should remove the box transition, got ${quiet.transition}`);
    assert(quiet.shadow.includes("4px 4px 0") && quiet.shadow.includes("236, 228, 210"),
      `dark-theme shadow should still be a hard light-ink shadow, got ${quiet.shadow}`);
    await page.keyboard.press("Escape");
    await finish();

    // --- Element: click snaps to the element; dragging over text selects just the words. ---
    await start(ELEMENT_OVERLAY_EXPRESSION);
    const morph = await page.evaluate(() => (document.querySelector("[data-spectra-picker] > div") as HTMLElement).style.transition);
    assert(morph.includes("left") && morph.includes("width"), `element box needs a morph transition, got ${morph}`);
    await page.mouse.move(120, 150);
    await page.mouse.click(120, 150);
    const element = await finish();
    assert(element && element.width > 100, `element click did not select a box: ${JSON.stringify(element)}`);
    assert((await defaultPrevented()) === false, "element pick left a listener that suppresses pointerdown");

    // Switching targets: a soft, bounce-free morph with an opacity flash — no scale stretch.
    await start(ELEMENT_OVERLAY_EXPRESSION);
    await page.mouse.move(120, 150);
    await page.waitForTimeout(230);
    const boxWidth = (): Promise<number> => page.evaluate(() =>
      parseFloat((document.querySelector("[data-spectra-picker] > div") as HTMLElement).style.width));
    const big = await boxWidth();
    const transition = await page.evaluate(() =>
      (document.querySelector("[data-spectra-picker] > div") as HTMLElement).style.transition);
    assert(transition.includes("0.28s") || transition.includes(".28s"),
      `element morph should be a soft 0.28s, got ${transition}`);
    assert(/opacity (0?\.18s)/.test(transition), `element highlight should fade in/out, got ${transition}`);
    const boxOpacity = (): Promise<string> => page.evaluate(() =>
      (document.querySelector("[data-spectra-picker] > div") as HTMLElement).style.opacity);
    assert((await boxOpacity()) === "1", "element highlight should fade in over a target");
    await page.mouse.move(60, 224);
    await page.waitForTimeout(50); // rAF-batched pointermove
    const motion = await page.evaluate(() => {
      const flash = document.querySelector("[data-spectra-flash]") as HTMLElement;
      const box = document.querySelector("[data-spectra-picker] > div") as HTMLElement;
      return {
        flash: flash.getAnimations().some((a) =>
          (a.effect as KeyframeEffect).getKeyframes().some((k) => "opacity" in k)),
        stretch: box.getAnimations().some((a) =>
          (a.effect as KeyframeEffect).getKeyframes().some((k) => "transform" in k)),
      };
    });
    await page.waitForTimeout(230);
    const small = await boxWidth();
    assert(small < big, `switching to a smaller element should shrink the highlight: ${big} -> ${small}`);
    assert(motion.flash, "switching elements should play the opacity flash");
    assert(!motion.stretch, "switching elements must not stretch/scale the frame");
    await page.mouse.move(700, 400);
    await page.waitForTimeout(230);
    assert((await boxOpacity()) === "0", "element highlight should fade out when no element is under the pointer");
    await page.mouse.click(60, 224);
    await finish();

    // --- Timeout path: cleanup expression removes listeners from a still-active picker. ---
    await start(REGION_OVERLAY_EXPRESSION);
    assert(await defaultPrevented(), "picker should be active before the forced cleanup");
    await page.evaluate((expr) => { eval(expr); }, CLEAN_ARTIFACTS_EXPRESSION);
    assert((await defaultPrevented()) === false, "clearPickerArtifacts left the picker's listener attached");
    assert((await page.$("[data-spectra-picker]")) === null, "clearPickerArtifacts left the overlay in the page");

    console.log("PASS picker: themed hard shadows, motion on/off, element morph, and no leaked listeners");
  } finally {
    await cleanup();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
