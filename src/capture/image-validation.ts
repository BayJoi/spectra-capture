import { en } from "../i18n/en";
import { base64Prefix, decodeBase64, looksLikeBase64 } from "../shared/base64";

export interface ImageInfo {
  format: "png" | "jpeg";
  width: number;
  height: number;
}

export type DimensionCheck = { ok: true; info: ImageInfo; warning?: string } | { ok: false; reason: string };

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const at = (bytes: Uint8Array, i: number): number => bytes[i] ?? 0;

function readPng(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((value, i) => at(bytes, i) === value)) return null;
  if (String.fromCharCode(at(bytes, 12), at(bytes, 13), at(bytes, 14), at(bytes, 15)) !== "IHDR") return null;
  const u32 = (i: number): number =>
    at(bytes, i) * 2 ** 24 + (at(bytes, i + 1) << 16) + (at(bytes, i + 2) << 8) + at(bytes, i + 3);
  return { format: "png", width: u32(16), height: u32(20) };
}

function readJpeg(bytes: Uint8Array): ImageInfo | null {
  if (at(bytes, 0) !== 0xff || at(bytes, 1) !== 0xd8) return null;
  let p = 2;
  while (p + 3 < bytes.length) {
    if (at(bytes, p) !== 0xff) return null;
    const marker = at(bytes, p + 1);
    if (marker === 0xff) {
      p += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    if (marker === 0xd9) return null;
    const segmentLength = (at(bytes, p + 2) << 8) | at(bytes, p + 3);
    if (segmentLength < 2) return null;
    if (SOF_MARKERS.has(marker)) {
      if (p + 8 >= bytes.length) return null;
      return {
        format: "jpeg",
        height: (at(bytes, p + 5) << 8) | at(bytes, p + 6),
        width: (at(bytes, p + 7) << 8) | at(bytes, p + 8),
      };
    }
    p += 2 + segmentLength;
  }
  return null;
}

/** Reads width and height from a PNG or JPEG header. Returns null for anything else. */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  return readPng(bytes) ?? readJpeg(bytes);
}

/**
 * Reads header info from base64. It decodes a 512 KB prefix first, which covers PNG and most JPEG
 * headers, and decodes the whole payload only when the prefix is not enough.
 */
export function readImageInfoFromBase64(data: string): ImageInfo | null {
  if (!looksLikeBase64(data)) return null;
  try {
    const fromHead = readImageInfo(decodeBase64(base64Prefix(data, 512 * 1024)));
    return fromHead ?? readImageInfo(decodeBase64(data));
  } catch {
    return null;
  }
}

/** Compares the decoded size with the expected size. Small rounding differences are allowed. */
export function checkDimensions(info: ImageInfo | null, expectedW: number, expectedH: number): DimensionCheck {
  if (!info || info.width < 1 || info.height < 1) return { ok: false, reason: en.logs.headerUnreadable };
  const dw = Math.abs(info.width - expectedW);
  const dh = Math.abs(info.height - expectedH);
  const tolW = Math.max(2, Math.ceil(expectedW * 0.002));
  const tolH = Math.max(2, Math.ceil(expectedH * 0.002));
  if (dw > tolW || dh > tolH) {
    return { ok: false, reason: en.logs.sizeMismatch(info.width, info.height, expectedW, expectedH) };
  }
  if (dw > 0 || dh > 0) {
    return { ok: true, info, warning: en.logs.roundingOk(info.width, info.height, expectedW, expectedH) };
  }
  return { ok: true, info };
}
