import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProjectEnv, parseEnvFile } from "./env.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-env-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeEnv = (text: string, mode = 0o600) => {
  const file = join(dir, ".env");
  writeFileSync(file, text);
  chmodSync(file, mode);
  return file;
};

describe("loadProjectEnv", () => {
  it("loads only the variables the servers use and ignores the rest", () => {
    const file = writeEnv("SHOPIFY_STORE_DOMAIN=shop.example\nBING_WEBMASTER_API_KEY=bing-key\nUNRELATED=1\n");
    const target: NodeJS.ProcessEnv = {};

    const r = loadProjectEnv(file, target);

    expect(target).toEqual({ BING_WEBMASTER_API_KEY: "bing-key" });
    expect(r.loaded).toEqual(["BING_WEBMASTER_API_KEY"]);
  });

  it("lets the project file override a value exported in the shell", () => {
    const file = writeEnv("BING_WEBMASTER_API_KEY=project-key\n");
    const target: NodeJS.ProcessEnv = { BING_WEBMASTER_API_KEY: "shell-key-of-another-site" };

    loadProjectEnv(file, target);

    expect(target.BING_WEBMASTER_API_KEY).toBe("project-key");
  });

  it("removes a server key the shell exported when the project file does not define it", () => {
    // Given: the shell holds a Yandex token for another site; this project's .env has no Yandex entry
    const file = writeEnv("BING_WEBMASTER_API_KEY=project-bing\n");
    const target: NodeJS.ProcessEnv = { YANDEX_WEBMASTER_TOKEN: "other-site-token", CRUX_API_KEY: "other-site-crux" };

    // When
    loadProjectEnv(file, target);

    // Then: the other site's Yandex and CrUX values do not reach this project
    expect(target.YANDEX_WEBMASTER_TOKEN).toBeUndefined();
    expect(target.CRUX_API_KEY).toBeUndefined();
    expect(target.BING_WEBMASTER_API_KEY).toBe("project-bing");
  });

  it("maps GOOGLE_APPLICATION_CREDENTIALS to the key-file name the server reads", () => {
    const file = writeEnv("GOOGLE_APPLICATION_CREDENTIALS=sa.json\n");
    const target: NodeJS.ProcessEnv = {};

    loadProjectEnv(file, target);

    expect(target.GOOGLE_SERVICE_ACCOUNT_KEY_FILE).toBe(join(dir, "sa.json"));
  });

  it("resolves a relative key path against the project folder and expands ~", () => {
    const file = writeEnv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./keys/sa.json\n");
    const target: NodeJS.ProcessEnv = {};
    loadProjectEnv(file, target);
    expect(target.GOOGLE_SERVICE_ACCOUNT_KEY_FILE).toBe(join(dir, "keys", "sa.json"));

    const home = writeEnv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE=~/sa.json\n");
    const t2: NodeJS.ProcessEnv = {};
    loadProjectEnv(home, t2);
    expect(t2.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.endsWith("/sa.json")).toBe(true);
    expect(t2.GOOGLE_SERVICE_ACCOUNT_KEY_FILE?.startsWith("~")).toBe(false);
  });

  it("warns when the file is readable by others, and never prints a value", () => {
    const file = writeEnv("BING_WEBMASTER_API_KEY=secret-value-123\n", 0o644);

    const r = loadProjectEnv(file, {});

    expect(r.warnings).toEqual([`${file} is readable by others (mode 644); run chmod 600.`]);
    expect(JSON.stringify(r)).not.toContain("secret-value-123");
  });

  it("does nothing when there is no project file", () => {
    const target: NodeJS.ProcessEnv = { BING_WEBMASTER_API_KEY: "shell" };

    const r = loadProjectEnv(join(dir, "missing.env"), target);

    expect(r).toEqual({ file: null, loaded: [], warnings: [] });
    expect(target.BING_WEBMASTER_API_KEY).toBe("shell");
  });
});

describe("parseEnvFile", () => {
  it("accepts export prefixes, quotes, comments and blank lines", () => {
    expect(parseEnvFile('# note\n\nexport BING_WEBMASTER_API_KEY="abc"\nPAGESPEED_API_KEY=\'def\'\n')).toEqual({
      BING_WEBMASTER_API_KEY: "abc",
      PAGESPEED_API_KEY: "def",
    });
  });
});
