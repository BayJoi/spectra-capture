import type { JobState, LogEntry, LogLevel } from "./types";
import { makeEntry } from "./log";
import type { KeyValueArea } from "./kv";

export const JOB_KEY = "job";
export const LOGS_KEY = "logs";
export const MAX_LOG_ENTRIES = 200;

export async function readJob(area: KeyValueArea): Promise<JobState | null> {
  const value = (await area.get(JOB_KEY))[JOB_KEY];
  if (typeof value !== "object" || value === null) return null;
  const job = value as Partial<JobState>;
  return typeof job.jobId === "string" && typeof job.status === "string" ? (job as JobState) : null;
}

export async function writeJob(area: KeyValueArea, job: JobState): Promise<void> {
  await area.set({ [JOB_KEY]: job });
}

/** Keeps the newest `max` entries. */
export function appendLogEntries(existing: LogEntry[], entry: LogEntry, max = MAX_LOG_ENTRIES): LogEntry[] {
  const next = [...existing, entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Service-worker log sink. Writes are chained so two log calls can never overwrite each other. */
export function createSessionLogSink(area: KeyValueArea): (level: LogLevel, message: string) => void {
  let queue: Promise<void> = Promise.resolve();
  return (level, message) => {
    const entry = makeEntry(level, message, "sw");
    queue = queue
      .then(async () => {
        const existing = (await area.get(LOGS_KEY))[LOGS_KEY];
        await area.set({ [LOGS_KEY]: appendLogEntries(Array.isArray(existing) ? (existing as LogEntry[]) : [], entry) });
      })
      .catch(() => undefined);
  };
}
