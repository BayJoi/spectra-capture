import type { ErrorCode } from "./errors";

export type CaptureMode = "viewport" | "fullpage" | "region" | "element";
export type ImageFormat = "png" | "jpeg";
export type Theme = "light" | "dark";

/** A rectangle in document CSS pixels, used by region/element capture. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Optional delay before a capture starts, so hover menus and dropdowns can be opened. */
export const DELAY_OPTIONS = [0, 3, 5, 10] as const;
export type Delay = (typeof DELAY_OPTIONS)[number];
export function isDelay(value: number): value is Delay {
  return (DELAY_OPTIONS as readonly number[]).includes(value);
}

/** Allowed pixel densities. A fixed list keeps the output sizes predictable. */
export const DPR_OPTIONS = [1, 1.5, 2, 3] as const;
export type Dpr = (typeof DPR_OPTIONS)[number];

export function isDpr(value: number): value is Dpr {
  return (DPR_OPTIONS as readonly number[]).includes(value);
}

export interface CaptureOptions {
  /** Extension theme, passed to the picker so its overlay matches light/dark. Never page data. */
  theme: Theme;
  /** Whether the picker may animate its overlay (user toggle AND global motion AND no reduced motion). */
  overlayMotion: boolean;
  /** Whether an area/element pick is cut off after 60 s. Off means it waits for the user. */
  pickTimeout: boolean;
  width: number;
  height: number;
  dpr: Dpr;
  mode: CaptureMode;
  format: ImageFormat;
  quality: number;
  warmUp: boolean;
  confirmLarge: boolean;
  /** Delay in seconds before the capture begins. */
  delay: Delay;
  /** Emulate the site's dark colour scheme during capture. */
  darkMode: boolean;
  /** Hide position:fixed/sticky elements during capture. */
  hideFixed: boolean;
  /** Show the browser's Save As dialog. */
  saveAs: boolean;
  /** Copy the result to the clipboard after saving. */
  copyToClipboard: boolean;
  /** Open the annotation editor instead of saving immediately. */
  annotate: boolean;
  /** The chosen rectangle for region/element mode, filled in by the worker. */
  region?: Region;
}

/** A named size: viewport width and height in CSS pixels, plus a pixel density. */
export interface SizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
  dpr: Dpr;
}

/** The only data saved in chrome.storage.local. No URLs, titles, or images. */
export interface Prefs {
  width: number;
  height: number;
  dpr: Dpr;
  mode: CaptureMode;
  format: ImageFormat;
  quality: number;
  warmUp: boolean;
  ratio: string;
  theme: Theme;
  motion: boolean;
  savedSizes: SizePreset[];
  delay: Delay;
  darkMode: boolean;
  hideFixed: boolean;
  saveAs: boolean;
  copyToClipboard: boolean;
  annotate: boolean;
  /** Show a system notification when a screenshot is saved. */
  notifications: boolean;
  /** End an area/element pick automatically after 60 seconds. Off by default. */
  pickTimeout: boolean;
}

export type LogLevel = "info" | "progress" | "success" | "warn" | "error";

export interface LogEntry {
  id: string;
  time: number;
  level: LogLevel;
  source: "sw" | "popup";
  message: string;
}

export type JobStatus = "running" | "done" | "failed" | "needs-confirm";

/** Saved in chrome.storage.session so the popup can show progress after it was closed. */
export interface JobState {
  jobId: string;
  status: JobStatus;
  step: string;
  /** Index of the current stage, 0 to 5. Drives the progress cells in the popup. */
  progress?: number;
  code?: ErrorCode;
  pixels?: number;
  tabId?: number;
  updatedAt: number;
}
