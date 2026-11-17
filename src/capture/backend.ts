import { en } from "../i18n/en";
import { sleep, withTimeout } from "../shared/async";
import { CaptureError } from "../shared/errors";
import type { CaptureOptions } from "../shared/types";
import type { TabWatch } from "./chrome-transport";
import type { CleanupStack } from "./cleanup";
import { DebuggerSession } from "./debugger-session";
import type { CaptureEnv, Timeouts } from "./capture-controller";
import { assessOutput } from "../validation/dimensions";
import { getContentSize, waitForReady, warmUpLazyContent } from "./page-metrics";
import { captureFullPage, captureRegion, captureViewport } from "./screenshot-capture";
import { applyViewport, clearViewport } from "./viewport-emulation";
import { pickRegion } from "./region-picker";
import { applyDarkMode, applyHideFixed, clearPickerArtifacts, runCountdown } from "./effects";
import { captureTiledFullPage } from "./tiled-capture";
import { LIMITS } from "../validation/dimensions";

/** The image bytes plus the size we expected before the image arrived. */
export interface Captured {
  data: string;
  expectW: number;
  expectH: number;
}

/** Everything a backend needs to prepare a page and capture it. */
export interface Context {
  jobId: string;
  opts: CaptureOptions;
  env: CaptureEnv;
  timeouts: Timeouts;
  tabId: number;
  url?: string;
  watch: TabWatch;
  cleanup: CleanupStack;
  /** Set by the Chromium backend when the browser detaches the debugger mid-capture. */
  detachedReason?: string;
}

/**
 * A platform capture implementation. The controller owns validation, gating, image checks,
 * file naming and saving; a backend only gets a page ready and returns image data.
 */
export interface CaptureBackend {
  readonly kind: "cdp";
  captureInPage(ctx: Context): Promise<Captured>;
}

const stage = (ctx: Context, step: string, progress: number): void =>
  ctx.env.report(ctx.jobId, { step, progress });

/**
 * Chromium: attach the debugger, emulate the viewport, wait, then use Page.captureScreenshot.
 * Every change registers its own undo step on ctx.cleanup as soon as it becomes necessary.
 */
export class ChromiumBackend implements CaptureBackend {
  readonly kind = "cdp" as const;

  constructor(private readonly transport: CaptureEnv["transport"]) {}

