import { startStubServer } from "@awesome-seo/core";

startStubServer({
  prefix: "performance",
  name: "performance",
  version: "0.0.1",
  credentialVars: ["PAGESPEED_API_KEY", "CRUX_API_KEY"],
  tools: [
    { name: "performance_health", access: "read", credentials: [] },
    { name: "performance_capabilities", access: "read", credentials: [] },
  ],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
