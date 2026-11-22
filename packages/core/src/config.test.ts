import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initConfig, resolveConfig } from "./config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "core-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveConfig", () => {
  it("fills defaults from the origin and marks them as defaults", () => {
    const c = resolveConfig({ origin: "https://www.example.com" });

    expect(c.origin).toBe("https://www.example.com");
    expect(c.sitemap).toBe("https://www.example.com/sitemap.xml");
    expect(c.urlCap).toBe(500);
    expect(c.sources.gsc).toEqual({ enabled: true, property: "sc-domain:example.com", defaulted: true });
    expect(c.sources.bing).toEqual({ enabled: true, site: "https://www.example.com/", defaulted: true });
  });

  it("disables a source that has no identifier and says why", () => {
    const c = resolveConfig({ origin: "https://example.com" });

    expect(c.sources.ga4).toEqual({ enabled: false, reason: "ga4.propertyId is not set" });
    expect(c.sources.merchant).toEqual({ enabled: false, reason: "merchant.accountId is not set" });
    expect(c.sources.yandex).toEqual({ enabled: false, reason: "yandex.hostId and yandex.counterId are not set" });
  });

  it("uses the identifiers that are given", () => {
    const c = resolveConfig({
      origin: "https://example.com", sitemap: "https://example.com/map.xml", urlCap: 1200,
      gsc: { property: "https://example.com/" }, ga4: { propertyId: "123" }, bing: { site: "https://example.com/" },
      yandex: { hostId: "https:example.com:443", counterId: "99" }, merchant: { accountId: "55" }, performance: { urls: ["https://example.com/a"] },
    });

    expect(c.sitemap).toBe("https://example.com/map.xml");
    expect(c.urlCap).toBe(1200);
    expect(c.sources.gsc).toEqual({ enabled: true, property: "https://example.com/", defaulted: false });
    expect(c.sources.ga4).toEqual({ enabled: true, propertyId: "123" });
    expect(c.sources.yandex).toEqual({ enabled: true, hostId: "https:example.com:443", counterId: "99" });
    expect(c.sources.merchant).toEqual({ enabled: true, accountId: "55" });
    expect(c.performanceUrls).toEqual(["https://example.com/a"]);
  });

  it("rejects an unknown key, a bad GA4 id and a missing origin", () => {
    expect(() => resolveConfig({ origin: "https://example.com", ga5: {} })).toThrow(/ga5/);
    expect(() => resolveConfig({ origin: "https://example.com", ga4: { propertyId: "abc" } })).toThrow(/propertyId/);
    expect(() => resolveConfig({})).toThrow(/origin/);
  });

  it("rejects values that look like secrets by name", () => {
    expect(() => resolveConfig({ origin: "https://example.com", bing: { site: "https://example.com/", apiKey: "x" } })).toThrow();
  });
});

describe("initConfig", () => {
  it("writes a template with the origin and refuses to overwrite a file", () => {
    const file = join(dir, "awesome-seo.json");

    initConfig(file, "https://example.com");

    const written = JSON.parse(readFileSync(file, "utf8"));
    expect(written.origin).toBe("https://example.com");
    expect(() => initConfig(file, "https://other.example")).toThrow(/already exists/);
    expect(JSON.parse(readFileSync(file, "utf8")).origin).toBe("https://example.com");
  });

  it("writes a file that resolveConfig accepts", () => {
    const file = join(dir, "awesome-seo.json");
    initConfig(file, "https://example.com");

    expect(() => resolveConfig(JSON.parse(readFileSync(file, "utf8")))).not.toThrow();
  });
});
