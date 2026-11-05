// Evidence gate (docs/SECURITY-AND-APPROVAL.md): a finding is kept only if every evidence id
// is an observation of the same site. No evidence, no finding.
import type { Store } from "../db/store.js";

export type Finding = {
  id: string;
  title: string;
  severity: "info" | "low" | "medium" | "high";
  confidence: "high" | "medium" | "low";
  description: string;
  affectedCount: number;
  evidenceIds: string[];
  // measured: a direct presence or count. inferred: uses a project threshold.
  basis?: "measured" | "inferred";
};

export function validateFindings(
  store: Store,
  siteId: string,
  findings: Finding[],
): { valid: Finding[]; problems: string[] } {
  const exists = store.sqlite.prepare("SELECT 1 FROM observations WHERE id = ? AND site_id = ?");
  const valid: Finding[] = [];
  const problems: string[] = [];
  for (const finding of findings) {
    if (finding.evidenceIds.length === 0) {
      problems.push(`${finding.id}: no evidence`);
      continue;
    }
    const missing = finding.evidenceIds.filter((id) => exists.get(id, siteId) === undefined);
    if (missing.length > 0) {
      problems.push(`${finding.id}: ${missing.length} evidence id(s) not found for this site`);
      continue;
    }
    valid.push(finding);
  }
  return { valid, problems };
}
