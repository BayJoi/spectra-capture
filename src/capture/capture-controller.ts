import { en } from "../i18n/en";
import { CaptureError } from "../shared/errors";
import type { Logger } from "../shared/log";
import type { JobState } from "../shared/types";
import { assessOutput, validateCaptureOptions, type OutputAssessment } from "../validation/dimensions";
import { buildFilename } from "../validation/filename";
import { ChromiumBackend, type Captured, type Context } from "./backend";
import type { TabWatch } from "./chrome-transport";
import type { TargetTab } from "../shared/messages";
import { CleanupStack } from "./cleanup";
import type { CdpTransport } from "./debugger-session";
import { checkDimensions, readImageInfoFromBase64 } from "./image-validation";

export type { Captured, Context } from "./backend";

export interface ActiveTab {
  id?: number;
  url?: string;
}

export interface Timeouts {
  /** Per protocol command. */
  command: number;
  /** Waiting for the page to finish loading. */
  ready: number;
  /** The screenshot itself. */
  capture: number;
  /** Short pause after layout changes. */
  settle: number;
}

export const DEFAULT_TIMEOUTS: Timeouts = { command: 20_000, ready: 15_000, capture: 90_000, settle: 400 };

/** Everything the controller touches outside itself. Tests and the real-browser test replace each piece. */
export interface CaptureEnv {
  transport: CdpTransport;
  getActiveTab(): Promise<ActiveTab | undefined>;
  watchNavigation(tabId: number): TabWatch;
  saveImage(jobId: string, base64: string, mime: string, filename: string, saveAs?: boolean): Promise<void>;
  report(jobId: string, patch: Partial<JobState>): void;
  log: Logger;
  now(): Date;
  timeouts?: Partial<Timeouts>;
}

export interface CaptureResult {
  filename: string;
  width: number;
  height: number;
}

/** Only regular web pages. Browser, extension, file and devtools pages are refused. */
export function isCapturableUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The one output-size gate. Used before any browser work (viewport) and after measuring (full page). */
function gate(assessment: OutputAssessment, confirmLarge: boolean): void {
  if (assessment.verdict === "reject") throw new CaptureError("TOO_LARGE", assessment.message);
  if (assessment.verdict === "confirm" && !confirmLarge) {
    throw new CaptureError("CONFIRM_REQUIRED", en.errors.CONFIRM_REQUIRED, { pixels: assessment.pixels });
  }
}

/**
 * Runs one capture job from start to finish. The debugger is detached before the file is saved,
 * so the browser's debugging banner shows only for as long as it is needed.
 */
export async function runCapture(
  jobId: string,
  input: unknown,
  env: CaptureEnv,
  providedTab?: TargetTab,
): Promise<CaptureResult> {
  const checked = validateCaptureOptions(input);
  if (!checked.ok) throw new CaptureError("INVALID_INPUT", checked.message);
  const opts = checked.value;
  const timeouts: Timeouts = { ...DEFAULT_TIMEOUTS, ...env.timeouts };

  env.report(jobId, { status: "running", step: en.steps.checking, progress: 0 });
  if (opts.mode === "viewport") gate(assessOutput(opts.width, opts.height, opts.dpr), opts.confirmLarge);

  // Prefer the tab the popup resolved in its own context. Chrome 153+ scrubs `tab.url` for
  // restricted pages under `activeTab` alone, and the worker's lastFocusedWindow can drift;
  // the popup's `currentWindow` is the authoritative source. Fall back to the worker query
  // for older callers and tests that do not supply a tab.
  const tab = providedTab ?? (await env.getActiveTab());
  // Validate the tab id at the trust boundary: it becomes the chrome.debugger target below.
  const tabId = tab?.id;
  if (typeof tabId !== "number" || !Number.isInteger(tabId) || tabId < 0) throw new CaptureError("NO_ACTIVE_TAB");
  if (!isCapturableUrl(tab?.url)) throw new CaptureError("RESTRICTED_URL");

  const watch = env.watchNavigation(tabId);
  const cleanup = new CleanupStack();
  cleanup.add("stop-watching-tab", async () => watch.dispose());
  const ctx: Context = {
    jobId,
    opts,
    env,
    timeouts,
    tabId,
    url: tab?.url,
    watch,
    cleanup,
  };
  const backend = new ChromiumBackend(env.transport);

  let captured: Captured;
  try {
    captured = await backend.captureInPage(ctx);
    if (watch.aborted()) throw new CaptureError("NAVIGATED");
    if (ctx.detachedReason) throw new CaptureError("DETACHED");
  } finally {
    await cleanup.runAll((name) => env.log.warn(en.logs.cleanupFailed(name)));
  }

  const check = checkDimensions(readImageInfoFromBase64(captured.data), captured.expectW, captured.expectH);
  if (!check.ok) throw new CaptureError("IMAGE_INVALID", check.reason);
  if (check.warning) env.log.warn(check.warning);

  const filename = buildFilename(
    { width: opts.width, height: opts.height, dpr: opts.dpr, mode: opts.mode, format: opts.format },
    env.now(),
  );
  const mime = opts.format === "png" ? "image/png" : "image/jpeg";
  // Annotate hands the picture to a full extension page instead of saving it here.
  if (opts.annotate) {
    await openImagePage(jobId, captured.data, mime, filename, "annotate");
    env.log.info(en.logs.annotateOpened);
    return { filename, width: check.info.width, height: check.info.height };
  }

  env.report(jobId, { step: en.steps.saving, progress: 5 });
  await env.saveImage(jobId, captured.data, mime, filename, opts.saveAs);
  env.log.success(en.logs.saved(filename, check.info.width, check.info.height));
  if (opts.copyToClipboard) {
    await openImagePage(jobId, captured.data, mime, filename, "copy");
    env.log.info(en.logs.copied);
  }
  return { filename, width: check.info.width, height: check.info.height };
}

/** Stores the captured image for a focused extension page to copy or annotate. */
async function openImagePage(
  jobId: string,
  base64: string,
  mime: string,
  filename: string,
  page: "copy" | "annotate",
): Promise<void> {
  await chrome.storage.session.set({
    "spectra-pending-image": { jobId, base64, mime, filename },
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`${page}.html`) });
}

