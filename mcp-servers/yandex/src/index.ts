// yandex MCP server (P7): Yandex Metrica aggregated reports. Webmaster tools come in P8.
import { capabilitiesPayload, healthPayload, serveMcp, z, type StubServerConfig } from "@awesome-seo/core";
import { METRICA_COUNTER_VAR, METRICA_TOKEN_VAR, metricaReport } from "./tools.js";
import { hostSummary, indexing, inSearchUrls, listHosts, searchQueries, WEBMASTER_TOKEN_VAR } from "./webmaster-tools.js";

const CONFIG: StubServerConfig = {
  prefix: "yandex",
  name: "yandex",
  version: "0.0.1",
  credentialVars: [METRICA_TOKEN_VAR, METRICA_COUNTER_VAR, WEBMASTER_TOKEN_VAR],
  tools: [
    { name: "yandex_health", access: "read", credentials: [] },
    { name: "yandex_capabilities", access: "read", credentials: [] },
    { name: "yandex_metrica_report", access: "read", credentials: [METRICA_TOKEN_VAR] },
    { name: "yandex_webmaster_hosts", access: "read", credentials: [WEBMASTER_TOKEN_VAR] },
    { name: "yandex_webmaster_host_summary", access: "read", credentials: [WEBMASTER_TOKEN_VAR] },
    { name: "yandex_webmaster_search_queries", access: "read", credentials: [WEBMASTER_TOKEN_VAR] },
    { name: "yandex_webmaster_indexing", access: "read", credentials: [WEBMASTER_TOKEN_VAR] },
    { name: "yandex_webmaster_in_search_urls", access: "read", credentials: [WEBMASTER_TOKEN_VAR] },
  ],
};

const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const isDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

serveMcp(CONFIG.name, CONFIG.version, (server) => {
  server.registerTool(
    "yandex_health",
    { description: "Process status and configuration presence. Never returns secret values.", inputSchema: {} },
    async () => asText(healthPayload(CONFIG)),
  );
  server.registerTool(
    "yandex_capabilities",
    { description: "List of tools, whether each is read or write, and credentials each requires.", inputSchema: {} },
    async () => asText(capabilitiesPayload(CONFIG)),
  );
  server.registerTool(
    "yandex_metrica_report",
    {
      description: "Aggregated Yandex Metrica report for a date range. Individual-visitor dimensions are refused.",
      inputSchema: {
        counter_id: z.string().optional().describe("Defaults to YANDEX_METRICA_COUNTER_ID"),
        date1: isDate,
        date2: isDate,
        metrics: z.array(z.string()).min(1).max(20).describe("e.g. ym:s:visits, ym:s:users"),
        dimensions: z.array(z.string()).max(5).default([]).describe("e.g. ym:s:trafficSource, ym:s:date"),
        limit: z.number().int().min(1).max(10000).default(100),
        output_path: z.string().optional().describe("Relative to the data directory, ends in .jsonl. Written for core ingest."),
      },
    },
    async (args) => asText(await metricaReport(args)),
  );
  server.registerTool(
    "yandex_webmaster_hosts",
    { description: "Hosts in Yandex Webmaster for this account, with verification state.", inputSchema: {} },
    async () => asText(await listHosts()),
  );
  server.registerTool(
    "yandex_webmaster_host_summary",
    { description: "Host summary: SQI, searchable and excluded page counts, site problems.", inputSchema: { host_id: z.string().min(1) } },
    async (args) => asText(await hostSummary(args)),
  );
  server.registerTool(
    "yandex_webmaster_search_queries",
    {
      description: "Popular search queries for a host, by shows.",
      inputSchema: { host_id: z.string().min(1), limit: z.number().int().min(1).max(500).default(100) },
    },
    async (args) => asText(await searchQueries(args)),
  );
  server.registerTool(
    "yandex_webmaster_indexing",
    { description: "Indexing: in-search history, sitemaps with errors, recrawl quota.", inputSchema: { host_id: z.string().min(1) } },
    async (args) => asText(await indexing(args)),
  );
  server.registerTool(
    "yandex_webmaster_in_search_urls",
    {
      description: "URLs Yandex currently shows in search for a host. Optional JSONL output under the data directory for core ingest.",
      inputSchema: { host_id: z.string().min(1), output_path: z.string().optional().describe("Relative to the data directory, ends in .jsonl") },
    },
    async (args) => asText(await inSearchUrls(args)),
  );
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
