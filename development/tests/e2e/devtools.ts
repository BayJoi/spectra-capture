import type { CdpTransport } from "../../../src/capture/debugger-session";

/** Minimal DevTools websocket client. It is only used by the real-browser tests. */
export class CdpSocket {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(private readonly ws: WebSocket) {
    ws.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      const waiter = message.id === undefined ? undefined : this.pending.get(message.id);
      if (!waiter || message.id === undefined) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    };
  }

  static open(url: string): Promise<CdpSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new CdpSocket(ws));
      ws.onerror = () => reject(new Error("could not open the DevTools websocket"));
    });
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * The production CdpTransport, backed by a real browser page. Each attach opens a DevTools
 * session to that page, like chrome.debugger does, and each detach closes it.
 */
export class DevToolsTransport implements CdpTransport {
  attachCount = 0;
  detachCount = 0;
  private readonly sockets = new Map<number, CdpSocket>();

  constructor(private readonly pageUrls: Map<number, string>) {}

  async attach(tabId: number, _protocolVersion?: string): Promise<void> {
    const url = this.pageUrls.get(tabId);
    if (!url) throw new Error("no page for this tab");
    this.sockets.set(tabId, await CdpSocket.open(url));
    this.attachCount += 1;
  }

  async detach(tabId: number): Promise<void> {
    this.sockets.get(tabId)?.close();
    this.sockets.delete(tabId);
    this.detachCount += 1;
  }

  async send<T>(tabId: number, method: string, params?: Record<string, unknown>): Promise<T> {
    const socket = this.sockets.get(tabId);
    if (!socket) throw new Error("not attached");
    return socket.send<T>(method, params);
  }

  async listTargets(): Promise<Array<{ tabId?: number; attached: boolean }>> {
    return [];
  }

  onDetach(_listener: (tabId: number, reason: string) => void): () => void {
    return () => undefined;
  }
}

/** Starts a headless browser with DevTools enabled, and waits until it answers. */
export async function launchBrowser(
  binary: string,
  port: number,
  profileDir: string,
): Promise<{ stop(): void; browser: CdpSocket }> {
  const proc = Bun.spawn(
    [binary, "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run",
      `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank"],
    { stdout: "ignore", stderr: "ignore" },
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const info = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };
      return { browser: await CdpSocket.open(info.webSocketDebuggerUrl), stop: () => proc.kill() };
    } catch {
      await Bun.sleep(200);
    }
  }
  proc.kill();
  throw new Error("the browser did not start in time");
}

/** Opens a blank page and returns the DevTools websocket URL of that page. */
export async function openPage(browser: CdpSocket, port: number): Promise<string> {
  const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
  const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ id: string; webSocketDebuggerUrl: string }>;
  const page = pages.find((p) => p.id === targetId);
  if (!page) throw new Error("the new page was not found");
  return page.webSocketDebuggerUrl;
}
