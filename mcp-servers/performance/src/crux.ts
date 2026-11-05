// Chrome UX Report (CrUX) API: origin-level or URL-level field data, p75 values (field_* names only).
// VERIFY: endpoint records:queryRecord (v1) and its rate limits come from the public CrUX documentation.
import { fromApiStatus, PerfError } from "./errors.js";

export const CRUX_ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";
const TIMEOUT_MS = 30_000;

export type FormFactor = "PHONE" | "DESKTOP" | "TABLET";

export type CruxMapped = {
  field: Record<string, number | null>;
  period: { start: string; end: string } | null;
  available: boolean;
};

export async function queryCrux(
  fetchImpl: typeof fetch,
  key: string,
  target: { origin: string } | { url: string },
  formFactor: FormFactor | undefined,
): Promise<unknown> {
  const body = formFactor ? { ...target, formFactor } : target;
  let res: Response;
  try {
    res = await fetchImpl(`${CRUX_ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new PerfError("TIMEOUT", "CrUX request timed out", true);
    }
    throw new PerfError("UPSTREAM_ERROR", "CrUX request failed", true);
  }
  if (res.status === 404) {
    // CrUX returns 404 when the origin or URL has too little traffic to be in the dataset.
    return { notInDataset: true };
  }
  if (!res.ok) throw fromApiStatus(res.status, "CrUX");
  return res.json();
}

type Json = Record<string, any>;

const FIELDS: { key: string; name: string; parse: (v: unknown) => number | null }[] = [
  { key: "largest_contentful_paint", name: "field_lcp_p75_ms", parse: num },
  { key: "first_contentful_paint", name: "field_fcp_p75_ms", parse: num },
  { key: "interaction_to_next_paint", name: "field_inp_p75_ms", parse: num },
  { key: "cumulative_layout_shift", name: "field_cls_p75", parse: num }, // CrUX sends CLS as a decimal string
];

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

const iso = (d: Json | undefined): string | null =>
  d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;

export function mapCrux(raw: Json): CruxMapped {
  if (raw?.notInDataset) return { field: Object.fromEntries(FIELDS.map((f) => [f.name, null])), period: null, available: false };
  const metrics: Json = raw?.record?.metrics ?? {};
  const field: Record<string, number | null> = {};
  for (const f of FIELDS) field[f.name] = f.parse(metrics[f.key]?.percentiles?.p75);
  const start = iso(raw?.record?.collectionPeriod?.firstDate);
  const end = iso(raw?.record?.collectionPeriod?.lastDate);
  return {
    field,
    period: start && end ? { start, end } : null,
    available: Object.keys(metrics).length > 0,
  };
}
