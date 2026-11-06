// P6: turns crawl results and an AI access report into observations (source 'crawl').
// Findings cite these observation ids, so the evidence gate applies. Ids are deterministic:
// deriving the same run twice updates values in place.
import { createHash } from "node:crypto";
import { observations } from "../db/schema.js";
import { withTransaction, type Store } from "../db/store.js";
import { z } from "zod";

// Schema.org properties that Google and other engines list as recommended, per type (project-defined list).
// Source: schema.org type pages; VERIFY before a published report.
export const RECOMMENDED: Record<string, string[]> = {
  Article: ["headline", "datePublished", "author", "image"],
  NewsArticle: ["headline", "datePublished", "author", "image"],
  BlogPosting: ["headline", "datePublished", "author", "image"],
  Product: ["name", "image", "offers"],
  FAQPage: ["mainEntity"],
};

type Item = { syntax: string; type: string | null; item: Record<string, unknown> };

const id = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex");

function jsonLdItems(raw: unknown): Item[] {
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw) as Item[];
    return Array.isArray(parsed) ? parsed.filter((i) => i.syntax === "json-ld") : [];
  } catch {
    return [];
  }
}

// A JSON-LD block may wrap its nodes in "@graph". The extractor records the wrapper with type null, so the nodes
// inside it are expanded here to be checked like top-level items. The wrapper itself stays in the list.
export function expandNodes(items: Item[]): Item[] {
  const out: Item[] = [];
  for (const it of items) {
    out.push(it);
    const graph = it.item["@graph"];
    if (!Array.isArray(graph)) continue;
    for (const node of graph) {
      if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
      const obj = node as Record<string, unknown>;
      const t = obj["@type"];
      const type =
        typeof t === "string" ? t : Array.isArray(t) ? t.filter((x): x is string => typeof x === "string").join(",") : null;
      out.push({ syntax: it.syntax, type, item: obj });
    }
  }
  return out;
}

// Author and date signals apply to article-like pages only. A product or a tool page has no byline; counting it
// as missing would report every product page.
const ARTICLE_TYPES = ["Article", "NewsArticle", "BlogPosting"];

export function isArticlePage(items: Item[]): boolean {
  return items.some((i) => i.type?.split(",").some((t) => ARTICLE_TYPES.includes(t)) ?? false);
}

export function missingRecommended(items: Item[]): number {
  let missing = 0;
  for (const it of items) {
    const type = it.type?.split(",")[0];
    const required = type ? RECOMMENDED[type] : undefined;
    if (!required) continue;
    for (const key of required) if (!(key in it.item)) missing += 1;
  }
  return missing;
}

export function hasJsonLdType(items: Item[], type: string): boolean {
  return items.some((i) => i.type?.split(",").includes(type));
}

type Row = {
  id: string;
  url: string;
  status: number | null;
  word_count: number | null;
  headings_json: string | null;
  structured_data_json: string | null;
  robots_allowed: number | null;
  canonical: string | null;
  jsonld_syntax_errors: number | null;
  fetched_at: string;
};

