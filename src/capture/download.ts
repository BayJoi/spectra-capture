import { CaptureError } from "../shared/errors";
import { notifySaved } from "../shared/notify";
import type { OffscreenRequest, OffscreenResponse } from "../shared/messages";

/**
 * Sends the image to the offscreen document in chunks. Each chunk is a multiple of 4 base64
 * characters, so it decodes on its own, and no single message is large.
 */
export const CHUNK_CHARS = 4 * 1024 * 1024;
const OFFSCREEN_PATH = "offscreen.html";
const DOWNLOAD_TIMEOUT_MS = 60_000;

const failed = (): CaptureError => new CaptureError("DOWNLOAD_FAILED");

async function ensureOffscreen(): Promise<void> {
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  if (existing.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.BLOBS],
    justification: "Create a temporary local blob URL so the browser can save the captured image.",
  });
}

const send = <T extends OffscreenResponse>(message: OffscreenRequest): Promise<T> =>
  chrome.runtime.sendMessage<OffscreenRequest, T>(message);

/** Resolves when the download completes. Also checks the current state, in case it already finished. */
export function waitForDownload(id: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: CaptureError): void => {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const listener = (delta: chrome.downloads.DownloadDelta): void => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === "complete") finish();
      else if (delta.state.current === "interrupted") finish(failed());
    };
    const timer = setTimeout(() => finish(failed()), DOWNLOAD_TIMEOUT_MS);
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads
      .search({ id })
      .then(([item]) => {
        if (item?.state === "complete") finish();
        else if (item?.state === "interrupted") finish(failed());
      })
      .catch(() => undefined);
  });
}

/** Saves the image through a blob URL in the offscreen document, then releases the blob and closes the document. */
export async function saveImage(
  jobId: string,
  base64: string,
  mime: string,
  filename: string,
  saveAs = false,
): Promise<void> {
  await ensureOffscreen();
  try {
    if (!(await send({ target: "offscreen", type: "BEGIN", jobId, mime })).ok) throw failed();
    for (let offset = 0; offset < base64.length; offset += CHUNK_CHARS) {
      const data = base64.slice(offset, offset + CHUNK_CHARS);
      if (!(await send({ target: "offscreen", type: "CHUNK", jobId, data })).ok) throw failed();
    }
    const finished = await send({ target: "offscreen", type: "FINISH", jobId });
    if (!finished.ok || !finished.url) throw failed();

    // When saveAs is off we omit the field so the browser's own preference governs.
    const downloadId = await chrome.downloads
      .download({ url: finished.url, filename, conflictAction: "uniquify", ...(saveAs ? { saveAs: true } : {}) })
      .catch(() => {
        throw failed();
      });
    await waitForDownload(downloadId);
    void notifySaved(downloadId, filename);
  } finally {
    await send({ target: "offscreen", type: "RELEASE", jobId }).catch(() => undefined);
    await chrome.offscreen.closeDocument().catch(() => undefined);
  }
}
