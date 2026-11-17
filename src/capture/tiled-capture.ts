import { en } from "../i18n/en";
import { CaptureError } from "../shared/errors";
import { bytesToBase64, dataUrlToBlob } from "../shared/base64";
import type { CommandSender } from "./debugger-session";

/**
 * Max device-pixel height of one screenshot tile. Chrome's per-side cap is ~16384 device pixels;
 * a screenshot clip uses CSS pixels but is rasterised at the emulated deviceScaleFactor, so a fixed
 * CSS height would exceed the cap at 2×/3×. Derive the CSS height from dpr at capture time instead.
 */
const MAX_TILE_OUTPUT_HEIGHT = 15000;

/** CSS-pixel tile height for a density, kept below the device-pixel per-side cap. */
export function tileCssHeight(dpr: number): number {
  return Math.max(1, Math.floor(MAX_TILE_OUTPUT_HEIGHT / dpr));
}

function requireData(response: { data?: unknown } | undefined): string {
  if (response && typeof response.data === "string" && response.data.length > 0) return response.data;
  throw new CaptureError("IMAGE_INVALID", en.notes.emptyImage);
}

/** Captures one bounded slice of the page. */
export async function captureTile(
  cdp: CommandSender,
  y: number,
  cssWidth: number,
  cssHeight: number,
): Promise<string> {
  return requireData(
    await cdp.send<{ data?: unknown }>("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
      clip: { x: 0, y, width: cssWidth, height: cssHeight, scale: 1 },
    }),
  );
}

/**
 * Captures a very tall page in bounded vertical slices and stitches them locally with an
 * OffscreenCanvas in the service worker. No network, no DOM page, no extra permission.
 */
export async function captureTiledFullPage(
  cdp: CommandSender,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): Promise<{ data: string; tiles: number }> {
  const outW = Math.round(cssWidth * dpr);
  const outH = Math.round(cssHeight * dpr);
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CaptureError("IMAGE_INVALID");

  const cssTileHeight = tileCssHeight(dpr);
  let y = 0;
  let tiles = 0;
  while (y < cssHeight) {
    const h = Math.min(cssTileHeight, cssHeight - y);
    const data = await captureTile(cdp, y, cssWidth, h);
    const bitmap = await createImageBitmap(await dataUrlToBlob(data));
    ctx.drawImage(bitmap, 0, Math.round(y * dpr));
    bitmap.close();
    y += h;
    tiles += 1;
  }

  const stitched = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await stitched.arrayBuffer());
  return { data: `data:image/png;base64,${bytesToBase64(bytes)}`, tiles };
}
