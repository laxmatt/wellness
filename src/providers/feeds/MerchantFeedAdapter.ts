import { z } from "zod";
import { Currency, Market } from "@/domain/money";
import { Availability, Id } from "@/domain/product";
import type { Product } from "@/domain/product";

// Normalized row produced by any feed adapter (Awin, Impact, CJ, direct CSV).
// A feed row is never a product. It is a claim by one merchant about one SKU.
export const FeedRow = z.object({
  merchantId: Id,
  merchantSku: z.string().min(1),
  title: z.string().min(1),
  brandName: z.string().optional(),
  gtin: z.string().regex(/^\d{8,14}$/).optional(),
  mpn: z.string().optional(),
  asin: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  priceMinor: z.number().int().nonnegative(),
  currency: Currency,
  market: Market,
  url: z.url(),
  availability: Availability.default("unknown"),
  imageUrl: z.url().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});
export type FeedRow = z.infer<typeof FeedRow>;

export interface MerchantFeedAdapter {
  readonly network: string;
  parse(input: string | Buffer): Promise<FeedRow[]>;
}

export type MatchedOn = "gtin" | "asin" | "mpn" | "merchant_sku";

export type ResolutionResult =
  | { kind: "matched"; productId: string; confidence: number; matchedOn: MatchedOn }
  | { kind: "ambiguous"; candidateIds: string[]; reason: string }
  | { kind: "unmatched"; reason: string };

export interface EntityResolver {
  resolve(row: FeedRow, products: Product[]): ResolutionResult;
}

export type ReviewQueueItem = {
  row: FeedRow;
  result: Exclude<ResolutionResult, { kind: "matched" }>;
  queuedAt: string;
};

// Deterministic identifier matching. Order of trust: GTIN, ASIN, MPN with brand
// agreement, then a merchant SKU the operator mapped previously. Anything
// weaker (title similarity) is never auto-matched; it goes to review.
export class IdentifierEntityResolver implements EntityResolver {
  resolve(row: FeedRow, products: Product[]): ResolutionResult {
    if (row.gtin) {
      const hits = products.filter((p) => p.identifiers.gtin.includes(row.gtin!));
      if (hits.length === 1) return { kind: "matched", productId: hits[0].id, confidence: 1, matchedOn: "gtin" };
      if (hits.length > 1) return { kind: "ambiguous", candidateIds: hits.map((p) => p.id), reason: "GTIN on multiple products" };
    }
    if (row.asin) {
      const hits = products.filter((p) => p.identifiers.asin === row.asin);
      if (hits.length === 1) return { kind: "matched", productId: hits[0].id, confidence: 0.98, matchedOn: "asin" };
      if (hits.length > 1) return { kind: "ambiguous", candidateIds: hits.map((p) => p.id), reason: "ASIN on multiple products" };
    }
    if (row.mpn) {
      const norm = normalizeCode(row.mpn);
      const hits = products.filter((p) => p.identifiers.mpn && normalizeCode(p.identifiers.mpn) === norm);
      if (hits.length === 1) {
        return { kind: "matched", productId: hits[0].id, confidence: 0.9, matchedOn: "mpn" };
      }
      if (hits.length > 1) return { kind: "ambiguous", candidateIds: hits.map((p) => p.id), reason: "MPN on multiple products" };
    }
    const skuHits = products.filter((p) => p.identifiers.merchantSkus[row.merchantId] === row.merchantSku);
    if (skuHits.length === 1) return { kind: "matched", productId: skuHits[0].id, confidence: 0.95, matchedOn: "merchant_sku" };
    if (skuHits.length > 1) return { kind: "ambiguous", candidateIds: skuHits.map((p) => p.id), reason: "merchant SKU mapped to multiple products" };

    return { kind: "unmatched", reason: "no stable identifier matched" };
  }
}

export function normalizeCode(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function triageRows(
  rows: FeedRow[],
  products: Product[],
  resolver: EntityResolver,
  now = new Date().toISOString(),
): { matched: { row: FeedRow; productId: string; matchedOn: MatchedOn; confidence: number }[]; review: ReviewQueueItem[] } {
  const matched: { row: FeedRow; productId: string; matchedOn: MatchedOn; confidence: number }[] = [];
  const review: ReviewQueueItem[] = [];
  for (const row of rows) {
    const result = resolver.resolve(row, products);
    if (result.kind === "matched") matched.push({ row, productId: result.productId, matchedOn: result.matchedOn, confidence: result.confidence });
    else review.push({ row, result, queuedAt: now });
  }
  return { matched, review };
}
