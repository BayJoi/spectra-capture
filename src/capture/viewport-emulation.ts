import type { CommandSender } from "./debugger-session";

/**
 * Sets a virtual viewport. Width and height are CSS pixels; deviceScaleFactor sets output density.
 * mobile stays false, so touch and meta-viewport emulation are NOT applied (documented limitation).
 */
export async function applyViewport(cdp: CommandSender, width: number, height: number, dpr: number): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: dpr,
    mobile: false,
  });
}

export async function clearViewport(cdp: CommandSender): Promise<void> {
  await cdp.send("Emulation.clearDeviceMetricsOverride");
}
