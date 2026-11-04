import { describe, expect, it } from "vitest";
import { capabilitiesPayload, healthPayload, type StubServerConfig } from "./index.js";

const config: StubServerConfig = {
  prefix: "google",
  name: "google",
  version: "0.0.1",
  credentialVars: ["GOOGLE_SERVICE_ACCOUNT_KEY_FILE"],
  tools: [
    { name: "google_health", access: "read", credentials: [] },
    { name: "google_capabilities", access: "read", credentials: [] },
  ],
};

describe("stub server payloads", () => {
  it("reports credential presence without values", () => {
    const present = healthPayload(config, {
      GOOGLE_SERVICE_ACCOUNT_KEY_FILE: "/somewhere/key.json",
    });
    const missing = healthPayload(config, {});
    expect(present.credentials.GOOGLE_SERVICE_ACCOUNT_KEY_FILE).toBe(true);
    expect(missing.credentials.GOOGLE_SERVICE_ACCOUNT_KEY_FILE).toBe(false);
    expect(JSON.stringify(present)).not.toContain("/somewhere/key.json");
  });

  it("lists every tool with access and credentials", () => {
    const caps = capabilitiesPayload(config);
    expect(caps.tools.map((t) => t.name)).toEqual(["google_health", "google_capabilities"]);
    expect(caps.tools.every((t) => t.access === "read")).toBe(true);
  });
});
