import { en } from "../i18n/en";
import { CaptureError } from "../shared/errors";
import type { ImageFormat, Region } from "../shared/types";
import type { CommandSender } from "./debugger-session";

function requireData(response: { data?: unknown } | undefined): string {
  if (!response || typeof response.data !== "string" || response.data.length === 0) {
    throw new CaptureError("IMAGE_INVALID", en.notes.emptyImage);
  }
  return response.data;
}

/** quality applies to JPEG only. fromSurface is set explicitly, though the protocol defaults to true. */
function screenshotParams(format: ImageFormat, quality: number): Record<string, unknown> {
  return format === "jpeg" ? { format, quality, fromSurface: true } : { format, fromSurface: true };
}

/** The visible viewport only, at the emulated size. */
export async function captureViewport(cdp: CommandSender, format: ImageFormat, quality: number): Promise<string> {
  return requireData(
    await cdp.send<{ data?: unknown }>("Page.captureScreenshot", {
      ...screenshotParams(format, quality),
      captureBeyondViewport: false,
    }),
  );
}

/** A user-picked document rectangle, captured with the same explicit-clip path as full page. */
export async function captureRegion(
  cdp: CommandSender,
  region: Region,
  format: ImageFormat,
  quality: number,
): Promise<string> {
  return requireData(
    await cdp.send<{ data?: unknown }>("Page.captureScreenshot", {
      ...screenshotParams(format, quality),
      captureBeyondViewport: true,
      clip: { x: region.x, y: region.y, width: region.width, height: region.height, scale: 1 },
    }),
  );
}

/**
 * The full page: an explicit clip covering the CSS content height, with captureBeyondViewport.
 * The clip is explicit, so the output size is known before the image arrives and can be checked.
 */
export async function captureFullPage(
  cdp: CommandSender,
  cssWidth: number,
  cssHeight: number,
  format: ImageFormat,
  quality: number,
): Promise<string> {
  return requireData(
    await cdp.send<{ data?: unknown }>("Page.captureScreenshot", {
      ...screenshotParams(format, quality),
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: cssWidth, height: cssHeight, scale: 1 },
    }),
  );
}