  async captureInPage(ctx: Context): Promise<Captured> {
    const { jobId, opts, env, timeouts, watch } = ctx;
    const cdp = new DebuggerSession(this.transport, ctx.tabId, timeouts.command);

    stage(ctx, en.steps.attaching, 1);
    await cdp.attach();
    // Clear any overlay left behind by an interrupted pick before doing anything else, so a stale
    // highlight can never be baked into this capture or keep suppressing page input.
    await clearPickerArtifacts(cdp);
    env.log.info(en.logs.attached);
    ctx.cleanup.add("clear-tab-record", async () => env.report(jobId, { tabId: undefined }));
    ctx.cleanup.add("detach-debugger", () => cdp.detach());
    const unsubscribe = this.transport.onDetach((tabId, reason) => {
      if (tabId === ctx.tabId) ctx.detachedReason = reason;
    });
    ctx.cleanup.add("stop-detach-listener", async () => unsubscribe());
    env.report(jobId, { tabId: ctx.tabId });

    stage(ctx, en.steps.viewport, 2);
    await applyViewport(cdp, opts.width, opts.height, opts.dpr);
    ctx.cleanup.add("clear-viewport", () => clearViewport(cdp).catch(() => undefined));

    stage(ctx, en.steps.waiting, 3);
    await waitForReady(cdp, () => watch.aborted(), timeouts.ready);
    await sleep(timeouts.settle);

    if (opts.warmUp) {
      stage(ctx, en.steps.lazy, 3);
      const warm = await withTimeout(warmUpLazyContent(cdp), timeouts.capture, en.labels.lazyScroll);
      env.log.info(en.logs.scrolled(warm.steps));
      await sleep(timeouts.settle);
    }

    // Optional page effects. Each registers its own undo step so the page is left untouched.
    if (opts.darkMode) {
      stage(ctx, en.steps.effects, 3);
      const undo = await applyDarkMode(cdp);
      ctx.cleanup.add("restore-dark-mode", undo);
      env.log.info(en.logs.darkApplied);
    }
    if (opts.hideFixed) {
      stage(ctx, en.steps.effects, 3);
      const undo = await applyHideFixed(cdp);
      ctx.cleanup.add("restore-fixed", undo);
      env.log.info(en.logs.fixedHidden);
    }
    if (opts.delay > 0) {
      stage(ctx, en.steps.countdown ?? en.steps.waiting, 3);
      env.log.info(en.logs.countdown(opts.delay));
      await withTimeout(runCountdown(cdp, opts.delay), (opts.delay + 5) * 1000, en.labels.pageLoad);
    }

    if (opts.mode === "region" || opts.mode === "element") {
      const kind = opts.mode;
      stage(ctx, kind === "region" ? en.steps.selecting : en.steps.selectingElement, 3);
      ctx.cleanup.add("clear-picker", () => clearPickerArtifacts(cdp));
      // With the Settings toggle off the pick waits for the user. The large ceiling is only a
      // safety net for CDP (24 h, well under setTimeout's 32-bit limit), not a user-facing timeout.
      const pickMs = opts.pickTimeout ? 60_000 : 86_400_000;
      const region = await withTimeout(
        pickRegion(cdp, kind, {
          theme: opts.theme,
          motion: opts.overlayMotion,
        }, pickMs),
        pickMs + 5_000,
        en.labels.browserStep,
      );
      await clearPickerArtifacts(cdp);
      if (watch.aborted()) throw new CaptureError("NAVIGATED");
      if (ctx.detachedReason) throw new CaptureError("DETACHED");
      const assessment = assessOutput(region.width, region.height, opts.dpr);
      if (assessment.verdict === "reject") throw new CaptureError("TOO_LARGE", assessment.message);
      if (assessment.verdict === "confirm" && !opts.confirmLarge) {
        throw new CaptureError("CONFIRM_REQUIRED", en.errors.CONFIRM_REQUIRED, { pixels: assessment.pixels });
      }
      env.log.info(kind === "region" ? en.logs.regionPicked(region.width, region.height) : en.logs.elementPicked);

      // Chrome keeps the inspector highlight alive for the lifetime of the debugger attachment —
      // hideHighlight alone is not enough. Detaching destroys every CDP-drawn overlay, then a fresh
      // session gives a clean compositor surface and a fully rendered page for the capture.
      stage(ctx, en.steps.capturing, 4);
      await sleep(120);
      await cdp.detach();
      await sleep(180);
      await cdp.attach();
      cdp.clearDetachReason(); // our own detach above fires onDetach, not a real browser detachment
      env.log.info(en.logs.freshCapture);
      await applyViewport(cdp, opts.width, opts.height, opts.dpr);
      ctx.cleanup.add("clear-viewport-fresh", () => clearViewport(cdp).catch(() => undefined));
      if (opts.darkMode) {
        const undo = await applyDarkMode(cdp);
        ctx.cleanup.add("restore-dark-mode-fresh", undo);
      }
      await waitForReady(cdp, () => watch.aborted(), timeouts.ready);
      await sleep(timeouts.settle);
      const data = await withTimeout(
        captureRegion(cdp, region, opts.format, opts.quality),
        timeouts.capture,
        en.labels.capture,
      );
      return { data, expectW: assessment.outW, expectH: assessment.outH };
    }

    if (opts.mode === "viewport") {
      stage(ctx, en.steps.capturing, 4);
      const data = await withTimeout(captureViewport(cdp, opts.format, opts.quality), timeouts.capture, en.labels.capture);
      return { data, expectW: Math.round(opts.width * opts.dpr), expectH: Math.round(opts.height * opts.dpr) };
    }

    stage(ctx, en.steps.measuring, 4);
    const cssHeight = Math.ceil((await getContentSize(cdp)).height);
    const pixels = Math.round(opts.width * opts.dpr) * Math.round(cssHeight * opts.dpr);
    const outH = Math.round(cssHeight * opts.dpr);
    // A tall page can be captured in tiles and stitched locally when it exceeds the single-shot cap.
    if (
      outH > LIMITS.maxOutputSide &&
      pixels <= LIMITS.maxOutputPixels &&
      opts.format === "png" &&
      typeof OffscreenCanvas !== "undefined"
    ) {
      stage(ctx, en.steps.capturing, 4);
      const result = await withTimeout(
        captureTiledFullPage(cdp, opts.width, cssHeight, opts.dpr),
        timeouts.capture * 4,
        en.labels.capture,
      );
      env.log.info(en.logs.tiled(result.tiles));
      return { data: result.data, expectW: Math.round(opts.width * opts.dpr), expectH: outH };
    }
    const assessment = assessOutput(opts.width, cssHeight, opts.dpr);
    // The controller has already gated viewport mode; full page needs this second gate.
    if (assessment.verdict === "reject") throw new CaptureError("TOO_LARGE", assessment.message);
    if (assessment.verdict === "confirm" && !opts.confirmLarge) {
      throw new CaptureError("CONFIRM_REQUIRED", en.errors.CONFIRM_REQUIRED, { pixels: assessment.pixels });
    }
    stage(ctx, en.steps.capturing, 4);
    const data = await withTimeout(
      captureFullPage(cdp, opts.width, cssHeight, opts.format, opts.quality),
      timeouts.capture,
      en.labels.capture,
    );
    return { data, expectW: assessment.outW, expectH: assessment.outH };
  }
}
