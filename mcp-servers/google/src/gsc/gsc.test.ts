import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAssertion, loadServiceAccount, TokenProvider, type ServiceAccount } from "./auth.js";
import { GscClient } from "./client.js";
import { GscError, fromHttpStatus } from "./errors.js";
import { searchAnalytics, type ClientProvider } from "./tools.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const SA: ServiceAccount = {
  client_email: "awesome-seo-gsc@example-project.iam.gserviceaccount.com",
  private_key: privatePem,
  token_uri: "https://oauth2.googleapis.com/token",
};
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
const SITE = "sc-domain:example.com";

type Call = { url: string; init: RequestInit };

// Fake fetch: token endpoint returns a token; Search Console calls use the given handler.
function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url === SA.token_uri) {
      return new Response(JSON.stringify({ access_token: "tok-123", expires_in: 3600 }), { status: 200 });
    }
    return handler(url, init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "google-gsc-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("service account JWT", () => {
  it("signs an RS256 assertion whose signature verifies with the key's public part", () => {
    const jwt = buildAssertion(SA, SCOPE, 1_700_000_000);
    const [header, claims, signature] = jwt.split(".") as [string, string, string];
    const decode = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));

    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(claims)).toMatchObject({
      iss: SA.client_email,
      scope: SCOPE,
      aud: SA.token_uri,
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const verifier = createVerify("RSA-SHA256").update(`${header}.${claims}`);
    expect(verifier.verify(publicPem, signature, "base64url")).toBe(true);
  });

  it("caches the access token until shortly before expiry", async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    let now = 1_000_000;
    const tokens = new TokenProvider(SA, SCOPE, impl, () => now);

    expect(await tokens.getToken()).toBe("tok-123");
    expect(await tokens.getToken()).toBe("tok-123");
    expect(calls.filter((c) => c.url === SA.token_uri)).toHaveLength(1);

    now += 3600 * 1000; // past expiry
    await tokens.getToken();
    expect(calls.filter((c) => c.url === SA.token_uri)).toHaveLength(2);
  });
});

describe("loadServiceAccount", () => {
  it("rejects a non-service-account file without echoing its content", () => {
    const path = join(dir, "key.json");
    writeFileSync(path, JSON.stringify({ type: "authorized_user", refresh_token: "SECRETVALUE" }));

    let message = "";
    try {
      loadServiceAccount(path);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toBe("Key file is not a service account key");
    expect(message).not.toContain("SECRETVALUE");
  });

  it("does not echo file content when the file is not valid JSON", () => {
    const path = join(dir, "broken.json");
    writeFileSync(path, "SECRETVALUE {not json");

    expect(() => loadServiceAccount(path)).toThrow("Key file could not be read as JSON");
    try {
      loadServiceAccount(path);
    } catch (err) {
      expect((err as Error).message).not.toContain("SECRETVALUE");
    }
  });
});

describe("GscClient", () => {
  it("URL-encodes the property and posts the query body, returning rows", async () => {
    const { impl, calls } = fakeFetch(() =>
      json({ rows: [{ keys: ["/a"], clicks: 3, impressions: 40, ctr: 0.075, position: 2.5 }] }),
    );
    const client = new GscClient(new TokenProvider(SA, SCOPE, impl, () => 0), impl);

    const rows = await client.searchAnalytics(SITE, {
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      dimensions: ["page"],
      rowLimit: 100,
    });

    const call = calls.find((c) => c.url.includes("searchAnalytics"));
    expect(call?.url).toBe(
      "https://www.googleapis.com/webmasters/v3/sites/sc-domain%3Aexample.com/searchAnalytics/query",
    );
    expect(call?.init.headers).toMatchObject({ authorization: "Bearer tok-123" });
    expect(JSON.parse(String(call?.init.body))).toEqual({
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      dimensions: ["page"],
      rowLimit: 100,
    });
    expect(rows).toEqual([{ keys: ["/a"], clicks: 3, impressions: 40, ctr: 0.075, position: 2.5 }]);
  });

  it("maps HTTP status to stable error codes", () => {
    expect(fromHttpStatus(403).code).toBe("PERMISSION_DENIED");
    expect(fromHttpStatus(401).code).toBe("AUTH_EXPIRED");
    expect(fromHttpStatus(429)).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(fromHttpStatus(503)).toMatchObject({ code: "UPSTREAM_ERROR", retryable: true });
  });
});

describe("searchAnalytics tool", () => {
  const dataEnv = () => ({ AWESOME_SEO_DATA_DIR: dir }) as NodeJS.ProcessEnv;
  const input = {
    site: SITE,
    start_date: "2026-10-01",
    end_date: "2026-10-31",
    dimensions: ["page", "query"],
    row_limit: 1000,
    output_path: "snapshots/gsc.jsonl",
  };

  it("writes one JSONL line per row, keyed by dimension names, under the data directory", async () => {
    const { impl } = fakeFetch(() =>
      json({
        rows: [
          { keys: ["https://example.com/a", "bulmaca"], clicks: 2, impressions: 30, ctr: 0.066, position: 4.1 },
        ],
      }),
    );
    const provider: ClientProvider = async () => new GscClient(new TokenProvider(SA, SCOPE, impl, () => 0), impl);

    const result = await searchAnalytics(provider, input, dataEnv());

    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("delayed"))).toBe(true);
    const line = JSON.parse(readFileSync(join(dir, "snapshots", "gsc.jsonl"), "utf8").trim());
    expect(line).toMatchObject({
      site: SITE,
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      dimensions: { page: "https://example.com/a", query: "bulmaca" },
      clicks: 2,
      impressions: 30,
      ctr: 0.066,
      position: 4.1,
    });
  });

  it("warns when the row limit is reached", async () => {
    const { impl } = fakeFetch(() =>
      json({ rows: [{ keys: ["/a"], clicks: 1, impressions: 1, ctr: 1, position: 1 }] }),
    );
    const provider: ClientProvider = async () => new GscClient(new TokenProvider(SA, SCOPE, impl, () => 0), impl);

    const result = await searchAnalytics(provider, { ...input, dimensions: ["page"], row_limit: 1 }, dataEnv());

    expect(result.warnings.some((w) => w.includes("Row limit reached"))).toBe(true);
  });

  it("rejects an output path that leaves the data directory without calling the API", async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    const provider: ClientProvider = async () => new GscClient(new TokenProvider(SA, SCOPE, impl, () => 0), impl);

    const result = await searchAnalytics(provider, { ...input, output_path: "../escape.jsonl" }, dataEnv());

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("INVALID_INPUT");
    expect(calls).toHaveLength(0);
  });

  it("returns PERMISSION_DENIED as an envelope when the service account lacks access", async () => {
    const { impl } = fakeFetch(() => json({ error: { message: "forbidden" } }, 403));
    const provider: ClientProvider = async () => new GscClient(new TokenProvider(SA, SCOPE, impl, () => 0), impl);

    const result = await searchAnalytics(provider, input, dataEnv());

    expect(result).toMatchObject({
      ok: false,
      source: "gsc",
      errors: [{ code: "PERMISSION_DENIED", retryable: false }],
    });
  });

  it("returns AUTH_MISSING when no credentials are configured", async () => {
    const provider: ClientProvider = async () => {
      throw new GscError("AUTH_MISSING", "GOOGLE_SERVICE_ACCOUNT_KEY_FILE is not set", false);
    };

    const result = await searchAnalytics(provider, input, dataEnv());

    expect(result.errors[0]?.code).toBe("AUTH_MISSING");
  });
});
