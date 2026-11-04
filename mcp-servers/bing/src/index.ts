import { startStubServer } from "@awesome-seo/core";

startStubServer({
  prefix: "bing",
  name: "bing",
  version: "0.0.1",
  credentialVars: ["BING_WEBMASTER_API_KEY"],
  tools: [
    { name: "bing_health", access: "read", credentials: [] },
    { name: "bing_capabilities", access: "read", credentials: [] },
  ],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
