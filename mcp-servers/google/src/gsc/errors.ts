// Stable error codes from docs/MCP.md. Messages never include keys, tokens, or response bodies.
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

export class GscError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export function fromHttpStatus(status: number): GscError {
  const message = `Search Console API returned HTTP ${status}`;
  if (status === 400) return new GscError("INVALID_INPUT", message, false);
  if (status === 401) return new GscError("AUTH_EXPIRED", message, false);
  if (status === 403) return new GscError("PERMISSION_DENIED", message, false);
  if (status === 404) return new GscError("NOT_FOUND", message, false);
  if (status === 429) return new GscError("RATE_LIMITED", message, true);
  return new GscError("UPSTREAM_ERROR", message, status >= 500);
}
