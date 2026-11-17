import type { CdpTransport } from "../../../src/capture/debugger-session";
import type { CaptureEnv, Timeouts } from "../../../src/capture/capture-controller";
import type { JobState, LogLevel } from "../../../src/shared/types";
import type { KeyValueArea } from "../../../src/shared/kv";

/** In-memory key-value storage, shared by every test that needs chrome.storage behaviour. */
export class MemoryArea implements KeyValueArea {
  data: Record<string, unknown> = {};
  async get(key: string): Promise<Record<string, unknown>> {
    return key in this.data ? { [key]: this.data[key] } : {};
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }
}

/** Minimal valid PNG header (IHDR only) as base64, at least 64 characters long. */
export function pngHeaderBase64(width: number, height: number): string {
  const bytes = new Uint8Array(48);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set(new TextEncoder().encode("IHDR"), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return Buffer.from(bytes).toString("base64");
}

type DetachListener = (tabId: number, reason: string) => void;

/** Records every protocol call. Behaviour is switched on by the test, so no real browser is involved. */
export class FakeTransport implements CdpTransport {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  attachCalls: string[] = [];
  detachCount = 0;
  clearCount = 0;
  targets: Array<{ tabId?: number; attached: boolean }> = [];
  attachError: Error | null = null;
  captureError: Error | null = null;
  hangOnCapture = false;
  readyState = "complete";
  contentSize = { x: 0, y: 0, width: 1440, height: 3200 };
  imageWidth = 0;
  imageHeight = 0;
  onCapture: (() => void) | null = null;
  private listeners = new Set<DetachListener>();

  async attach(_tabId: number, version: string): Promise<void> {
    if (this.attachError) throw this.attachError;
    this.attachCalls.push(version);
  }

  async detach(): Promise<void> {
    this.detachCount += 1;
    this.calls.push({ method: "Debugger.detach" });
  }

  async send<T>(_tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
    this.calls.push({ method, params });
    switch (method) {
      case "Emulation.setDeviceMetricsOverride":
        return {} as T;
      case "Emulation.clearDeviceMetricsOverride":
        this.clearCount += 1;
        return {} as T;
      case "Runtime.evaluate": {
        const expression = String(params?.expression ?? "");
        if (expression === "document.readyState") return { result: { type: "string", value: this.readyState } } as T;
        return { result: { type: "object", value: { steps: 3, height: this.contentSize.height } } } as T;
      }
      case "Page.getLayoutMetrics":
        return { cssContentSize: this.contentSize } as T;
      case "Page.captureScreenshot":
        this.onCapture?.();
        if (this.captureError) throw this.captureError;
        if (this.hangOnCapture) return new Promise<T>(() => undefined);
        return { data: pngHeaderBase64(this.imageWidth, this.imageHeight) } as T;
      default:
        throw new Error(`unexpected method in test: ${method}`);
    }
  }

  async listTargets(): Promise<Array<{ tabId?: number; attached: boolean }>> {
    return this.targets;
  }

  onDetach(listener: DetachListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitDetach(tabId: number, reason: string): void {
    for (const listener of this.listeners) listener(tabId, reason);
  }

  methods(): string[] {
    return this.calls.map((c) => c.method);
  }

  paramsFor(method: string): Record<string, unknown> | undefined {
    return this.calls.find((c) => c.method === method)?.params;
  }
}

export interface SavedImage {
  jobId: string;
  base64: string;
  mime: string;
  filename: string;
}

export interface TestEnvOptions {
  url?: string;
  tabId?: number;
  navigated?: boolean;
  timeouts?: Partial<Timeouts>;
}

export interface TestEnv {
  env: CaptureEnv;
  saved: SavedImage[];
  logs: Array<{ level: LogLevel; message: string }>;
  reports: Array<Partial<JobState>>;
  disposed: () => number;
  setNavigated: (value: boolean) => void;
}

/** Builds a CaptureEnv whose tab, navigation, and saving are all scripted by the test. */
export function makeEnv(fake: FakeTransport, options: TestEnvOptions = {}): TestEnv {
  const saved: SavedImage[] = [];
  const logs: Array<{ level: LogLevel; message: string }> = [];
  const reports: Array<Partial<JobState>> = [];
  let navigated = options.navigated ?? false;
  let disposeCount = 0;
  const tabId = options.tabId ?? 7;
  const url = options.url ?? "https://example.com/";

  const record = (level: LogLevel) => (message: string) => logs.push({ level, message });
  const env: CaptureEnv = {
    transport: fake,
    async getActiveTab() {
      return { id: tabId, url };
    },
    watchNavigation: () => ({
      aborted: () => navigated,
      dispose: () => {
        disposeCount += 1;
      },
    }),
    async saveImage(jobId, base64, mime, filename) {
      saved.push({ jobId, base64, mime, filename });
    },
    report: (_jobId, patch) => reports.push(patch),
    log: {
      info: record("info"),
      progress: record("progress"),
      success: record("success"),
      warn: record("warn"),
      error: record("error"),
    },
    now: () => new Date(2026, 10, 14, 9, 5, 7),
    timeouts: { command: 500, ready: 300, capture: 300, settle: 1, ...options.timeouts },
  };
  return {
    env,
    saved,
    logs,
    reports,
    disposed: () => disposeCount,
    setNavigated: (value) => {
      navigated = value;
    },
  };
}

export const baseOptions = {
  width: 1440,
  height: 900,
  dpr: 1,
  mode: "viewport",
  format: "png",
  quality: 92,
  warmUp: false,
  confirmLarge: false,
  delay: 0,
  darkMode: false,
  hideFixed: false,
  saveAs: false,
  copyToClipboard: false,
  annotate: false,
} as const;
