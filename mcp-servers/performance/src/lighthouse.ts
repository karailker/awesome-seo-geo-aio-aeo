// Local Lighthouse run (P5 fallback). Lab data only, one run, on this machine.
// Uses the system Chrome (CHROME_PATH, or chrome-launcher's search). The Chrome sandbox stays on:
// the pages audited are arbitrary web pages, so --no-sandbox is not used.
import lighthouse, { desktopConfig } from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import { PerfError } from "./errors.js";
import type { Strategy } from "./psi.js";

const RUN_TIMEOUT_MS = 180_000;

export async function runLighthouseLocal(url: string, strategy: Strategy): Promise<unknown> {
  let chrome: chromeLauncher.LaunchedChrome;
  try {
    chrome = await chromeLauncher.launch({
      chromePath: process.env.CHROME_PATH || undefined,
      chromeFlags: ["--headless=new", "--disable-gpu"],
    });
  } catch {
    throw new PerfError("UPSTREAM_ERROR", "Chrome could not be started. Set CHROME_PATH to a Chrome or Chromium binary.", false);
  }
  try {
    const flags = { port: chrome.port, output: "json" as const, onlyCategories: ["performance"], logLevel: "error" as const };
    const run = lighthouse(url, flags, strategy === "desktop" ? desktopConfig : undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PerfError("TIMEOUT", "Local Lighthouse run timed out", true)), RUN_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([run, limit]);
      if (!result?.lhr) throw new PerfError("UPSTREAM_ERROR", "Local Lighthouse returned no result", true);
      return result.lhr;
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await chrome.kill();
  }
}
