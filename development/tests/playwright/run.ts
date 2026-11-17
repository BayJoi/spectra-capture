import { launchExtension, assert } from "./helpers";

/**
 * Verifies the real popup -> service worker -> capture-controller -> console path.
 *
 * NOTE: Playwright drives Chromium over CDP, so chrome.debugger cannot also attach to a page in
 * the same browser. The actual screenshot is therefore covered by development/tests/e2e/protocol.e2e.ts,
 * which launches its own browser with a raw CDP socket. This test proves the extension wiring:
 * the popup message reaches the worker, a job record is created, and the outcome is reported
 * back to the Console and the job store.
 */
async function main(): Promise<void> {
  const { context, extensionId, cleanup } = await launchExtension("dist", true);
  try {
    const sw = context.serviceWorkers()[0]!;
    const fixtureTabId = await sw.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: "https://example.com/" });
      await chrome.tabs.update(tab.id!, { active: true });
      return tab.id!;
    });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.waitForSelector("#capture");
    await sw.evaluate(async (id: number) => {
      await chrome.tabs.update(id, { active: true });
    }, fixtureTabId);

    await popup.fill("#width", "1440");
    await popup.fill("#height", "900");
    await popup.click("#capture");

    const deadline = Date.now() + 20_000;
    let job: { status: string; step: string; code?: string } | null = null;
    while (Date.now() < deadline) {
      job = await popup.evaluate(async () => {
        const stored = await chrome.storage.session.get("job");
        return (stored.job as { status: string; step: string; code?: string } | undefined) ?? null;
      });
      if (job && job.status !== "running") break;
      await Bun.sleep(200);
    }
    assert(job, "no job record was created — the popup message never reached the worker");
    assert(
      job.status === "failed" || job.status === "done",
      `job did not reach a terminal state: ${job.status}`,
    );
    // Regression guard: the popup must pass the real web tab to the worker. Without it, Chrome
    // 153+ scrubs tab.url under activeTab alone and the job stops at RESTRICTED_URL.
    assert(
      job.code !== "RESTRICTED_URL",
      "popup did not pass the target tab — capture was refused as RESTRICTED_URL",
    );

    const logs = await popup.evaluate(async () => {
      const stored = await chrome.storage.session.get("logs");
      return Array.isArray(stored.logs) ? (stored.logs as Array<{ message: string; level: string }>) : [];
    });
    assert(logs.length > 0, "no console log was written by the worker");

    const badge = await popup.$eval("#console-badge", (node) => (node as HTMLElement).hidden);
    assert(badge === false, "the console badge did not show the error count");

    console.log(`PASS message flow: job ${job.status} (${job.code ?? "no code"}), ${logs.length} console entries`);
  } finally {
    await cleanup();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
