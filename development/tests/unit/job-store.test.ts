import { describe, expect, test } from "bun:test";
import { LOGS_KEY, appendLogEntries, createSessionLogSink, readJob } from "../../../src/shared/job-store";
import { cleanMessage, makeEntry } from "../../../src/shared/log";
import type { LogEntry } from "../../../src/shared/types";
import { MemoryArea } from "./helpers";

const entry = (n: number): LogEntry => ({ id: `e${n}`, time: n, level: "info", source: "sw", message: `m${n}` });

describe("log buffer", () => {
  test("keeps only the newest entries", () => {
    let list: LogEntry[] = [];
    for (let i = 0; i < 5; i++) list = appendLogEntries(list, entry(i), 3);
    expect(list.map((e) => e.id)).toEqual(["e2", "e3", "e4"]);
  });

  test("the session sink keeps order under 50 rapid log calls", async () => {
    const area = new MemoryArea();
    const sink = createSessionLogSink(area);
    for (let i = 0; i < 50; i++) sink("info", `line ${i}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const stored = area.data[LOGS_KEY] as LogEntry[];
    expect(stored.map((e) => e.message)).toEqual(Array.from({ length: 50 }, (_, i) => `line ${i}`));
  });

  test("messages lose control characters and are capped", () => {
    expect(cleanMessage("line one\nline two\u0007")).toBe("line one line two");
    expect(cleanMessage("x".repeat(500)).length).toBe(301);
  });

  test("entries carry only an id, time, level, source and message", () => {
    const e = makeEntry("warn", "Width must be at least 200.", "popup");
    expect(Object.keys(e).sort()).toEqual(["id", "level", "message", "source", "time"]);
  });
});

describe("job record", () => {
  test("returns null when nothing is stored", async () => {
    expect(await readJob(new MemoryArea())).toBeNull();
  });

  test("rejects a malformed stored value", async () => {
    const area = new MemoryArea();
    area.data.job = { nonsense: true };
    expect(await readJob(area)).toBeNull();
  });
});
