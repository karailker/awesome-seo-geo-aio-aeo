import { defineConfig } from "drizzle-kit";

// Generates versioned SQL into migrations/. Applied by src/db/store.ts (applyMigrations).
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
