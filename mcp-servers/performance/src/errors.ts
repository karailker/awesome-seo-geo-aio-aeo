// Stable error codes from docs/MCP.md. Messages never include keys or upstream response bodies.
export type ErrorCode =
  | "AUTH_MISSING"
  | "AUTH_EXPIRED"
  | "PERMISSION_DENIED"
  | "QUOTA_EXCEEDED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "INVALID_INPUT"
  | "TIMEOUT";

export class PerfError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

// PSI and CrUX share Google API conventions. 403 usually means the API is not enabled for the
// key's project, or the key's restrictions block it. 429 is the daily quota.
export function fromApiStatus(status: number, api: string): PerfError {
  const message = `${api} returned HTTP ${status}`;
  if (status === 400) return new PerfError("INVALID_INPUT", message, false);
  if (status === 401) return new PerfError("AUTH_EXPIRED", message, false);
  if (status === 403) return new PerfError("PERMISSION_DENIED", message, false);
  if (status === 404) return new PerfError("NOT_FOUND", message, false);
  if (status === 429) return new PerfError("QUOTA_EXCEEDED", message, false);
  return new PerfError("UPSTREAM_ERROR", message, status >= 500);
}
