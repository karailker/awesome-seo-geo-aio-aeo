// yandex MCP server (P7): Yandex Metrica aggregated reports. Webmaster tools come in P8.
import { capabilitiesPayload, healthPayload, serveMcp, z, type StubServerConfig } from "@awesome-seo/core";
import { METRICA_COUNTER_VAR, METRICA_TOKEN_VAR, metricaReport } from "./tools.js";

const CONFIG: StubServerConfig = {
  prefix: "yandex",
  name: "yandex",
  version: "0.0.1",
  credentialVars: [METRICA_TOKEN_VAR, METRICA_COUNTER_VAR],
  tools: [
    { name: "yandex_health", access: "read", credentials: [] },
    { name: "yandex_capabilities", access: "read", credentials: [] },
    { name: "yandex_metrica_report", access: "read", credentials: [METRICA_TOKEN_VAR] },
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
      },
    },
    async (args) => asText(await metricaReport(args)),
  );
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
