import { chromium, type BrowserContext } from "playwright";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

/**
 * Loads a real built extension into Playwright's Chromium persistent context.
 *
 * `grantTabs` writes a throwaway copy of the manifest with the `tabs` permission. Playwright
 * cannot click a browser toolbar icon, so the `activeTab` grant a real user gets is unavailable;
 * this is a test-harness-only change, never part of a shipped manifest.
 */
export async function launchExtension(
  buildDir = "dist",
  grantTabs = false,
  deviceScaleFactor = 1,
): Promise<{ context: BrowserContext; extensionId: string; cleanup(): Promise<void> }> {
  const raw = join(import.meta.dir, "..", "..", "..", buildDir);
  let pathToExtension = raw.replace(/\\/g, "/");
  let temp: string | null = null;

  if (grantTabs) {
    temp = join(tmpdir(), `spectra-pw-ext-${process.pid}`);
    await rm(temp, { recursive: true, force: true });
    await mkdir(temp, { recursive: true });
    await cp(raw, temp, { recursive: true });
    const manifestPath = join(temp, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { permissions: string[] };
    if (!manifest.permissions.includes("tabs")) manifest.permissions.push("tabs");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    pathToExtension = temp.replace(/\\/g, "/");
  }

  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${pathToExtension}`, `--load-extension=${pathToExtension}`],
    acceptDownloads: true,
    deviceScaleFactor,
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  return {
    context,
    extensionId,
    cleanup: async () => {
      await context.close();
      if (temp) await rm(temp, { recursive: true, force: true });
    },
  };
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
