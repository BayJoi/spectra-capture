import type { CdpTransport } from "./debugger-session";

/** The only file that touches the debugger API and browser tabs listeners. */
export const chromeTransport: CdpTransport = {
  attach(tabId, protocolVersion) {
    return chrome.debugger.attach({ tabId }, protocolVersion);
  },
  detach(tabId) {
    return chrome.debugger.detach({ tabId });
  },
  async send<T>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
    return (await chrome.debugger.sendCommand({ tabId }, method, params)) as T;
  },
  async listTargets() {
    const targets = await chrome.debugger.getTargets();
    return targets.map((t) => ({ tabId: t.tabId, attached: t.attached }));
  },
  onDetach(listener) {
    const handler = (source: chrome.debugger.Debuggee, reason: string): void => {
      if (typeof source.tabId === "number") listener(source.tabId, String(reason));
    };
    chrome.debugger.onDetach.addListener(handler);
    return () => chrome.debugger.onDetach.removeListener(handler);
  },
  onEvent(listener) {
    const handler = (
      source: chrome.debugger.Debuggee,
      method: string,
      params?: Record<string, any>,
    ): void => {
      if (typeof source.tabId === "number") listener(source.tabId, method, params ?? {});
    };
    chrome.debugger.onEvent.addListener(handler);
    return () => chrome.debugger.onEvent.removeListener(handler);
  },
};

export interface TabWatch {
  aborted(): boolean;
  dispose(): void;
}

/** Flags a navigation (a new "loading" status) on one tab. Removed again with dispose(). */
export function watchTabNavigation(tabId: number): TabWatch {
  let navigated = false;
  const listener = (id: number, info: chrome.tabs.OnUpdatedInfo): void => {
    if (id === tabId && info.status === "loading") navigated = true;
  };
  chrome.tabs.onUpdated.addListener(listener);
  return {
    aborted: () => navigated,
    dispose: () => chrome.tabs.onUpdated.removeListener(listener),
  };
}
