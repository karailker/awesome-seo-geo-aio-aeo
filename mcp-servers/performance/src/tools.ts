// Tool handlers for the performance MCP. Each returns the ToolResult envelope (docs/MCP.md).
// Keys come from the environment only. They are never returned, logged, or written.
import type { ToolResult } from "@awesome-seo/core";
import { mapCrux, queryCrux, type FormFactor } from "./crux.js";
import { PerfError } from "./errors.js";
import { runLighthouseLocal } from "./lighthouse.js";
import { mapLab, mapPsi, runPsi, type Strategy } from "./psi.js";

export const PSI_KEY_VAR = "PAGESPEED_API_KEY";
export const CRUX_KEY_VAR = "CRUX_API_KEY";

type Env = NodeJS.ProcessEnv;
export type Fetch = typeof fetch;

function ok<T>(source: string, data: T, warnings: string[] = [], period?: { start: string; end: string }): ToolResult<T> {
  return {
    ok: true,
    data,
    source,
    collectedAt: new Date().toISOString(),
    ...(period ? { period } : {}),
    warnings,
    errors: [],
  };
}

function fail(source: string, err: unknown): ToolResult<never> {
  const e = err instanceof PerfError ? err : new PerfError("UPSTREAM_ERROR", "Unexpected error", false);
  return {
    ok: false,
    source,
    collectedAt: new Date().toISOString(),
    warnings: [],
    errors: [{ code: e.code, message: e.message, retryable: e.retryable }],
  };
}

function requireKey(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new PerfError("AUTH_MISSING", `${name} is not set`, false);
  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export type LocalRunner = (url: string, strategy: Strategy) => Promise<unknown>;

// Local Lighthouse: lab only. Tagged source "lighthouse-local"; field values are not produced at all.
export async function lighthouseLocalRun(
  input: { url: string; strategy: Strategy },
  runner: LocalRunner = runLighthouseLocal,
): Promise<ToolResult<unknown>> {
  try {
    if (!isHttpUrl(input.url)) throw new PerfError("INVALID_INPUT", "url must be an http(s) URL", false);
    const lhr = await runner(input.url, input.strategy);
    const { lab, opportunities } = mapLab(lhr as Record<string, any>);
    return ok(
      "lighthouse-local",
      { url: input.url, strategy: input.strategy, lab, field: null, fieldAvailable: false, opportunities },
      ["Local Lighthouse run: lab values only, from this machine and network. No field data."],
    );
  } catch (err) {
    return fail("lighthouse-local", err);
  }
}

// PSI first. When PSI fails for any reason except bad input, the local run is used and the PSI
// error code is reported in the warnings. fallback_local: false turns this off.
export async function psiRun(
  input: { url: string; strategy: Strategy; fallback_local?: boolean },
  env: Env = process.env,
  fetchImpl: Fetch = fetch,
  runner: LocalRunner = runLighthouseLocal,
): Promise<ToolResult<unknown>> {
  try {
    if (!isHttpUrl(input.url)) throw new PerfError("INVALID_INPUT", "url must be an http(s) URL", false);
    const key = requireKey(env, PSI_KEY_VAR);
    const raw = await runPsi(fetchImpl, key, input.url, input.strategy);
    const mapped = mapPsi(raw as Record<string, any>);
    const warnings = [
      // VERIFY: PSI daily quota, see psi.ts.
      "Lab values come from one Lighthouse run and vary between runs.",
    ];
    if (!mapped.fieldAvailable) {
      warnings.push("No field data for this URL in CrUX. field_* values are null, not inferred.");
    }
    return ok(
      "psi",
      {
        url: input.url,
        strategy: input.strategy,
        lab: mapped.lab,
        field: mapped.field,
        fieldAvailable: mapped.fieldAvailable,
        opportunities: mapped.opportunities,
      },
      warnings,
    );
  } catch (err) {
    const psiError = err instanceof PerfError ? err : new PerfError("UPSTREAM_ERROR", "Unexpected error", false);
    // Only a bad URL skips the fallback. A bad key also returns 400 from PSI, and that must fall back.
    if (!isHttpUrl(input.url) || input.fallback_local === false) return fail("psi", psiError);

    const local = await lighthouseLocalRun({ url: input.url, strategy: input.strategy }, runner);
    if (!local.ok) {
      return {
        ...local,
        errors: [
          ...local.errors,
          { code: psiError.code, message: `PageSpeed Insights failed first: ${psiError.message}`, retryable: psiError.retryable },
        ],
      };
    }
    return {
      ...local,
      warnings: [`PageSpeed Insights failed (${psiError.code}); this result is from the local Lighthouse fallback.`, ...local.warnings],
    };
  }
}

export async function cruxQuery(
  input: { origin?: string; url?: string; form_factor?: FormFactor },
  env: Env = process.env,
  fetchImpl: Fetch = fetch,
): Promise<ToolResult<unknown>> {
  try {
    const value = input.url ?? input.origin;
    if (value === undefined) throw new PerfError("INVALID_INPUT", "Provide origin or url", false);
    if (!isHttpUrl(value)) throw new PerfError("INVALID_INPUT", "origin or url must be an http(s) URL", false);
    const target = input.url !== undefined ? { url: input.url } : { origin: value };
    const key = requireKey(env, CRUX_KEY_VAR);
    const raw = await queryCrux(fetchImpl, key, target, input.form_factor);
    const mapped = mapCrux(raw as Record<string, any>);
    const warnings = mapped.available
      ? []
      : ["Not in the CrUX dataset (too little traffic). field_* values are null, not inferred."];
    return ok("crux", { target, formFactor: input.form_factor ?? "all", field: mapped.field, available: mapped.available }, warnings, mapped.period ?? undefined);
  } catch (err) {
    return fail("crux", err);
  }
}
