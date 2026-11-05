import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapMetrica, runMetricaQuery, validateQuery, type MetricaQuery } from "./metrica.js";
import { metricaReport } from "./tools.js";

const raw = JSON.parse(readFileSync(new URL("../tests/fixtures/metrica-report.json", import.meta.url), "utf8"));
const TOKEN = "secret-token-value-123";
const q: MetricaQuery = {
  counterId: "113337943",
  metrics: ["ym:s:visits", "ym:s:users"],
  dimensions: ["ym:s:trafficSource"],
  date1: "2026-10-01",
  date2: "2026-10-31",
  limit: 100,
};
const env = { YANDEX_METRICA_TOKEN: TOKEN, YANDEX_METRICA_COUNTER_ID: "113337943" } as NodeJS.ProcessEnv;

function fetchReturning(status: number, body: unknown) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { impl, calls };
}

describe("query validation", () => {
  it("refuses dimensions that pivot on individual visitors", () => {
    expect(() => validateQuery({ ...q, dimensions: ["ym:s:clientID"] })).toThrow(/individual-visitor/);
    expect(() => validateQuery({ ...q, dimensions: ["ym:s:userID"] })).toThrow(/individual-visitor/);
  });

  it("refuses bad dates, counter IDs, and limits", () => {
    expect(() => validateQuery({ ...q, date1: "2026-11-01", date2: "2026-10-01" })).toThrow(/date1/);
    expect(() => validateQuery({ ...q, counterId: "abc" })).toThrow(/numeric/);
    expect(() => validateQuery({ ...q, limit: 0 })).toThrow(/limit/);
  });
});

describe("Metrica request", () => {
  it("sends the token in a header, never in the URL", async () => {
    const { impl, calls } = fetchReturning(200, raw);

    await runMetricaQuery(impl, TOKEN, q);

    expect(calls[0]?.url).toContain("ids=113337943");
    expect(calls[0]?.url).not.toContain(TOKEN);
    expect(calls[0]?.headers.Authorization).toBe(`OAuth ${TOKEN}`);
  });

  it("maps HTTP errors to stable codes", async () => {
    for (const [status, code] of [[401, "AUTH_EXPIRED"], [403, "PERMISSION_DENIED"], [429, "RATE_LIMITED"]] as const) {
      const { impl } = fetchReturning(status, {});
      await expect(runMetricaQuery(impl, TOKEN, q)).rejects.toMatchObject({ code });
    }
  });
});

describe("mapping and tool", () => {
  it("maps rows and totals by name", () => {
    const mapped = mapMetrica(raw, q);

    expect(mapped.rows[0]).toEqual({ dimensions: { "ym:s:trafficSource": "Direct traffic" }, metrics: { "ym:s:visits": 235, "ym:s:users": 224 } });
    expect(mapped.totals).toEqual({ "ym:s:visits": 396, "ym:s:users": 370 });
    expect(mapped.sampleShare).toBe(1);
  });

  it("returns the envelope with source yandex_metrica and the date range", async () => {
    const { impl } = fetchReturning(200, raw);

    const result = await metricaReport({ date1: "2026-10-01", date2: "2026-10-31", metrics: q.metrics, dimensions: q.dimensions, limit: 100 }, env, impl);

    expect(result).toMatchObject({ ok: true, source: "yandex_metrica", period: { start: "2026-10-01", end: "2026-10-31" } });
    expect(result.warnings).toEqual([]);
  });

  it("warns when the data is sampled or rows were cut", async () => {
    const { impl } = fetchReturning(200, { ...raw, sample_share: 0.4, total_rows: 9 });

    const result = await metricaReport({ date1: "2026-10-01", date2: "2026-10-31", metrics: q.metrics, dimensions: q.dimensions, limit: 100 }, env, impl);

    expect(result.warnings.some((w) => w.includes("Sampled data"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Row limit reached"))).toBe(true);
  });

  it("reports a missing token as AUTH_EXPIRED without a request", async () => {
    const { impl, calls } = fetchReturning(200, raw);

    const result = await metricaReport({ date1: "2026-10-01", date2: "2026-10-31", metrics: q.metrics, dimensions: [], limit: 100 }, { YANDEX_METRICA_COUNTER_ID: "113337943" } as NodeJS.ProcessEnv, impl);

    expect(result.errors[0]?.code).toBe("AUTH_EXPIRED");
    expect(calls).toHaveLength(0);
  });

  it("reports a missing counter ID as INVALID_INPUT", async () => {
    const { impl } = fetchReturning(200, raw);

    const result = await metricaReport({ date1: "2026-10-01", date2: "2026-10-31", metrics: q.metrics, dimensions: [], limit: 100 }, { YANDEX_METRICA_TOKEN: TOKEN } as NodeJS.ProcessEnv, impl);

    expect(result.errors[0]?.code).toBe("INVALID_INPUT");
  });
});
