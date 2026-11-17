import type { LogEntry, LogLevel } from "./types";

export interface Logger {
  info(message: string): void;
  progress(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type LogSink = (level: LogLevel, message: string) => void;

const MAX_MESSAGE_LENGTH = 300;
let sequence = 0;

export function newEntryId(): string {
  sequence += 1;
  return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/** Strips control characters and caps length so a message can never flood the console. */
export function cleanMessage(message: string): string {
  const flat = message.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return flat.length > MAX_MESSAGE_LENGTH ? `${flat.slice(0, MAX_MESSAGE_LENGTH)}…` : flat;
}

export function createLogger(sink: LogSink): Logger {
  return {
    info: (m) => sink("info", cleanMessage(m)),
    progress: (m) => sink("progress", cleanMessage(m)),
    success: (m) => sink("success", cleanMessage(m)),
    warn: (m) => sink("warn", cleanMessage(m)),
    error: (m) => sink("error", cleanMessage(m)),
  };
}

export function makeEntry(level: LogLevel, message: string, source: LogEntry["source"]): LogEntry {
  return { id: newEntryId(), time: Date.now(), level, source, message: cleanMessage(message) };
}
