import { en } from "../i18n/en";

/** Stable error categories. Each one has a default English message in en.ts. */
export type ErrorCode =
  | "INVALID_INPUT"
  | "NO_ACTIVE_TAB"
  | "RESTRICTED_URL"
  | "DEBUGGER_BUSY"
  | "POLICY_BLOCKED"
  | "ATTACH_FAILED"
  | "DETACHED"
  | "PROTOCOL"
  | "TIMEOUT"
  | "NAVIGATED"
  | "TOO_LARGE"
  | "CONFIRM_REQUIRED"
  | "IMAGE_INVALID"
  | "DOWNLOAD_FAILED"
  | "BUSY"
  | "INTERRUPTED"
  | "SELECTION_CANCELLED"
  | "SELECTION_FAILED"
  | "UNKNOWN";

export class CaptureError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, number>;

  constructor(code: ErrorCode, message: string = en.errors[code], details: Record<string, number> = {}) {
    super(message);
    this.name = "CaptureError";
    this.code = code;
    this.details = details;
  }
}
