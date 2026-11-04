import { startStubServer } from "@awesome-seo/core";

startStubServer({
  prefix: "yandex",
  name: "yandex",
  version: "0.0.1",
  credentialVars: ["YANDEX_WEBMASTER_TOKEN", "YANDEX_METRICA_TOKEN"],
  tools: [
    { name: "yandex_health", access: "read", credentials: [] },
    { name: "yandex_capabilities", access: "read", credentials: [] },
  ],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
