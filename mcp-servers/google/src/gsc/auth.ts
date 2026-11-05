// Service account auth for the Search Console API (docs/SECURITY-AND-APPROVAL.md).
// Key file path comes from GOOGLE_SERVICE_ACCOUNT_KEY_FILE. The key is read, used to sign a JWT,
// and never logged or returned. Uses node:crypto and fetch only: no auth library dependency.
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { GscError } from "./errors.js";

export const SEARCH_CONSOLE_READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export type ServiceAccount = { client_email: string; private_key: string; token_uri: string };

export function loadServiceAccount(path: string): ServiceAccount {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    // Do not include the parser message: it can quote file content.
    throw new GscError("AUTH_MISSING", "Key file could not be read as JSON", false);
  }
  const { type, client_email, private_key, token_uri } = raw;
  if (type !== "service_account" || typeof client_email !== "string" || typeof private_key !== "string" || typeof token_uri !== "string") {
    throw new GscError("AUTH_MISSING", "Key file is not a service account key", false);
  }
  return { client_email, private_key, token_uri };
}

const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");

export function buildAssertion(sa: ServiceAccount, scope: string, nowSeconds: number): string {
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url");
  return `${unsigned}.${signature}`;
}

// Caches the access token until 60 seconds before expiry.
export class TokenProvider {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly sa: ServiceAccount,
    private readonly scope: string,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async getToken(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;

    const assertion = buildAssertion(this.sa, this.scope, Math.floor(this.now() / 1000));
    const res = await this.fetchImpl(this.sa.token_uri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !body.access_token) {
      // invalid_grant: the key was revoked or the service account was deleted.
      if (body.error === "invalid_grant") throw new GscError("AUTH_EXPIRED", "Service account key was rejected", false);
      throw new GscError("UPSTREAM_ERROR", `Token endpoint returned HTTP ${res.status}`, res.status >= 500);
    }
    this.cached = { token: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
