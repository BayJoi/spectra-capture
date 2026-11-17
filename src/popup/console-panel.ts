import type { LogEntry, LogLevel } from "../shared/types";
import { pulse } from "./motion";

export interface ConsoleHandlers {
  onClear(): void;
  onCopy(text: string): void;
}

const TAG: Record<LogLevel, string> = { info: "INFO", progress: "STEP", success: "DONE", warn: "WARN", error: "ERROR" };
const clock = (time: number): string => new Date(time).toTimeString().slice(0, 8);

/**
 * The Console page. It lists every step and problem. Text is set with textContent, so a log
 * message can never inject markup. The badge on the tab counts warnings and errors.
 */
export class ConsolePanel {
  private readonly list: HTMLOListElement;
  private readonly empty: HTMLElement;
  private entries: LogEntry[] = [];
  private attention = 0;

  constructor(
    root: HTMLElement,
    private readonly badge: HTMLElement,
    handlers: ConsoleHandlers,
  ) {
    this.list = root.querySelector<HTMLOListElement>("#log")!;
    this.empty = root.querySelector<HTMLElement>("#log-empty")!;
    root.querySelector<HTMLButtonElement>("#log-clear")!.addEventListener("click", () => handlers.onClear());
    root.querySelector<HTMLButtonElement>("#log-copy")!.addEventListener("click", () => {
      handlers.onCopy(this.entries.map((e) => `${clock(e.time)} ${TAG[e.level]} ${e.message}`).join("\n"));
    });
  }

  private row(entry: LogEntry): HTMLLIElement {
    const item = document.createElement("li");
    item.className = `log-row level-${entry.level}`;
    item.dataset.id = entry.id;
    const time = document.createElement("time");
    time.textContent = clock(entry.time);
    const tag = document.createElement("span");
    tag.className = "log-tag";
    tag.textContent = TAG[entry.level];
    const text = document.createElement("span");
    text.className = "log-text";
    text.textContent = entry.message;
    item.append(time, tag, text);
    return item;
  }

  /** New entries are appended. The list is rebuilt only when it is not a simple extension. */
  render(entries: LogEntry[]): void {
    this.entries = entries;
    const rendered = Array.from(this.list.children, (li) => (li as HTMLElement).dataset.id);
    const isAppend = rendered.every((id, i) => entries[i]?.id === id);
    if (!isAppend) this.list.replaceChildren();
    for (const entry of entries.slice(isAppend ? rendered.length : 0)) this.list.append(this.row(entry));

    this.empty.hidden = entries.length > 0;
    const attention = entries.filter((e) => e.level === "warn" || e.level === "error").length;
    this.badge.hidden = attention === 0;
    this.badge.textContent = String(attention);
    this.badge.classList.toggle("has-error", entries.some((e) => e.level === "error"));
    if (attention > this.attention) pulse(this.badge, "bump");
    this.attention = attention;
    this.list.scrollTop = this.list.scrollHeight;
  }
}
