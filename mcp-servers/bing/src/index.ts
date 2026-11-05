// bing MCP server (P8): Bing Webmaster search stats, page stats, and URL info. Read-only.
import { capabilitiesPayload, healthPayload, serveMcp, z, type StubServerConfig } from "@awesome-seo/core";
import { BING_KEY_VAR, pageStats, searchStats, urlInfo } from "./tools.js";

const CONFIG: StubServerConfig = {
  prefix: "bing",
  name: "bing",
  version: "0.0.1",
  credentialVars: [BING_KEY_VAR],
  tools: [
    { name: "bing_health", access: "read", credentials: [] },
    { name: "bing_capabilities", access: "read", credentials: [] },
    { name: "bing_search_stats", access: "read", credentials: [BING_KEY_VAR] },
    { name: "bing_page_stats", access: "read", credentials: [BING_KEY_VAR] },
    { name: "bing_url_info", access: "read", credentials: [BING_KEY_VAR] },
  ],
};

const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const site = z.string().min(1).describe("Site URL as registered in Bing, e.g. https://bulmacalig.com/");

serveMcp(CONFIG.name, CONFIG.version, (server) => {
  server.registerTool(
    "bing_health",
    { description: "Process status and configuration presence. Never returns secret values.", inputSchema: {} },
    async () => asText(healthPayload(CONFIG)),
  );
  server.registerTool(
    "bing_capabilities",
    { description: "List of tools, whether each is read or write, and credentials each requires.", inputSchema: {} },
    async () => asText(capabilitiesPayload(CONFIG)),
  );
  server.registerTool(
    "bing_search_stats",
    {
      description: "Daily impressions and clicks for the site (Bing rank and traffic), optionally limited to a date range and written as JSONL.",
      inputSchema: {
        site,
        start_date: z.string().optional().describe("YYYY-MM-DD"),
        end_date: z.string().optional().describe("YYYY-MM-DD"),
        output_path: z.string().optional().describe("Relative to the data directory, ends in .jsonl"),
      },
    },
    async (args) => asText(await searchStats(args)),
  );
  server.registerTool(
    "bing_page_stats",
    {
      description: "Per-page, per-day impressions, clicks, and positions for the site, optionally written as JSONL.",
      inputSchema: { site, output_path: z.string().optional().describe("Relative to the data directory, ends in .jsonl") },
    },
    async (args) => asText(await pageStats(args)),
  );
  server.registerTool(
    "bing_url_info",
    { description: "Crawl and index information for one URL: HTTP status, last crawl, discovery date.", inputSchema: { site, url: z.string().url() } },
    async (args) => asText(await urlInfo(args)),
  );
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
