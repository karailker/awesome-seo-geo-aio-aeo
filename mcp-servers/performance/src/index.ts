#!/usr/bin/env node
// performance MCP server (P5): PageSpeed Insights, CrUX, and a local Lighthouse run used as fallback.
import { capabilitiesPayload, healthPayload, serveMcp, z, type StubServerConfig } from "@karailker/awesome-seo-core";
import { CRUX_KEY_VAR, cruxQuery, lighthouseLocalRun, PSI_KEY_VAR, psiRun } from "./tools.js";

const CONFIG: StubServerConfig = {
  prefix: "performance",
  name: "performance",
  version: "0.0.1",
  credentialVars: [PSI_KEY_VAR, CRUX_KEY_VAR],
  tools: [
    { name: "performance_health", access: "read", credentials: [] },
    { name: "performance_capabilities", access: "read", credentials: [] },
    { name: "performance_psi_run", access: "read", credentials: [PSI_KEY_VAR] },
    { name: "performance_crux_query", access: "read", credentials: [CRUX_KEY_VAR] },
    { name: "performance_lighthouse_local_run", access: "read", credentials: [] },
  ],
};

const asText = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

serveMcp(CONFIG.name, CONFIG.version, (server) => {
  server.registerTool(
    "performance_health",
    { description: "Process status and configuration presence. Never returns secret values.", inputSchema: {} },
    async () => asText(healthPayload(CONFIG)),
  );
  server.registerTool(
    "performance_capabilities",
    { description: "List of tools, whether each is read or write, and credentials each requires.", inputSchema: {} },
    async () => asText(capabilitiesPayload(CONFIG)),
  );
  server.registerTool(
    "performance_psi_run",
    {
      description:
        "PageSpeed Insights for one URL. Returns lab_* (Lighthouse run) and field_* (CrUX p75) values in separate fields, plus opportunities.",
      inputSchema: {
        url: z.string().url(),
        strategy: z.enum(["mobile", "desktop"]).default("mobile"),
        fallback_local: z.boolean().default(true).describe("Run local Lighthouse when PSI fails"),
      },
    },
    async (args) => asText(await psiRun(args)),
  );
  server.registerTool(
    "performance_lighthouse_local_run",
    {
      description: "Local Lighthouse run on this machine (system Chrome; CHROME_PATH optional). Lab values only, tagged lighthouse-local.",
      inputSchema: {
        url: z.string().url(),
        strategy: z.enum(["mobile", "desktop"]).default("mobile"),
      },
    },
    async (args) => asText(await lighthouseLocalRun(args)),
  );
  server.registerTool(
    "performance_crux_query",
    {
      description: "CrUX field data (p75) for an origin or a URL. Returns field_* values only.",
      inputSchema: {
        origin: z.string().url().optional(),
        url: z.string().url().optional(),
        form_factor: z.enum(["PHONE", "DESKTOP", "TABLET"]).optional(),
      },
    },
    async (args) => asText(await cruxQuery(args)),
  );
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
