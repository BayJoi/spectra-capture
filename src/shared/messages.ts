import type { CaptureOptions } from "./types";
import type { ErrorCode } from "./errors";

/** Popup -> service worker: capture one picture. The worker validates again. */
export interface TargetTab {
  id: number;
  url?: string;
}

export interface StartRequest {
  type: "START_CAPTURE";
  options: CaptureOptions;
  /**
   * The tab the user was on when the popup was opened. The popup resolves this in its own
   * context (`currentWindow`) because the service worker's `lastFocusedWindow` can drift to a
   * DevTools window or another tab, and Chrome 153+ scrubs `tab.url` on restricted pages.
   */
  tab?: TargetTab;
}

export type StartResponse = { ok: true; jobId: string } | { ok: false; code: ErrorCode };

export function isStartRequest(value: unknown): value is StartRequest {
  return typeof value === "object" && value !== null && (value as { type?: unknown }).type === "START_CAPTURE";
}

/** Service worker -> offscreen document. Builds a blob URL for the download. */
export type OffscreenRequest =
  | { target: "offscreen"; type: "BEGIN"; jobId: string; mime: string }
  | { target: "offscreen"; type: "CHUNK"; jobId: string; data: string }
  | { target: "offscreen"; type: "FINISH"; jobId: string }
  | { target: "offscreen"; type: "RELEASE"; jobId: string };

export type OffscreenResponse = { ok: true; url?: string } | { ok: false; reason: string };
