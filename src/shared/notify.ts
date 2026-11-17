import { loadPrefs } from "../settings/settings-store";
import { chromeKv } from "./kv";

/**
 * Best-effort confirmation that a screenshot was saved. Chrome does not always open its downloads
 * shelf for programmatic downloads, so a system notification gives the user reliable feedback.
 * It never fails a capture: a notification error or unsupported API silently no-ops, and a failed
 * preference read keeps the default (on).
 */
export async function notifySaved(downloadId: number, filename: string): Promise<void> {
  // The Settings tab lets the user turn these off. Read the saved preference in the worker so the
  // choice applies to the notification itself, without adding a field to the capture options.
  const prefs = await loadPrefs(chromeKv(chrome.storage.local)).catch(() => null);
  if (prefs?.notifications === false) return;

  let message = filename;
  try {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.filename) message = item.filename;
  } catch {
    // Keep the filename we already have.
  }

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-48.png"),
      title: "Spectra Capture — saved",
      message,
    });
  } catch {
    // Notifications are optional feedback, never a reason to fail a save.
  }
}
