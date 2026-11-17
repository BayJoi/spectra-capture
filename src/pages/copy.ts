/**
 * Copy page: reads the pending capture from chrome.storage.session and writes it to the system
 * clipboard as image/png. A JPEG source is converted through a canvas first, because Chromium's
 * clipboard only accepts PNG for image writes. Save is offered as a fallback on any failure.
 */

export {};

import { safeDownloadName } from "../validation/filename";

const PENDING_KEY = "spectra-pending-image";

interface PendingImage {
  jobId: string;
  base64: string;
  mime: "image/png" | "image/jpeg";
  filename: string;
}

type StatusState = "loading" | "success" | "error" | "empty";

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
};

const thumb = el<HTMLImageElement>("thumb");
const previewMeta = el<HTMLElement>("preview-meta");
const statusPanel = el<HTMLElement>("status-panel");
const statusTitle = el<HTMLElement>("status-title");
const statusDetail = el<HTMLElement>("status-detail");
const statusLive = el<HTMLElement>("status-live");
const keepOpen = el<HTMLInputElement>("keep-open");
const retryBtn = el<HTMLButtonElement>("retry-copy");
const downloadBtn = el<HTMLButtonElement>("download");

let pending: PendingImage | null = null;
let blob: Blob | null = null;
let thumbUrl: string | null = null;
let closed = false;

/** Decodes a raw base64 payload (no data: prefix) into a typed Blob. */
function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Re-encodes any image blob as a PNG, which is the only image type the clipboard accepts. */
async function toPng(source: Blob): Promise<Blob> {
  const canvas = document.createElement("canvas");
  let width = 0;
  let height = 0;

  if (typeof createImageBitmap === "function") {
    const bitmap: ImageBitmap = await createImageBitmap(source);
    width = bitmap.width;
    height = bitmap.height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas context");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } else {
    const url = URL.createObjectURL(source);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Image decode failed"));
        img.src = url;
      });
      width = image.naturalWidth;
      height = image.naturalHeight;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("No 2D canvas context");
      ctx.drawImage(image, 0, 0);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("PNG encode failed"));
    }, "image/png");
  });
}

function setStatus(state: StatusState, title: string, detail: string): void {
  statusPanel.dataset.state = state;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  statusLive.textContent = `${title}. ${detail}`.trim();
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Closes this tab after a short pause on success, unless the user asked to keep it open. */
async function closeSoon(delay = 2500): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  if (keepOpen.checked || closed) return;
  closed = true;
  try {
    const tab = await chrome.tabs.getCurrent();
    if (typeof tab?.id === "number") await chrome.tabs.remove(tab.id);
  } catch {
    // The user may have closed the tab already; nothing else to do.
  }
}

async function doCopy(): Promise<void> {
  if (!blob) return;
  retryBtn.disabled = true;
  setStatus("loading", "Copying…", "Writing the image to the clipboard");
  try {
    const png = blob.type === "image/png" ? blob : await toPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    setStatus("success", "Copied to clipboard", "You can paste it anywhere with Ctrl+V.");
    void closeSoon(2500);
  } catch {
    setStatus("error", "Couldn't copy — use Save instead", "The browser blocked clipboard access. Save the image with the button below.");
  } finally {
    retryBtn.disabled = false;
  }
}

async function doDownload(): Promise<void> {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({
      url,
      filename: safeDownloadName(pending?.filename ?? "spectra-capture.png"),
      conflictAction: "uniquify",
      saveAs: false,
    });
    // Revoke as soon as the download reports completion, with a long safety fallback.
    const onChange = (delta: chrome.downloads.DownloadDelta): void => {
      const state = delta.state as { current?: string } | undefined;
      if (delta.id === id && state?.current === "complete") {
        chrome.downloads.onChanged.removeListener(onChange);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    };
    chrome.downloads.onChanged.addListener(onChange);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setStatus("success", "Saved to Downloads", "The image was saved instead of copied.");
  } catch {
    URL.revokeObjectURL(url);
    setStatus("error", "Could not save", "Check your download settings and try again.");
  }
}

async function loadPending(): Promise<PendingImage | null> {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const raw: unknown = stored[PENDING_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record["base64"] !== "string") return null;
  const mime = record["mime"];
  if (mime !== "image/png" && mime !== "image/jpeg") return null;
  return {
    jobId: typeof record["jobId"] === "string" ? record["jobId"] : "",
    base64: record["base64"],
    mime,
    filename: typeof record["filename"] === "string" ? record["filename"] : "spectra-capture.png",
  };
}

async function applyTheme(): Promise<void> {
  let motionOn = true;
  try {
    const stored = await chrome.storage.local.get("prefs");
    const prefs = stored["prefs"] as Record<string, unknown> | undefined;
    if (prefs && prefs["theme"] === "dark") document.documentElement.dataset.theme = "dark";
    if (prefs && prefs["motion"] === false) motionOn = false;
  } catch {
    // Defaults already applied in the markup.
  }
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.dataset.motion = motionOn && !reduced ? "on" : "off";
}

function wire(): void {
  retryBtn.addEventListener("click", () => void doCopy());
  downloadBtn.addEventListener("click", () => void doDownload());
  window.addEventListener("pagehide", () => {
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
  });
}

async function init(): Promise<void> {
  await applyTheme();

  try {
    pending = await loadPending();
  } catch {
    pending = null;
  }
  if (!pending) {
    setStatus("empty", "No image to copy", "Go back to the popup and capture a screenshot first.");
    return;
  }

  try {
    blob = base64ToBlob(pending.base64, pending.mime);
    thumbUrl = URL.createObjectURL(blob);
    thumb.src = thumbUrl;
    thumb.hidden = false;
    previewMeta.textContent = `${pending.mime === "image/png" ? "PNG" : "JPEG"} · ${formatBytes(blob.size)}`;
    retryBtn.disabled = false;
    downloadBtn.disabled = false;
  } catch {
    setStatus("error", "Couldn't read the image", "The captured data was invalid. Capture a new screenshot.");
    return;
  }

  await doCopy();
}

wire();
void init().catch((error: unknown) => {
  console.error("Spectra Capture: copy page failed", error);
  setStatus("error", "Couldn't copy", "Something went wrong. Try saving the image instead.");
});
