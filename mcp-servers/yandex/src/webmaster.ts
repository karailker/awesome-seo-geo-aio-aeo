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

export type InSearchSample = { url: string; lastAccess: string | null; title: string | null };

// Pages Yandex currently shows in search, paged with offset/limit. Capped to keep one call bounded.
export async function inSearchSamples(fetchImpl: typeof fetch, token: string, uid: number, hostId: string): Promise<InSearchSample[]> {
  const base = `${hostPath(uid, hostId)}/search-urls/in-search/samples`;
  const out: InSearchSample[] = [];
  const pageSize = 100;
  const maxRows = 2000;
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const body = (await webmasterGet(fetchImpl, token, `${base}?offset=${offset}&limit=${pageSize}`)) as {
      count?: number;
      samples?: { url: string; last_access?: string; title?: string }[];
    };
    const page = body.samples ?? [];
    for (const s of page) out.push({ url: s.url, lastAccess: s.last_access ?? null, title: s.title ?? null });
    if (page.length < pageSize || (body.count !== undefined && out.length >= body.count)) break;
  }
  return out;
}

// Write (P10). Only reachable through the approval gate.
export async function webmasterPost(fetchImpl: typeof fetch, token: string, path: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new WebmasterError("UPSTREAM_ERROR", "Yandex Webmaster request failed", true);
  }
  const message = `Yandex Webmaster returned HTTP ${res.status}`;
  if (res.status === 401) throw new WebmasterError("AUTH_EXPIRED", message, false);
  if (res.status === 403) throw new WebmasterError("PERMISSION_DENIED", message, false);
  if (res.status === 404) throw new WebmasterError("NOT_FOUND", message, false);
  if (res.status === 429) throw new WebmasterError("RATE_LIMITED", message, true);
  if (!res.ok) throw new WebmasterError("UPSTREAM_ERROR", message, res.status >= 500);
  return res.status === 204 ? {} : res.json();
}
