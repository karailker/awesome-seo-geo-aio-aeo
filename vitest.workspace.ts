import { defineWorkspace } from "vitest/config";

export default defineWorkspace(["packages/*", "mcp-servers/*"], {
  test: {
    passWithNoTests: true,
  },
});
