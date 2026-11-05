// Merchant fixtures are hand-written from the documented product shape. No live response yet: the project is not
// linked to a Merchant Center account. Replace with a recorded response once the account is connected.
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenProvider, type ServiceAccount } from "../gsc/auth.js";
import { MERCHANT_SCOPE, MerchantClient } from "./api.js";
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
