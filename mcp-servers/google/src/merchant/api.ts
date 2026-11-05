// Merchant API (products). Scope: https://www.googleapis.com/auth/content.
// VERIFY: the API version and paths (products/v1/accounts/{account}/products), the product status fields
// (productStatus.itemLevelIssues), and the page size limit (250) must be checked against current Merchant API
// documentation before relying on them. The project must be linked to the Merchant Center account.
import type { TokenProvider } from "../gsc/auth.js";
import { fromHttpStatus, GscError } from "../gsc/errors.js";

export const MERCHANT_SCOPE = "https://www.googleapis.com/auth/content";
const BASE = "https://merchantapi.googleapis.com/products/v1";
const TIMEOUT_MS = 30_000;
export const MERCHANT_MAX_PAGE = 250; // VERIFY

export type MerchantIssue = { code: string; severity: string; description: string | null; attribute: string | null };
export type MerchantProduct = {
  name: string;
  offerId: string;
  link: string | null;
  issues: MerchantIssue[];
};

export class MerchantClient {
  constructor(
    private readonly tokens: TokenProvider,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async listProducts(account: string, pageSize: number): Promise<{ products: MerchantProduct[]; nextPageToken?: string }> {
    const token = await this.tokens.getToken();
    let res: Response;
    try {
      res = await this.fetchImpl(`${BASE}/accounts/${account}/products?pageSize=${pageSize}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        throw new GscError("TIMEOUT", "Merchant API request timed out", true);
      }
      throw new GscError("UPSTREAM_ERROR", "Merchant API request failed", true);
    }
    if (!res.ok) throw fromHttpStatus(res.status);
    const body = (await res.json()) as {
      products?: {
        name: string;
        offerId?: string;
        link?: string;
        productStatus?: { itemLevelIssues?: { code: string; severity?: string; description?: string; attribute?: string }[] };
      }[];
      nextPageToken?: string;
    };
    return {
      products: (body.products ?? []).map((p) => ({
        name: p.name,
        offerId: p.offerId ?? "",
        link: p.link ?? null,
        issues: (p.productStatus?.itemLevelIssues ?? []).map((i) => ({
          code: i.code,
          severity: i.severity ?? "unknown",
          description: i.description ?? null,
          attribute: i.attribute ?? null,
        })),
      })),
      nextPageToken: body.nextPageToken,
    };
  }
}
