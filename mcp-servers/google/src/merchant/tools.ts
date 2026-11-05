// Merchant tool handlers. Account from the argument or GOOGLE_MERCHANT_ACCOUNT_ID. Return the ToolResult envelope.
import type { ToolResult } from "@awesome-seo/core";
import { GscError } from "../gsc/errors.js";
import { MERCHANT_MAX_PAGE, type MerchantClient, type MerchantProduct } from "./api.js";

export type MerchantClientProvider = () => Promise<MerchantClient>;
type Env = NodeJS.ProcessEnv;

const ok = <T>(data: T, warnings: string[] = []): ToolResult<T> => ({
  ok: true, data, source: "merchant", collectedAt: new Date().toISOString(), warnings, errors: [],
});
const fail = (err: unknown): ToolResult<never> => {
  const e = err instanceof GscError ? err : new GscError("UPSTREAM_ERROR", "Unexpected error", false);
  return { ok: false, source: "merchant", collectedAt: new Date().toISOString(), warnings: [], errors: [{ code: e.code, message: e.message, retryable: e.retryable }] };
};

function account(input: { account?: string }, env: Env): string {
  const a = input.account ?? env.GOOGLE_MERCHANT_ACCOUNT_ID;
  if (!a || !/^\d+$/.test(a)) throw new GscError("INVALID_INPUT", "Merchant account ID is not set (numeric). Set GOOGLE_MERCHANT_ACCOUNT_ID.", false);
  return a;
}

export async function listProducts(getClient: MerchantClientProvider, input: { account?: string; page_size: number }, env: Env = process.env) {
  try {
    if (input.page_size < 1 || input.page_size > MERCHANT_MAX_PAGE) throw new GscError("INVALID_INPUT", `page_size must be 1 to ${MERCHANT_MAX_PAGE}`, false);
    const acct = account(input, env);
    const page = await (await getClient()).listProducts(acct, input.page_size);
    return ok({ account: acct, count: page.products.length, products: page.products.map((p) => ({ name: p.name, offerId: p.offerId, link: p.link, issueCount: p.issues.length })), nextPageToken: page.nextPageToken ?? null });
  } catch (err) {
    return fail(err);
  }
}

// Issues grouped by code. Each group lists the products (ID, offer ID, URL) it affects, so the report can cite them.
export function groupIssues(products: MerchantProduct[]) {
  const groups = new Map<string, { code: string; severity: string; description: string | null; products: { name: string; offerId: string; link: string | null }[] }>();
  for (const p of products) {
    for (const issue of p.issues) {
      const g = groups.get(issue.code) ?? { code: issue.code, severity: issue.severity, description: issue.description, products: [] };
      g.products.push({ name: p.name, offerId: p.offerId, link: p.link });
      groups.set(issue.code, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.products.length - a.products.length);
}

export async function listProductIssues(getClient: MerchantClientProvider, input: { account?: string; page_size: number }, env: Env = process.env) {
  try {
    if (input.page_size < 1 || input.page_size > MERCHANT_MAX_PAGE) throw new GscError("INVALID_INPUT", `page_size must be 1 to ${MERCHANT_MAX_PAGE}`, false);
    const acct = account(input, env);
    const page = await (await getClient()).listProducts(acct, input.page_size);
    const groups = groupIssues(page.products);
    const warnings = page.nextPageToken ? [`Only the first ${page.products.length} products were read; more pages exist.`] : [];
    return ok({ account: acct, productsRead: page.products.length, issueGroups: groups }, warnings);
  } catch (err) {
    return fail(err);
  }
}
