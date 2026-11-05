// Yandex Webmaster API v4: host summary, popular search queries, indexing (in-search history, sitemaps, recrawl quota).
// VERIFY: all endpoints under https://api.webmaster.yandex.net/v4 and their limits come from the public Webmaster
// documentation. The indexing history path was confirmed against a live host; re-check the others before reliance.
const BASE = "https://api.webmaster.yandex.net/v4";
const TIMEOUT_MS = 30_000;

export class WebmasterError extends Error {
  constructor(
    readonly code: "AUTH_EXPIRED" | "PERMISSION_DENIED" | "NOT_FOUND" | "RATE_LIMITED" | "INVALID_INPUT" | "UPSTREAM_ERROR" | "TIMEOUT",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export async function webmasterGet(fetchImpl: typeof fetch, token: string, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, { headers: { Authorization: `OAuth ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new WebmasterError("TIMEOUT", "Yandex Webmaster request timed out", true);
    }
    throw new WebmasterError("UPSTREAM_ERROR", "Yandex Webmaster request failed", true);
  }
  const message = `Yandex Webmaster returned HTTP ${res.status}`;
  if (res.status === 401) throw new WebmasterError("AUTH_EXPIRED", message, false);
  if (res.status === 403) throw new WebmasterError("PERMISSION_DENIED", message, false);
  if (res.status === 404) throw new WebmasterError("NOT_FOUND", message, false);
  if (res.status === 429) throw new WebmasterError("RATE_LIMITED", message, true);
  if (!res.ok) throw new WebmasterError("UPSTREAM_ERROR", message, res.status >= 500);
  return res.json();
}

// The user ID is needed in every path. It is looked up once per call.
export async function userId(fetchImpl: typeof fetch, token: string): Promise<number> {
  const body = (await webmasterGet(fetchImpl, token, "/user/")) as { user_id?: number };
  if (typeof body.user_id !== "number") throw new WebmasterError("UPSTREAM_ERROR", "No user_id in Webmaster response", false);
  return body.user_id;
}

// Checked before any request, so a bad ID never reaches the API.
export function checkHostId(hostId: string): void {
  if (!/^[A-Za-z0-9:._-]+$/.test(hostId)) throw new WebmasterError("INVALID_INPUT", "host_id has unexpected characters", false);
}

export function hostPath(uid: number, hostId: string): string {
  checkHostId(hostId);
  return `/user/${uid}/hosts/${hostId}`;
}
