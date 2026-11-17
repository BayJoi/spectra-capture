/** Minimal key-value interface so logic can be unit-tested without the browser. */
export interface KeyValueArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** Wraps a `chrome.storage` area as a promise-based key-value store. */
export function chromeKv(area: chrome.storage.StorageArea): KeyValueArea {
  return {
    get: (key) => area.get(key),
    set: (items) => area.set(items),
  };
}
