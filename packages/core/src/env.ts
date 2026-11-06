// Loads the project's .env into the environment of an MCP server process. Plugin servers start with the
// environment of Claude Code, so a project .env (mode 600, gitignored) is read here instead of a shell profile.
// Only the variables the servers use are loaded. Values from the file take precedence over the shell, so a project
// always uses its own credentials. Values are never logged; only names are reported.
import { statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

export const SERVER_ENV_NAMES = [
  "GOOGLE_SERVICE_ACCOUNT_KEY_FILE",
  "GOOGLE_MERCHANT_ACCOUNT_ID",
  "BING_WEBMASTER_API_KEY",
  "PAGESPEED_API_KEY",
  "CRUX_API_KEY",
  "YANDEX_WEBMASTER_TOKEN",
  "YANDEX_METRICA_TOKEN",
  "YANDEX_METRICA_COUNTER_ID",
  "CHROME_PATH",
] as const;

// Names that hold a file path. Relative paths are resolved against the project folder; "~" is expanded.
const PATH_NAMES = new Set(["GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "CHROME_PATH"]);

// Other names that point at the same key file, for projects that already use them.
const ALIASES: Record<string, string> = { GOOGLE_APPLICATION_CREDENTIALS: "GOOGLE_SERVICE_ACCOUNT_KEY_FILE" };

export type EnvLoadResult = { file: string | null; loaded: string[]; warnings: string[] };

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = (m[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[m[1] as string] = value;
  }
  return out;
}

export function loadProjectEnv(envFile: string | undefined, target: NodeJS.ProcessEnv = process.env): EnvLoadResult {
  const result: EnvLoadResult = { file: null, loaded: [], warnings: [] };
  if (!envFile) return result;
  let text: string;
  try {
    text = readFileSync(envFile, "utf8");
  } catch {
    return result; // no project file: the shell environment is used as before
  }
  result.file = envFile;
  const mode = statSync(envFile).mode & 0o777;
  if (mode & 0o077) result.warnings.push(`${envFile} is readable by others (mode ${mode.toString(8)}); run chmod 600.`);

  const projectDir = dirname(envFile);
  const values = parseEnvFile(text);
  // The project file is authoritative for the server names: a name it does not define is removed, so a key
  // exported by the shell for another site cannot reach this project.
  const defined = new Set(Object.keys(values).map((n) => ALIASES[n] ?? n));
  for (const name of SERVER_ENV_NAMES) {
    if (!defined.has(name)) delete target[name];
  }
  for (const [name, raw] of Object.entries(values)) {
    const key = ALIASES[name] ?? name;
    if (!(SERVER_ENV_NAMES as readonly string[]).includes(key) || !raw) continue;
    let value = raw;
    if (PATH_NAMES.has(key)) {
      if (value.startsWith("~/")) value = resolve(homedir(), value.slice(2));
      else if (!isAbsolute(value)) value = resolve(projectDir, value);
    }
    target[key] = value;
    result.loaded.push(key);
  }
  return result;
}
