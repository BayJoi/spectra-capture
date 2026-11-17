import { en } from "../i18n/en";
import { chromeTransport, watchTabNavigation } from "../capture/chrome-transport";
import { DEFAULT_TIMEOUTS, type CaptureEnv } from "../capture/capture-controller";
import { saveImage } from "../capture/download";
import { clearPickerArtifacts } from "../capture/effects";
import { PROTOCOL_VERSION, type CommandSender } from "../capture/debugger-session";
import { createLogger } from "../shared/log";
import { createSessionLogSink, readJob, writeJob } from "../shared/job-store";
import { chromeKv } from "../shared/kv";
import type { JobState } from "../shared/types";
import { createBackground } from "./background-core";

const session = chromeKv((chrome.storage.session ?? chrome.storage.local) as chrome.storage.StorageArea);
const log = createLogger(createSessionLogSink(session));

const env: CaptureEnv = {
  transport: chromeTransport,
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true, windowType: "normal" });
    return tab ? { id: tab.id, url: tab.url } : undefined;
  },
  watchNavigation: watchTabNavigation,
  saveImage,
  // createBackground replaces this with the function that owns the in-memory job record.
  report: () => undefined,
  log,
  now: () => new Date(),
  timeouts: DEFAULT_TIMEOUTS,
};

createBackground({
  session,
  env,
  recover: async (job) => {
    const tabId = job.tabId;
    if (typeof tabId !== "number") return;
    const targets = await chromeTransport.listTargets().catch(() => []);
    if (targets.some((t) => t.tabId === tabId && t.attached)) {
      await chromeTransport.detach(tabId).catch(() => undefined);
    }
    // Detaching alone leaves an injected picker overlay (and its input-blocking listeners) in the
    // page. Re-attach briefly to run the same cleanup expression, then detach again.
    try {
      await chromeTransport.attach(tabId, PROTOCOL_VERSION);
      const sender: CommandSender = {
        send: (method, params) => chromeTransport.send(tabId, method, params),
      };
      await clearPickerArtifacts(sender);
    } catch {
      // Best effort: the tab may have navigated or closed.
    }
    await chromeTransport.detach(tabId).catch(() => undefined);
  },
});

/** The browser detached the debugger. Forget the tab so recovery never acts on a session that is no longer ours. */
chromeTransport.onDetach((tabId, reason) => {
  void (async () => {
    const job = await readJob(session).catch(() => null);
    if (!job || job.tabId !== tabId) return;
    log.warn(en.logs.browserDetached(reason));
    const next: JobState = { ...job, tabId: undefined, updatedAt: Date.now() };
    await writeJob(session, next).catch(() => undefined);
  })();
});
