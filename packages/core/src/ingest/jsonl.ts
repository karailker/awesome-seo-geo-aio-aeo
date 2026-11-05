// Shared JSONL line parser for snapshot ingest. Invalid lines are skipped and reported.
import type { z } from "zod";

export type JsonlParse<T> = {
  lines: number; // non-empty lines seen
  rows: T[];
  skipped: number;
  errors: string[]; // first few line errors, for the report
};

const MAX_REPORTED_ERRORS = 5;

export function parseJsonl<T>(text: string, schema: z.ZodType<T>): JsonlParse<T> {
  const out: JsonlParse<T> = { lines: 0, rows: [], skipped: 0, errors: [] };
  text.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") return;
    out.lines += 1;
    let problem: string | null = null;
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) out.rows.push(parsed.data);
      else problem = parsed.error.issues[0]?.message ?? "invalid record";
    } catch {
      problem = "not valid JSON";
    }
    if (problem !== null) {
      out.skipped += 1;
      if (out.errors.length < MAX_REPORTED_ERRORS) out.errors.push(`line ${index + 1}: ${problem}`);
    }
  });
  return out;
}
