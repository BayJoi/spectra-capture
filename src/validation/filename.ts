import type { CaptureMode, ImageFormat } from "../shared/types";

/** Keeps letters, digits, underscore and hyphen. Everything else becomes an underscore. */
export function sanitizeFilenamePart(text: string): string {
  const cleaned = text
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return cleaned || "capture";
}

/** Local time as YYYY-MM-DD_HH-mm-ss. */
export function formatStamp(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

export interface FilenameParts {
  width: number;
  height: number;
  dpr: number;
  mode: CaptureMode;
  format: ImageFormat;
}

/** A generic name only. It never includes the page title or URL. */
export function buildFilename(parts: FilenameParts, now: Date): string {
  const dprLabel = String(parts.dpr).replace(".", "_");
  const base = sanitizeFilenamePart(
    `spectra-capture_${parts.width}x${parts.height}_dpr${dprLabel}_${parts.mode}_${formatStamp(now)}`,
  );
  return `${base}.${parts.format === "png" ? "png" : "jpg"}`;
}

/** Re-sanitizes a filename read back from storage before it is used for a download. */
export function safeDownloadName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  const base = sanitizeFilenamePart(dot > 0 ? name.slice(0, dot) : name);
  return `${base}.${ext === "jpg" || ext === "jpeg" ? "jpg" : "png"}`;
}
