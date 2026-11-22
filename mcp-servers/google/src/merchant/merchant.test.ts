// Most fixtures below are hand-written from the documented product shape. The LIVE_SHAPE fixture follows a response
// recorded from a live Merchant Center account (link and title nested under productAttributes).
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenProvider, type ServiceAccount } from "../gsc/auth.js";
import { MERCHANT_SCOPE, MerchantClient } from "./api.js";
import { MAX_PAGES } from "./tools.js";
import { groupIssues, listProductIssues, listProducts } from "./tools.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA: ServiceAccount = {
  client_email: "gsc@example.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  token_uri: "https://oauth2.googleapis.com/token",
};
const ACCOUNT = "123456789";
const env = { GOOGLE_MERCHANT_ACCOUNT_ID: ACCOUNT } as NodeJS.ProcessEnv;

const PRODUCTS = {
  products: [
    { name: "accounts/1/products/online~en~A", offerId: "A", link: "https://shop.example/a", productStatus: { itemLevelIssues: [{ code: "missing_gtin", severity: "error", description: "GTIN is missing", attribute: "gtin" }] } },
    { name: "accounts/1/products/online~en~B", offerId: "B", link: "https://shop.example/b", productStatus: { itemLevelIssues: [{ code: "missing_gtin", severity: "error", attribute: "gtin" }, { code: "image_link_broken", severity: "warning" }] } },
    { name: "accounts/1/products/online~en~C", offerId: "C", link: "https://shop.example/c" },
  ],
};

function client(handler: (url: string) => Response) {
  const impl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === SA.token_uri) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }), { status: 200 });
    return handler(url);
  }) as typeof fetch;
  return new MerchantClient(new TokenProvider(SA, MERCHANT_SCOPE, impl), impl);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Shape recorded from the live Merchant API (products/v1): link and title sit under productAttributes, and the same
// issue code repeats once per destination or country.
const LIVE_SHAPE = {
  products: [
    {
      name: "accounts/1/products/tr~TRY_1~A", offerId: "A",
      productAttributes: { title: "Product A", link: "https://shop.example/a" },
      productStatus: { itemLevelIssues: [
        { code: "weapons_policy", severity: "DISAPPROVED", description: "Weapons" },
        { code: "weapons_policy", severity: "DISAPPROVED", description: "Weapons" },
        { code: "weapons_policy", severity: "DISAPPROVED", description: "Weapons" },
      ] },
    },
    {
      name: "accounts/1/products/tr~TRY_1~B", offerId: "B",
      productAttributes: { title: "Product B", link: "https://shop.example/b" },
      productStatus: { itemLevelIssues: [{ code: "weapons_policy", severity: "DISAPPROVED", description: "Weapons" }] },
    },
  ],
};

describe("Merchant live response shape", () => {
  it("reads the product link and title from productAttributes", async () => {
    const c = client(() => json(LIVE_SHAPE));

    const page = await c.listProducts(ACCOUNT, 10);

    expect(page.products[0]).toMatchObject({ offerId: "A", link: "https://shop.example/a", title: "Product A" });
  });

  it("lists each affected product once per issue code, however many times the code repeats", async () => {
    const c = client(() => json(LIVE_SHAPE));

    const result = await listProductIssues(async () => c, { account: ACCOUNT, page_size: 10 }, env);

    const group = (result as { data: { issueGroups: { code: string; products: { offerId: string }[] }[] } }).data.issueGroups[0];
    expect(group?.code).toBe("weapons_policy");
    expect(group?.products.map((p) => p.offerId)).toEqual(["A", "B"]);
  });
});

describe("Merchant pagination", () => {
  const product = (n: number) => ({
    name: `accounts/1/products/p${n}`, offerId: `o${n}`, productAttributes: { title: `T${n}`, link: `https://shop.example/${n}` },
    productStatus: { itemLevelIssues: [{ code: "policy", severity: "DISAPPROVED" }] },
  });

  it("reads every page of products when listing issues and reports the total read", async () => {
    // Given: three pages of two products each, linked by nextPageToken
    const seen: string[] = [];
    const c = client((url) => {
      seen.push(url);
      const token = new URL(url).searchParams.get("pageToken");
      if (token === null) return json({ products: [product(1), product(2)], nextPageToken: "t2" });
      if (token === "t2") return json({ products: [product(3), product(4)], nextPageToken: "t3" });
      return json({ products: [product(5), product(6)] });
    });

    // When
    const result = (await listProductIssues(async () => c, { account: ACCOUNT, page_size: 2 }, env)) as { data: { productsRead: number; issueGroups: { products: unknown[] }[] }; warnings: string[] };

    // Then
    expect(seen).toHaveLength(3);
    expect(result.data.productsRead).toBe(6);
    expect(result.data.issueGroups[0]?.products).toHaveLength(6);
    expect(result.warnings).toEqual([]);
  });

  it("stops at the page limit and says the result is partial", async () => {
    const c = client(() => json({ products: [product(1)], nextPageToken: "more" }));

    const result = (await listProductIssues(async () => c, { account: ACCOUNT, page_size: 1 }, env)) as { data: { productsRead: number }; warnings: string[] };

    expect(result.data.productsRead).toBe(MAX_PAGES);
    expect(result.warnings[0]).toContain("Stopped after");
  });
});

describe("Merchant HTTP errors", () => {
  it("names the Merchant API, not Search Console, when it returns an error status", async () => {
    const c = client(() => json({}, 401));

    await expect(c.listProducts(ACCOUNT, 10)).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
      message: "Merchant API returned HTTP 401",
    });
  });
});

describe("Merchant products and issues", () => {
  it("groups issues by code with the affected products and URLs", () => {
    const grouped = groupIssues(
      PRODUCTS.products.map((p) => ({
        name: p.name, offerId: p.offerId, link: p.link,
        issues: (p.productStatus?.itemLevelIssues ?? []).map((i) => ({ code: i.code, severity: i.severity, description: null, attribute: null })),
      })),
    );
    expect(grouped[0]).toMatchObject({ code: "missing_gtin", severity: "error" });
    expect(grouped[0]?.products.map((x) => x.link)).toEqual(["https://shop.example/a", "https://shop.example/b"]);
    expect(grouped[1]?.code).toBe("image_link_broken");
  });

  it("lists product issue groups for the configured account", async () => {
    const c = client((url) => {
      expect(url).toContain(`/accounts/${ACCOUNT}/products?pageSize=250`);
      return json(PRODUCTS);
    });

    const r = await listProductIssues(async () => c, { page_size: 250 }, env);

    expect(r.ok).toBe(true);
    expect((r.data as { productsRead: number }).productsRead).toBe(3);
  });

  it("lists products with issue counts", async () => {
    const c = client(() => json(PRODUCTS));

    const r = await listProducts(async () => c, { page_size: 100 }, env);

    expect((r.data as { products: { issueCount: number }[] }).products.map((p) => p.issueCount)).toEqual([1, 2, 0]);
  });

  it("refuses to run without an account ID, before any request", async () => {
    let called = false;
    const c = client(() => { called = true; return json({}); });

    const r = await listProducts(async () => c, { page_size: 10 }, {} as NodeJS.ProcessEnv);

    expect(r.errors[0]?.code).toBe("INVALID_INPUT");
    expect(called).toBe(false);
  });

  it("maps 401 from the Merchant API (project not linked) to AUTH_EXPIRED", async () => {
    const c = client(() => json({ error: { message: "not registered" } }, 401));

    const r = await listProducts(async () => c, { page_size: 10 }, env);

    expect(r.errors[0]?.code).toBe("AUTH_EXPIRED");
  });
});
