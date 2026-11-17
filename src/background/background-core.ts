import { en } from "../i18n/en";
import { runCapture, type CaptureEnv } from "../capture/capture-controller";
import { CaptureError } from "../shared/errors";
import { createLogger, newEntryId } from "../shared/log";
import { createSessionLogSink, readJob, writeJob } from "../shared/job-store";
import type { KeyValueArea } from "../shared/kv";
import { isStartRequest, type StartResponse, type TargetTab } from "../shared/messages";
import type { JobState } from "../shared/types";
import { toMegapixels, validateCaptureOptions } from "../validation/dimensions";

export interface BackgroundConfig {
  /** Where the job record and console live (chrome.storage.session). */
  session: KeyValueArea;
  env: CaptureEnv;
  /** Called once at startup so a job interrupted by a worker/page restart can be cleaned up. */
  recover?: (job: JobState) => Promise<void>;
}

/**
 * Platform-independent background behaviour: one job at a time, a job record in storage,
 * a console log, recovery after a restart, and the popup message handler.
 */
export function createBackground(config: BackgroundConfig): void {
  const { session, env } = config;
  const log = env.log ?? createLogger(createSessionLogSink(session));
  let activeJobId: string | null = null;
  let current: JobState | null = null;

  /** Updates the job record. Only the background writes it; the popup only reads it. */
  function report(jobId: string, patch: Partial<JobState>): void {
    if (!current || current.jobId !== jobId) return;
    if (patch.step && patch.step !== current.step) log.progress(patch.step);
    current = { ...current, ...patch, updatedAt: Date.now() };
    void writeJob(session, current).catch(() => undefined);
  }

  // The controller reports through the same function that owns `current`.
  env.report = report;
  if (!env.log) env.log = log;

  function endJob(): void {
    activeJobId = null;
  }

  async function beginJob(step: string): Promise<string | null> {
    if (activeJobId) {
      log.warn(en.logs.alreadyRunning);
      return null;
    }
    const jobId = newEntryId();
    activeJobId = jobId;
    current = { jobId, status: "running", step, progress: 0, updatedAt: Date.now() };
    try {
      await writeJob(session, current);
    } catch (err) {
      endJob();
      current = null;
      throw err;
    }
    log.progress(step);
    return jobId;
  }

  async function runCaptureJob(jobId: string, input: unknown, tab?: TargetTab): Promise<void> {
    try {
      await runCapture(jobId, input, env, tab);
      report(jobId, { status: "done", step: en.steps.saved, progress: 5, code: undefined, pixels: undefined });
    } catch (err) {
      if (err instanceof CaptureError && err.code === "CONFIRM_REQUIRED") {
        const pixels = err.details.pixels ?? 0;
        report(jobId, { status: "needs-confirm", step: en.steps.waitingConfirm, pixels });
        log.warn(en.logs.confirmNeeded(String(toMegapixels(pixels))));
        return;
      }
      const code = err instanceof CaptureError ? err.code : "UNKNOWN";
      const message = err instanceof CaptureError ? err.message : en.logs.unexpected;
      log.error(`${message} [${code}]`);
      report(jobId, { status: "failed", step: en.steps.stopped, code });
    }
  }

  async function handleStart(options: unknown, tab?: TargetTab): Promise<StartResponse> {
    const checked = validateCaptureOptions(options);
    if (!checked.ok) {
      log.warn(checked.message);
      return { ok: false, code: "INVALID_INPUT" };
    }
    const jobId = await beginJob(en.steps.started);
    if (!jobId) return { ok: false, code: "BUSY" };
    void runCaptureJob(jobId, checked.value, tab).finally(endJob);
    return { ok: true, jobId };
  }

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isStartRequest(message)) {
      handleStart(message.options, message.tab).then(sendResponse, () => sendResponse({ ok: false, code: "UNKNOWN" }));
      return true;
    }
    return false;
  });

  async function recoverInterruptedJob(): Promise<void> {
    const previous = await readJob(session).catch(() => null);
    if (!previous || previous.status !== "running") return;
    if (config.recover) await config.recover(previous).catch(() => undefined);
    log.warn(en.logs.restarted);
    await writeJob(session, {
      ...previous,
      status: "failed",
      step: en.steps.interrupted,
      code: "INTERRUPTED",
      tabId: undefined,
      updatedAt: Date.now(),
    }).catch(() => undefined);
  }

  void recoverInterruptedJob();
}
