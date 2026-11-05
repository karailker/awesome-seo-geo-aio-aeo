// Creates or updates the single site from CLI flags. Idempotent: the site is matched by origin.
// Usage: pnpm db:seed --origin https://example.com [--sitemap URL] [--name NAME] [--url-cap 500]
// (pnpm 12 passes a literal "--" through, so do not add one before the flags.)
// Requires a built core (pnpm -r build). Path override: AWESOME_SEO_DB.
import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { normalizeUrl, openStore, upsertSite } from "../packages/core/dist/index.js";

const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    sitemap: { type: "string" },
    name: { type: "string" },
    "url-cap": { type: "string", default: "500" },
  },
});

if (!values.origin) {
  console.error("Missing --origin, e.g. --origin https://example.com");
  process.exit(1);
}

const origin = new URL(normalizeUrl(values.origin)).origin;
const sitemapUrl = normalizeUrl(values.sitemap ?? `${origin}/sitemap.xml`);
const urlCap = Number(values["url-cap"]);
if (!Number.isInteger(urlCap) || urlCap <= 0) {
  console.error("--url-cap must be a positive integer");
  process.exit(1);
}

const dbPath = process.env.AWESOME_SEO_DB ?? "data/awesome-seo.sqlite";
const store = openStore(dbPath);
try {
  const existing = store.sqlite
    .prepare("SELECT id FROM sites WHERE canonical_origin = ?")
    .get(origin) as { id: string } | undefined;
  upsertSite(store, {
    id: existing?.id ?? randomUUID(),
    name: values.name ?? new URL(origin).hostname,
    canonicalOrigin: origin,
    sitemapUrl,
    urlCap,
    createdAt: new Date().toISOString(),
  });
  console.log(JSON.stringify({ ok: true, db: dbPath, origin, sitemapUrl, urlCap, created: !existing }));
} finally {
  store.close();
}
