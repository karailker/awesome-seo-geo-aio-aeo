// Shared MCP serve helper for TypeScript servers (docs/MCP.md). Servers register their own tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export { McpServer };
export { z } from "zod";

export async function serveMcp(name: string, version: string, register: (server: McpServer) => void): Promise<void> {
  const server = new McpServer({ name, version });
  register(server);
  await server.connect(new StdioServerTransport());
}
