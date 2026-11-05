// google MCP server: Search Console (P3) and GA4 Data API (P7). Merchant Center comes later.
import { capabilitiesPayload, healthPayload, serveMcp, z, type StubServerConfig } from "@awesome-seo/core";
import { loadServiceAccount, SEARCH_CONSOLE_READONLY_SCOPE, TokenProvider, type ServiceAccount } from "./gsc/auth.js";
import { GscClient } from "./gsc/client.js";
import { GscError } from "./gsc/errors.js";
import { inspectUrl, listProperties, listSitemaps, searchAnalytics, type ClientProvider } from "./gsc/tools.js";
import { GA4_SCOPE, Ga4Client } from "./ga4/api.js";
import { ga4Metadata, ga4RunReport, type Ga4ClientProvider } from "./ga4/tools.js";

const KEY_VAR = "GOOGLE_SERVICE_ACCOUNT_KEY_FILE";

const CONFIG: StubServerConfig = {
  prefix: "google",
  name: "google",
  version: "0.0.1",
  credentialVars: [KEY_VAR, "GOOGLE_MERCHANT_OAUTH_TOKEN_FILE"],
  tools: [
    { name: "google_health", access: "read", credentials: [] },
    { name: "google_capabilities", access: "read", credentials: [] },
    { name: "google_gsc_list_properties", access: "read", credentials: [KEY_VAR] },
    { name: "google_gsc_search_analytics", access: "read", credentials: [KEY_VAR] },
    { name: "google_gsc_inspect_url", access: "read", credentials: [KEY_VAR] },
    { name: "google_gsc_list_sitemaps", access: "read", credentials: [KEY_VAR] },
    { name: "google_ga4_get_metadata", access: "read", credentials: [KEY_VAR] },
    { name: "google_ga4_run_report", access: "read", credentials: [KEY_VAR] },
  ],
};

// Built on first use, so health and capabilities work without a key file.
let serviceAccount: ServiceAccount | null = null;
function account(): ServiceAccount {
  if (serviceAccount) return serviceAccount;
  const keyFile = process.env[KEY_VAR];
  if (!keyFile) throw new GscError("AUTH_MISSING", `${KEY_VAR} is not set`, false);
  serviceAccount = loadServiceAccount(keyFile);
  return serviceAccount;
}

// Each source uses its own read-only scope and token.
let client: GscClient | null = null;
const getClient: ClientProvider = async () => {
  if (client) return client;
  // Read-only scope: P3 needs no write access. Sitemap submit (P10) will need its own scope.
  client = new GscClient(new TokenProvider(account(), SEARCH_CONSOLE_READONLY_SCOPE, fetch), fetch);
  return client;
};

let ga4: Ga4Client | null = null;
const getGa4Client: Ga4ClientProvider = async () => {
  if (ga4) return ga4;
  ga4 = new Ga4Client(new TokenProvider(account(), GA4_SCOPE, fetch), fetch);
  return ga4;
};

const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const siteSchema = z.string().min(1).describe("Property identifier, e.g. sc-domain:example.com or https://example.com/");

serveMcp(CONFIG.name, CONFIG.version, (server) => {
  server.registerTool(
    "google_health",
    { description: "Process status and configuration presence. Never returns secret values.", inputSchema: {} },
    async () => asText(healthPayload(CONFIG)),
  );
  server.registerTool(
    "google_capabilities",
    { description: "List of tools, whether each is read or write, and credentials each requires.", inputSchema: {} },
    async () => asText(capabilitiesPayload(CONFIG)),
  );
  server.registerTool(
    "google_gsc_list_properties",
    { description: "Search Console properties the service account can access, with permission level.", inputSchema: {} },
    async () => asText(await listProperties(getClient)),
  );
  server.registerTool(
    "google_gsc_search_analytics",
    {
      description:
        "Search analytics rows for a property and date range, written as JSONL to output_path under the data directory. Ingest the file with core.",
      inputSchema: {
        site: siteSchema,
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
        dimensions: z.array(z.enum(["page", "query", "country", "device"])).min(1),
        row_limit: z.number().int().min(1).max(25000).default(1000),
        output_path: z.string().min(1).describe("Relative to the data directory, ends in .jsonl"),
      },
    },
    async (args) => asText(await searchAnalytics(getClient, args)),
  );
  server.registerTool(
    "google_gsc_inspect_url",
    {
      description: "URL Inspection: index status and crawl info for one URL in a property.",
      inputSchema: { site: siteSchema, url: z.string().url() },
    },
    async (args) => asText(await inspectUrl(getClient, args)),
  );
  server.registerTool(
    "google_gsc_list_sitemaps",
    { description: "Sitemaps registered for a property, with status.", inputSchema: { site: siteSchema } },
    async (args) => asText(await listSitemaps(getClient, args)),
  );
  server.registerTool(
    "google_ga4_get_metadata",
    {
      description: "GA4 dimension and metric names available for a property.",
      inputSchema: { property_id: z.string().regex(/^\d+$/).describe("GA4 property ID, numeric") },
    },
    async (args) => asText(await ga4Metadata(getGa4Client, args)),
  );
  server.registerTool(
    "google_ga4_run_report",
    {
      description:
        "GA4 aggregated report for a property and date range, written as JSONL to output_path under the data directory. Individual-user dimensions (userId, clientId, sessionId) are refused.",
      inputSchema: {
        property_id: z.string().regex(/^\d+$/),
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
        dimensions: z.array(z.string()).max(9).default([]).describe("e.g. sessionDefaultChannelGroup, pagePath"),
        metrics: z.array(z.string()).min(1).max(10).describe("e.g. sessions, totalUsers, conversions"),
        limit: z.number().int().min(1).max(100000).default(1000),
        output_path: z.string().min(1).describe("Relative to the data directory, ends in .jsonl"),
      },
    },
    async (args) => asText(await ga4RunReport(getGa4Client, args)),
  );
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