export function deriveCrawlObservations(store: Store, siteId: string, runId: string): number {
  const rows = store.sqlite
    .prepare(
      `SELECT r.id, p.url, r.status, r.word_count, r.headings_json, r.structured_data_json,
              r.robots_allowed, r.canonical, r.jsonld_syntax_errors, r.fetched_at
       FROM crawl_results r JOIN pages p ON p.id = r.page_id WHERE r.run_id = ?`,
    )
    .all(runId) as Row[];

  let written = 0;
  withTransaction(store, () => {
    for (const row of rows) {
      const headings = JSON.parse(row.headings_json ?? "[]") as { level: number }[];
      const items = jsonLdItems(row.structured_data_json);
      const nodes = expandNodes(items);
      const h1 = headings.filter((h) => h.level === 1).length;
      const skip = headings.some((h, i) => i > 0 && h.level - (headings[i - 1]?.level ?? h.level) > 1) ? 1 : 0;
      const values: Record<string, number | null> = {
        robots_blocked: row.robots_allowed === null ? null : row.robots_allowed === 0 ? 1 : 0, // null: unknown
        http_error: row.status !== null && row.status >= 400 ? 1 : 0,
        word_count: row.status === 200 ? row.word_count : null,
        h1_count: row.status === 200 ? h1 : null,
        heading_skip: row.status === 200 ? skip : null,
        structured_items: row.status === 200 ? items.length : null,
        has_author: row.status === 200 && isArticlePage(nodes) ? (nodes.some((i) => "author" in i.item) ? 1 : 0) : null,
        has_date:
          row.status === 200 && isArticlePage(nodes)
            ? nodes.some((i) => "datePublished" in i.item || "dateModified" in i.item)
              ? 1
              : 0
            : null,
        has_faqpage: row.status === 200 ? (hasJsonLdType(nodes, "FAQPage") ? 1 : 0) : null,
        missing_recommended_props: row.status === 200 ? missingRecommended(nodes) : null,
        jsonld_syntax_errors: row.status === 200 ? row.jsonld_syntax_errors : null,
        canonical_missing: row.status === 200 ? (row.canonical ? 0 : 1) : null,
      };
      for (const [metric, value] of Object.entries(values)) {
        const observationId = id(siteId, "crawl", metric, "page", row.url, runId);
        // Not applicable or unknown now: remove a value an earlier derivation stored (a rule may have narrowed).
        if (value === null || value === undefined) {
          store.sqlite.prepare("DELETE FROM observations WHERE id = ?").run(observationId);
          continue;
        }
        store.db
          .insert(observations)
          .values({
            id: observationId,
            siteId,
            source: "crawl",
            entityType: "page",
            entityId: row.url,
            metric,
            value,
            unit: null,
            periodStart: null,
            periodEnd: null,
            collectedAt: row.fetched_at,
            freshness: "snapshot",
            dimensionsJson: JSON.stringify({ run_id: runId }),
            provenanceJson: JSON.stringify({ run_id: runId, tool: "crawl_fetch_pages" }),
          })
          .onConflictDoUpdate({ target: observations.id, set: { value, collectedAt: row.fetched_at } })
          .run();
        written += 1;
      }
    }
  });
  return written;
}

const AccessSchema = z.object({
  data: z.object({
    siteRoot: z.string().url(),
    robots: z.enum(["readable", "unavailable"]),
    sampleSize: z.number().int().nonnegative(),
    agents: z.array(
      z.object({
        user_agent: z.string().min(1),
        allowed: z.number().int().nonnegative().nullable(),
        blocked: z.number().int().nonnegative().nullable(),
        blocked_urls: z.array(z.string()),
      }),
    ),
    llmsTxt: z.object({
      present: z.boolean().nullable(),
      valid: z.boolean().nullable(),
    }),
  }),
});

export type AccessIngestResult = { observations: number; accessId: string };

// Input is the JSON result of crawl_check_access. The access check uses the same sampled URLs as the run.
export function ingestAccessReport(store: Store, siteId: string, json: string): AccessIngestResult {
  const parsed = AccessSchema.parse(JSON.parse(json));
  const d = parsed.data;
  const accessId = id(siteId, "access", json);
  let written = 0;
  const put = (metric: string, entityId: string, value: number, dims: Record<string, unknown>) => {
    store.db
      .insert(observations)
      .values({
        id: id(siteId, "crawl", metric, "site", entityId, accessId, JSON.stringify(dims)),
        siteId,
        source: "crawl",
        entityType: "site",
        entityId,
        metric,
        value,
        unit: null,
        periodStart: null,
        periodEnd: null,
        collectedAt: new Date().toISOString(),
        freshness: "snapshot",
        dimensionsJson: JSON.stringify({ access_id: accessId, ...dims }),
        provenanceJson: JSON.stringify({ access_id: accessId, tool: "crawl_check_access" }),
      })
      .onConflictDoNothing({ target: observations.id })
      .run();
    written += 1;
  };

  withTransaction(store, () => {
    put("robots_readable", d.siteRoot, d.robots === "readable" ? 1 : 0, { sample_size: d.sampleSize });
    if (d.llmsTxt.valid !== null) put("llms_txt_valid", d.siteRoot, d.llmsTxt.valid ? 1 : 0, {});
    for (const agent of d.agents) {
      if (agent.blocked === null) continue; // robots unreadable: unknown, not recorded as a value
      put("ai_blocked_urls", d.siteRoot, agent.blocked, {
        user_agent: agent.user_agent,
        sample_size: d.sampleSize,
        blocked_urls: agent.blocked_urls,
      });
    }
  });
  return { observations: written, accessId };
}
