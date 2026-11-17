import { en } from "../i18n/en";
import { sleep } from "../shared/async";
import { CaptureError } from "../shared/errors";
import type { CommandSender } from "./debugger-session";

interface LayoutMetrics {
  cssContentSize?: { x: number; y: number; width: number; height: number };
}

/** The full scrollable size in CSS pixels. The deprecated `contentSize` field is not used. */
export async function getContentSize(cdp: CommandSender): Promise<{ width: number; height: number }> {
  const size = (await cdp.send<LayoutMetrics>("Page.getLayoutMetrics")).cssContentSize;
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.height <= 0) {
    throw new CaptureError("PROTOCOL", en.notes.noCssHeight);
  }
  return { width: size.width, height: size.height };
}

/** Runs a fixed expression in the page. Only the returned value comes back, never page content. */
export async function evaluate<T>(cdp: CommandSender, expression: string): Promise<T> {
  const response = await cdp.send<{ result?: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails) throw new CaptureError("PROTOCOL");
  return response.result?.value as T;
}

/** Polls document.readyState until it reads "complete", or fails after the timeout. */
export async function waitForReady(cdp: CommandSender, aborted: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (aborted()) throw new CaptureError("NAVIGATED");
    if ((await evaluate<string>(cdp, "document.readyState")) === "complete") return;
    if (Date.now() >= deadline) throw new CaptureError("TIMEOUT", `${en.labels.pageLoad} took too long.`);
    await sleep(250);
  }
}

/**
 * Scrolls down in steps so lazy images can load, then returns to the top.
 * It is bounded (80 steps at most) and reads only the scroll height.
 */
export const WARM_UP_EXPRESSION = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  let limit = document.documentElement.scrollHeight;
  let steps = 0;
  for (let y = 0; y < limit && steps < 80; y += step, steps += 1) {
    window.scrollTo(0, y);
    await pause(150);
    limit = Math.max(limit, document.documentElement.scrollHeight);
  }
  window.scrollTo(0, 0);
  await pause(300);
  return { steps: steps, height: document.documentElement.scrollHeight };
})()`;

export async function warmUpLazyContent(cdp: CommandSender): Promise<{ steps: number; height: number }> {
  return (await evaluate<{ steps: number; height: number } | undefined>(cdp, WARM_UP_EXPRESSION)) ?? { steps: 0, height: 0 };
}
