// Shared domain types, SQLite store (single writer), and stub-server helper.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export * from "./domain.js";
export * from "./db/store.js";
export * from "./ingest/sitemap.js";
export * from "./ingest/gsc.js";
export * from "./ingest/crawl.js";
export * from "./ingest/geo.js";
export * from "./ingest/ga4.js";
export * from "./ingest/metrica.js";
export * from "./ingest/bing.js";
export * from "./analysis/ai-referrers.js";
export * from "./report/geo-audit.js";
export * from "./ingest/jsonl.js";
export * from "./analysis/evidence.js";
export * from "./analysis/reconcile.js";
export * from "./report/seo-audit.js";
export * from "./paths.js";
export * from "./mcp.js";

// Response envelope for all data tools — docs/MCP.md.
export type ToolResult<T> = {
  ok: boolean;
  data?: T;
  source: string;
  collectedAt: string; // ISO 8601, UTC
  period?: { start: string; end: string };
  warnings: string[];
  errors: { code: string; message: string; retryable: boolean }[];
};

export type StubTool = {
  name: string;
  access: "read" | "write";
  credentials: string[]; // credential variable names, never values
};

export type StubServerConfig = {
  prefix: string; // tool prefix: google | yandex | bing | performance | crawl
  name: string;
  version: string;
  credentialVars: string[]; // env var names whose presence health reports
  tools: StubTool[];
};

function nowIso(): string {
  return new Date().toISOString();
}

// docs/SECURITY-AND-APPROVAL.md: health reports credential presence, never values.
export function healthPayload(config: StubServerConfig, env: NodeJS.ProcessEnv = process.env) {
  return {
    ok: true,
    server: config.name,
    version: config.version,
    status: "running",
    checkedAt: nowIso(),
    credentials: Object.fromEntries(
      config.credentialVars.map((v) => [v, env[v] !== undefined && env[v] !== ""]),
    ),
  };
}

export function capabilitiesPayload(config: StubServerConfig) {
  return {
    ok: true,
    server: config.name,
    version: config.version,
    tools: config.tools,
  };
}

// Registers <prefix>_health and <prefix>_capabilities and serves over stdio.
export async function startStubServer(config: StubServerConfig): Promise<void> {
  const server = new McpServer({ name: config.name, version: config.version });

  server.registerTool(
    `${config.prefix}_health`,
    {
      description: "Process status and configuration presence. Never returns secret values.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(healthPayload(config)) }],
    }),
  );

  server.registerTool(
    `${config.prefix}_capabilities`,
    {
      description: "List of tools, whether each is read or write, and credentials each requires.",
      inputSchema: {},
    },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(capabilitiesPayload(config)) }],
    }),
  );

  await server.connect(new StdioServerTransport());
}
