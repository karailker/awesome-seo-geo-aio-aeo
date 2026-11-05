import { describe, expect, it } from "vitest";
import { GA4_SCOPE, Ga4Client, refusePersonalDimensions } from "./api.js";
import { ga4Metadata, ga4RunReport } from "./tools.js";
import { TokenProvider, type ServiceAccount } from "../gsc/auth.js";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA: ServiceAccount = {
  client_email: "gsc@example.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
};

function clientWith(handler: (url: string, init: RequestInit) => Response) {
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === SA.token_uri) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    return handler(url, init ?? {});
  }) as typeof fetch;
  return new Ga4Client(new TokenProvider(SA, GA4_SCOPE, impl), impl);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const dir = () => mkdtempSync(join(tmpdir(), "ga4-"));

describe("personal dimensions", () => {
  it("refuses user and session identifiers", () => {
    expect(() => refusePersonalDimensions(["userId"])).toThrow(/individual users/);
    expect(() => refusePersonalDimensions(["clientId"])).toThrow(/individual users/);
    expect(() => refusePersonalDimensions(["sessionDefaultChannelGroup", "pagePath"])).not.toThrow();
  });
});

describe("GA4 tools", () => {
  it("lists dimension and metric names", async () => {
    const client = clientWith(() => json({ dimensions: [{ apiName: "pagePath" }], metrics: [{ apiName: "sessions" }] }));

    const result = await ga4Metadata(async () => client, { property_id: "552874034" });

    expect(result.data).toEqual({ propertyId: "552874034", dimensions: ["pagePath"], metrics: ["sessions"] });
  });

  it("writes report rows to JSONL keyed by dimension and metric names", async () => {
    const data = dir();
    const client = clientWith(() =>
      json({
        dimensionHeaders: [{ name: "pagePath" }],
        metricHeaders: [{ name: "sessions" }],
        rows: [{ dimensionValues: [{ value: "/a" }], metricValues: [{ value: "12" }] }],
        rowCount: 1,
      }),
    );

    const result = await ga4RunReport(async () => client, {
      property_id: "552874034", start_date: "2026-10-01", end_date: "2026-10-31",
      dimensions: ["pagePath"], metrics: ["sessions"], limit: 100, output_path: "ga4/x.jsonl",
    }, { AWESOME_SEO_DATA_DIR: data });

    expect(result.ok).toBe(true);
    const line = JSON.parse(readFileSync(join(data, "ga4", "x.jsonl"), "utf8").trim());
    expect(line).toMatchObject({ property_id: "552874034", dimensions: { pagePath: "/a" }, metrics: { sessions: 12 } });
    rmSync(data, { recursive: true, force: true });
  });

  it("refuses personal dimensions before any request", async () => {
    let called = false;
    const client = clientWith(() => { called = true; return json({}); });

    const result = await ga4RunReport(async () => client, {
      property_id: "552874034", start_date: "2026-10-01", end_date: "2026-10-31",
      dimensions: ["userId"], metrics: ["sessions"], limit: 10, output_path: "ga4/y.jsonl",
    }, { AWESOME_SEO_DATA_DIR: dir() });

    expect(result.errors[0]?.code).toBe("INVALID_INPUT");
    expect(called).toBe(false);
  });

  it("maps a 403 from GA4 to PERMISSION_DENIED", async () => {
    const client = clientWith(() => json({ error: { message: "denied" } }, 403));

    const result = await ga4Metadata(async () => client, { property_id: "552874034" });

    expect(result.errors[0]?.code).toBe("PERMISSION_DENIED");
  });
});
