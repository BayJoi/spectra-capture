import { en } from "../i18n/en";
import { CaptureError } from "../shared/errors";
import { withTimeout } from "../shared/async";

/** Abstraction over chrome.debugger, so the capture logic can be tested without a browser. */
export interface CdpTransport {
  attach(tabId: number, protocolVersion: string): Promise<void>;
  detach(tabId: number): Promise<void>;
  send<T>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T>;
  listTargets(): Promise<Array<{ tabId?: number; attached: boolean }>>;
  onDetach(listener: (tabId: number, reason: string) => void): () => void;
  /** Optional for test doubles; the real transport forwards chrome.debugger.onEvent. */
  onEvent?(listener: (tabId: number, method: string, params: Record<string, any>) => void): () => void;
}

export interface CommandSender {
  /** An optional per-call timeout, for commands that await user interaction. */
  send<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;
}

/** Protocol 1.3 is the long-standing stable version. */
export const PROTOCOL_VERSION = "1.3";
export const COMMAND_TIMEOUT_MS = 20_000;

/** Maps attach failures to our error codes. The raw browser message is never logged, because it may contain a URL. */
export function classifyAttachError(err: unknown): CaptureError {
  const message = err instanceof Error ? err.message : String(err);
  if (/restricted by policy/i.test(message)) return new CaptureError("POLICY_BLOCKED");
  if (/already attached|another debugger/i.test(message)) return new CaptureError("DEBUGGER_BUSY");
  if (/cannot access|chrome:\/\/|not allowed/i.test(message)) return new CaptureError("RESTRICTED_URL");
  return new CaptureError("ATTACH_FAILED");
}

/**
 * Owns one debugger attachment. It detaches only sessions it attached itself. It also records
 * when the browser detaches it (for example, after the user presses Cancel on the banner).
 */
export class DebuggerSession implements CommandSender {
  private attached = false;
  private browserDetachReason: string | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly transport: CdpTransport,
    private readonly tabId: number,
    private readonly commandTimeoutMs: number = COMMAND_TIMEOUT_MS,
  ) {}

  get detachedBy(): string | null {
    return this.browserDetachReason;
  }

  /** Clears a detach reason after this session intentionally detaches and re-attaches. */
  clearDetachReason(): void {
    this.browserDetachReason = null;
  }

  async attach(): Promise<void> {
    const targets = await this.transport.listTargets().catch(() => []);
    if (targets.some((t) => t.tabId === this.tabId && t.attached)) {
      throw new CaptureError("DEBUGGER_BUSY");
    }
    try {
      await this.transport.attach(this.tabId, PROTOCOL_VERSION);
    } catch (err) {
      throw classifyAttachError(err);
    }
    this.attached = true;
    this.unsubscribe = this.transport.onDetach((tabId, reason) => {
      if (tabId !== this.tabId) return;
      this.attached = false;
      this.browserDetachReason = reason;
    });
  }

  async send<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (!this.attached) throw new CaptureError("DETACHED");
    try {
      return await withTimeout(
        this.transport.send<T>(this.tabId, method, params),
        timeoutMs ?? this.commandTimeoutMs,
        en.labels.browserStep,
      );
    } catch (err) {
      if (err instanceof CaptureError) throw err;
      throw new CaptureError("PROTOCOL");
    }
  }

  /** Detaches only if this object attached successfully. Safe to call more than once. */
  async detach(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (!this.attached) return;
    this.attached = false;
    try {
      await this.transport.detach(this.tabId);
    } catch {
      // The tab may already be closed or detached. Nothing more to do.
    }
  }
}
