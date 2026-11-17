import { decodeBase64 } from "../shared/base64";
import type { OffscreenRequest, OffscreenResponse } from "../shared/messages";

/** Blob parts are held per job. They are dropped as soon as the blob URL is created. */
const jobs = new Map<string, { mime: string; parts: Uint8Array<ArrayBuffer>[]; url?: string }>();

function handle(message: OffscreenRequest): OffscreenResponse {
  switch (message.type) {
    case "BEGIN":
      jobs.set(message.jobId, { mime: message.mime, parts: [] });
      return { ok: true };
    case "CHUNK": {
      const job = jobs.get(message.jobId);
      if (!job || message.data.length > 8 * 1024 * 1024) return { ok: false, reason: "bad-chunk" };
      job.parts.push(decodeBase64(message.data));
      return { ok: true };
    }
    case "FINISH": {
      const job = jobs.get(message.jobId);
      if (!job) return { ok: false, reason: "unknown-job" };
      const blob = new Blob(job.parts, { type: job.mime });
      job.parts = [];
      job.url = URL.createObjectURL(blob);
      return { ok: true, url: job.url };
    }
    case "RELEASE": {
      const job = jobs.get(message.jobId);
      if (job?.url) URL.revokeObjectURL(job.url);
      jobs.delete(message.jobId);
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message !== "object" || message === null || (message as { target?: unknown }).target !== "offscreen") {
    return false;
  }
  try {
    sendResponse(handle(message as OffscreenRequest));
  } catch {
    sendResponse({ ok: false, reason: "offscreen-error" });
  }
  return false;
});
