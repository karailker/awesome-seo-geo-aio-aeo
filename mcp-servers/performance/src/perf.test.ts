import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mapCrux } from "./crux.js";
import { mapPsi } from "./psi.js";
import { cruxQuery, lighthouseLocalRun, psiRun } from "./tools.js";
import { PerfError } from "./errors.js";

const psiRaw = JSON.parse(readFileSync(new URL("../tests/fixtures/psi-mobile-www-bulmacalig.json", import.meta.url), "utf8"));
const cruxRaw = JSON.parse(readFileSync(new URL("../tests/fixtures/crux-origin-phone.json", import.meta.url), "utf8"));

const KEY = "test-key-value-123456";
const env = { PAGESPEED_API_KEY: KEY, CRUX_API_KEY: KEY } as NodeJS.ProcessEnv;

function fetchReturning(status: number, body: unknown) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("PageSpeed Insights mapping", () => {
  it("maps Lighthouse values to lab_* names and a percentage performance score", () => {
    const mapped = mapPsi(psiRaw);

    expect(mapped.lab.lab_performance_score).toBe(83);
    expect(mapped.lab.lab_lcp_ms).toBeTypeOf("number");
    expect(mapped.lab.lab_cls).toBeTypeOf("number");
  });

  it("reports field values as null when the URL has no CrUX data, instead of inferring them", () => {
    const mapped = mapPsi(psiRaw);

    expect(mapped.fieldAvailable).toBe(false);
    expect(mapped.field.field_lcp_p75_ms).toBeNull();
    expect(mapped.field.field_category).toBeNull();
  });

  it("never gives a lab name and a field name to the same measurement", () => {
    const { lab, field } = mapPsi(psiRaw);

    for (const name of Object.keys(lab)) expect(name.startsWith("lab_")).toBe(true);
    for (const name of Object.keys(field)) expect(name.startsWith("field_")).toBe(true);
    expect(Object.keys(lab).filter((n) => n in field)).toEqual([]);
  });

  it("scales CrUX CLS from hundredths to a score", () => {
    const withField = {
      ...psiRaw,
      loadingExperience: {
        overall_category: "FAST",
        metrics: {
          CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: "FAST" },
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: "FAST" },
        },
      },
    };

    const mapped = mapPsi(withField);

    expect(mapped.fieldAvailable).toBe(true);
    expect(mapped.field.field_cls_p75).toBeCloseTo(0.05);
    expect(mapped.field.field_lcp_p75_ms).toBe(2100);
    expect(mapped.field.field_category).toBe("FAST");
  });
});

describe("psi_run tool", () => {
  it("returns the mapped envelope and never includes the key", async () => {
    const { impl, calls } = fetchReturning(200, psiRaw);

    const result = await psiRun({ url: "https://www.bulmacalig.com/", strategy: "mobile" }, env, impl);

    expect(result.ok).toBe(true);
    expect(result.source).toBe("psi");
    expect(calls[0]).toContain("strategy=mobile");
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(result.warnings.some((w) => w.includes("No field data"))).toBe(true);
  });

  it("fails before any request when the key is not set", async () => {
    const { impl, calls } = fetchReturning(200, psiRaw);

    const result = await psiRun({ url: "https://www.bulmacalig.com/", strategy: "mobile", fallback_local: false }, {}, impl);

    expect(result.errors[0]?.code).toBe("AUTH_MISSING");
    expect(calls).toHaveLength(0);
  });

  it("reports quota exhaustion as QUOTA_EXCEEDED without the upstream body", async () => {
    const { impl } = fetchReturning(429, { error: { message: `quota for key ${KEY}` } });

    const result = await psiRun({ url: "https://www.bulmacalig.com/", strategy: "mobile", fallback_local: false }, env, impl);

    expect(result.errors[0]?.code).toBe("QUOTA_EXCEEDED");
    expect(JSON.stringify(result)).not.toContain(KEY);
  });

  it("rejects a non-http URL without a request", async () => {
    const { impl, calls } = fetchReturning(200, psiRaw);

    const result = await psiRun({ url: "file:///etc/passwd", strategy: "mobile" }, env, impl);

    expect(result.errors[0]?.code).toBe("INVALID_INPUT");
    expect(calls).toHaveLength(0);
  });
});

