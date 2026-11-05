// Output paths for snapshot files. Writers may only create files under AWESOME_SEO_DATA_DIR (default ./data).
import { resolve, sep } from "node:path";

export const DATA_DIR_ENV = "AWESOME_SEO_DATA_DIR";

export function resolveDataOutput(outputPath: string, extension: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = resolve(env[DATA_DIR_ENV] ?? "data");
  const target = resolve(base, outputPath);
  if (!target.startsWith(base + sep)) throw new Error("output_path must stay inside the data directory");
  if (!target.endsWith(extension)) throw new Error(`output_path must end with ${extension}`);
  return target;
}
