import { startStubServer } from "@awesome-seo/core";

startStubServer({
  prefix: "google",
  name: "google",
  version: "0.0.1",
  credentialVars: ["GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "GOOGLE_MERCHANT_OAUTH_TOKEN_FILE"],
  tools: [
    { name: "google_health", access: "read", credentials: [] },
    { name: "google_capabilities", access: "read", credentials: [] },
  ],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