describe("CrUX mapping and tool", () => {
  it("maps p75 values to field_* names with the collection period", () => {
    const mapped = mapCrux(cruxRaw);

    expect(mapped.field).toEqual({
      field_lcp_p75_ms: 3123,
      field_fcp_p75_ms: 3011,
      field_inp_p75_ms: 206,
      field_cls_p75: 0.05,
    });
    expect(mapped.period).toEqual({ start: "2026-10-07", end: "2026-11-03" });
  });

  it("treats a 404 as not in the dataset, with null field values", async () => {
    const { impl } = fetchReturning(404, { error: { message: "not found" } });

    const result = await cruxQuery({ origin: "https://small.example" }, env, impl);

    expect(result.ok).toBe(true);
    expect(result.warnings[0]).toContain("Not in the CrUX dataset");
    expect((result.data as { field: Record<string, unknown> }).field.field_lcp_p75_ms).toBeNull();
  });

  it("reports a blocked key as PERMISSION_DENIED", async () => {
    const { impl } = fetchReturning(403, { error: { message: "blocked" } });

    const result = await cruxQuery({ origin: "https://www.bulmacalig.com" }, env, impl);

    expect(result.errors[0]?.code).toBe("PERMISSION_DENIED");
  });

  it("requires exactly one of origin or url", async () => {
    const { impl, calls } = fetchReturning(200, cruxRaw);

    const result = await cruxQuery({}, env, impl);

    expect(result.errors[0]?.code).toBe("INVALID_INPUT");
    expect(calls).toHaveLength(0);
  });
});

describe("local Lighthouse fallback", () => {
  // The recorded PSI fixture's lighthouseResult has the same shape as a local lhr.
  const localLhr = psiRaw.lighthouseResult;

  it("uses the local run when PSI quota is exhausted and tags the result lighthouse-local", async () => {
    const { impl } = fetchReturning(429, { error: { message: "quota" } });
    const calls: string[] = [];
    const runner = async (url: string) => {
      calls.push(url);
      return localLhr;
    };

    const result = await psiRun({ url: "https://www.bulmacalig.com/", strategy: "mobile" }, env, impl, runner);

    expect(calls).toEqual(["https://www.bulmacalig.com/"]);
    expect(result.ok).toBe(true);
    expect(result.source).toBe("lighthouse-local");
    expect(result.warnings[0]).toContain("QUOTA_EXCEEDED");
    expect((result.data as { lab: { lab_performance_score: number } }).lab.lab_performance_score).toBe(83);
    expect((result.data as { field: unknown }).field).toBeNull();
  });

  it("uses the local run when no PSI key is configured", async () => {
    const { impl, calls } = fetchReturning(200, psiRaw);
    const runner = async () => localLhr;

    const result = await psiRun({ url: "https://www.bulmacalig.com/", strategy: "mobile" }, {}, impl, runner);

    expect(calls).toHaveLength(0);
    expect(result.source).toBe("lighthouse-local");
    expect(result.warnings[0]).toContain("AUTH_MISSING");
  });

  it("does not fall back when fallback_local is false", async () => {
    const { impl } = fetchReturning(429, {});
    let called = false;

    const result = await psiRun(
      { url: "https://www.bulmacalig.com/", strategy: "mobile", fallback_local: false },
      env,
      impl,
      async () => {
        called = true;
        return localLhr;
      },
    );

    expect(called).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.code).toBe("QUOTA_EXCEEDED");
  });

  it("does not fall back for an invalid URL", async () => {
    const { impl } = fetchReturning(200, psiRaw);
    let called = false;

    const result = await psiRun({ url: "ftp://x", strategy: "mobile" }, env, impl, async () => {
      called = true;
      return localLhr;
    });

    expect(called).toBe(false);
    expect(result.errors[0]?.code).toBe("INVALID_INPUT");
  });

  it("reports both failures when the local run also fails", async () => {
    const { impl } = fetchReturning(429, {});
    const runner = async () => {
      throw new PerfError("UPSTREAM_ERROR", "Chrome could not be started", false);
    };

    const result = await psiRun({ url: "https://www.bulmacalig.com/", strategy: "mobile" }, env, impl, runner);

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["UPSTREAM_ERROR", "QUOTA_EXCEEDED"]);
  });

  it("local lab output never contains field values", async () => {
    const result = await lighthouseLocalRun({ url: "https://www.bulmacalig.com/", strategy: "desktop" }, async () => localLhr);

    expect(result.source).toBe("lighthouse-local");
    const data = result.data as { lab: Record<string, unknown>; field: unknown };
    expect(Object.keys(data.lab).every((k) => k.startsWith("lab_"))).toBe(true);
    expect(data.field).toBeNull();
  });
});

describe("fallback on PSI rejecting the key", () => {
  it("falls back to the local run when PSI returns 400 for a bad key", async () => {
    const { impl } = fetchReturning(400, { error: { message: "API key not valid" } });
    const runner = async () => psiRaw.lighthouseResult;

    const result = await psiRun({ url: "https://www.bulmacalig.com/", strategy: "mobile" }, env, impl, runner);

    expect(result.source).toBe("lighthouse-local");
    expect(result.warnings[0]).toContain("INVALID_INPUT");
  });
});
