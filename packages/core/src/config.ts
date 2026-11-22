// Project configuration: awesome-seo.json in the project folder. It holds identifiers only (GSC property, GA4
// property ID, Bing site, Yandex host, Merchant account, URL cap). Secrets stay in the project's .env. The general
// commands (/site-check, /site-audit) read the resolved form to decide which sources to use, so nobody has to pick
// tools by hand.
import { existsSync, writeFileSync } from "node:fs";
import { z } from "zod";

const digits = z.string().regex(/^\d+$/, "must be digits only");

export const ProjectConfigSchema = z
  .object({
    _note: z.string().optional(), // free text for people; ignored
    origin: z.string().url(),
    sitemap: z.string().url().optional(),
    urlCap: z.number().int().positive().max(10000).optional(),
    gsc: z.object({ property: z.string().min(1) }).strict().optional(),
    ga4: z.object({ propertyId: digits }).strict().optional(),
    bing: z.object({ site: z.string().url() }).strict().optional(),
    yandex: z.object({ hostId: z.string().min(1).optional(), counterId: digits.optional() }).strict().optional(),
    merchant: z.object({ accountId: digits }).strict().optional(),
    performance: z.object({ urls: z.array(z.string().url()).max(10).optional() }).strict().optional(),
  })
  .strict();

type Source<T> = ({ enabled: true } & T) | { enabled: false; reason: string };

export type ResolvedConfig = {
  origin: string;
  host: string;
  sitemap: string;
  urlCap: number;
  performanceUrls: string[];
  sources: {
    gsc: Source<{ property: string; defaulted: boolean }>;
    ga4: Source<{ propertyId: string }>;
    bing: Source<{ site: string; defaulted: boolean }>;
    yandex: Source<{ hostId?: string; counterId?: string }>;
    merchant: Source<{ accountId: string }>;
  };
};

export function resolveConfig(raw: unknown): ResolvedConfig {
  const parsed = ProjectConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const where = (i: z.ZodIssue) => `${i.path.join(".") || "(root)"}: ${i.message}`;
    throw new Error(`Invalid awesome-seo.json: ${parsed.error.issues.map(where).join("; ")}`);
  }
  const c = parsed.data;
  const origin = new URL(c.origin).origin;
  const host = new URL(origin).hostname;
  const apex = host.replace(/^www\./, "");
  return {
    origin,
    host,
    sitemap: c.sitemap ?? `${origin}/sitemap.xml`,
    urlCap: c.urlCap ?? 500,
    performanceUrls: c.performance?.urls ?? [],
    sources: {
      // Search Console and Bing default from the origin. The defaults are guesses and are labelled as such.
      gsc: c.gsc ? { enabled: true, property: c.gsc.property, defaulted: false } : { enabled: true, property: `sc-domain:${apex}`, defaulted: true },
      ga4: c.ga4 ? { enabled: true, propertyId: c.ga4.propertyId } : { enabled: false, reason: "ga4.propertyId is not set" },
      bing: c.bing ? { enabled: true, site: c.bing.site, defaulted: false } : { enabled: true, site: `${origin}/`, defaulted: true },
      yandex:
        c.yandex?.hostId || c.yandex?.counterId
          ? { enabled: true, ...(c.yandex.hostId ? { hostId: c.yandex.hostId } : {}), ...(c.yandex.counterId ? { counterId: c.yandex.counterId } : {}) }
          : { enabled: false, reason: "yandex.hostId and yandex.counterId are not set" },
      merchant: c.merchant ? { enabled: true, accountId: c.merchant.accountId } : { enabled: false, reason: "merchant.accountId is not set" },
    },
  };
}

// A template with the origin and the Search Console property. Other identifiers are added by hand: an empty
// GA4 property ID would make the file invalid. Refuses to overwrite an existing file.
export function initConfig(file: string, origin: string): void {
  if (existsSync(file)) throw new Error(`${file} already exists; edit it instead.`);
  const url = new URL(origin);
  const template = {
    _note: "Identifiers only, no secrets (keys go in .env). Add ga4, yandex, merchant and performance blocks as needed. Defaults: sitemap is <origin>/sitemap.xml, bing.site is <origin>/.",
    origin: url.origin,
    urlCap: 500,
    gsc: { property: `sc-domain:${url.hostname.replace(/^www\./, "")}` },
  };
  writeFileSync(file, `${JSON.stringify(template, null, 2)}\n`, "utf8");
}
