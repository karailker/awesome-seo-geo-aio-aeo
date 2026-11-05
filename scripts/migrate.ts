// Opens the SQLite store, which applies any pending migrations. Usage: pnpm db:migrate
// Requires a built core (pnpm -r build). Path override: AWESOME_SEO_DB.
import { openStore } from "../packages/core/dist/index.js";

const dbPath = process.env.AWESOME_SEO_DB ?? "data/awesome-seo.sqlite";
const store = openStore(dbPath);
const schemaVersion = store.sqlite.prepare("SELECT MAX(version) AS v FROM schema_migrations").pluck().get();
store.close();

console.log(JSON.stringify({ ok: true, db: dbPath, schemaVersion }));
