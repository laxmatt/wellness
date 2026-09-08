import { describe, expect, it } from "vitest";
import { categoryById } from "@/domain/categories";
import { MockAIProvider, detectMedicalIntent } from "@/providers/ai/AIProvider";
import { MemoryAnalyticsProvider } from "@/providers/analytics/AnalyticsProvider";
import { LocalCatalogProvider } from "@/providers/catalog/LocalCatalogProvider";
import { IdentifierEntityResolver, triageRows, type FeedRow } from "@/providers/feeds/MerchantFeedAdapter";
import { catalog, CATALOG_DIR, miniProduct } from "./fixtures";

describe("LocalCatalogProvider", () => {
  const provider = LocalCatalogProvider.fromDirectory(CATALOG_DIR);

  it("filters products by category and status", async () => {
    const rl = await provider.listProducts({ categoryId: "red-light", status: ["published"] });
    expect(rl.length).toBe(8);
  });

  it("returns null for unknown slugs", async () => {
    expect(await provider.getProduct("nope")).toBeNull();
    expect(await provider.getProductView("nope")).toBeNull();
  });

  it("returns normalized views", async () => {
    const v = await provider.getProductView("plunge-original");
    expect(v?.attributes.chiller_included).toBe(true);
    expect(v?.brand.name).toBe("Plunge");
  });
});

describe("IdentifierEntityResolver", () => {
  const resolver = new IdentifierEntityResolver();
  const row = (over: Partial<FeedRow>): FeedRow => ({
    merchantId: "amazon",
    merchantSku: "SKU-1",
    title: "Some product",
    priceMinor: 1000,
    currency: "USD",
    market: "US",
    url: "https://example.com/x",
    availability: "unknown",
    ...over,
  });

  it("matches on ASIN against the real catalog", () => {
    const r = resolver.resolve(row({ asin: "B07TT8B1JJ" }), catalog().products);
    expect(r).toMatchObject({ kind: "matched", productId: "lmnt-citrus-salt-30", matchedOn: "asin" });
  });

  it("matches on GTIN first, then MPN with normalization, then a mapped merchant SKU", () => {
    const a = { ...miniProduct("a", 1000, {}), identifiers: { gtin: ["00012345678905"], mpn: "HG-300", merchantSkus: { amazon: "AMZ-A" } } };
    const b = { ...miniProduct("b", 1000, {}), identifiers: { gtin: [], mpn: "PRO1500", merchantSkus: {} } };
    expect(resolver.resolve(row({ gtin: "00012345678905" }), [a, b])).toMatchObject({ kind: "matched", productId: "a", matchedOn: "gtin" });
    expect(resolver.resolve(row({ mpn: "hg300" }), [a, b])).toMatchObject({ kind: "matched", productId: "a", matchedOn: "mpn" });
    expect(resolver.resolve(row({ merchantSku: "AMZ-A" }), [a, b])).toMatchObject({ kind: "matched", productId: "a", matchedOn: "merchant_sku" });
  });

  it("routes ambiguous and unmatched rows to review instead of guessing", () => {
    const a = { ...miniProduct("a", 1000, {}), identifiers: { gtin: ["00012345678905"], merchantSkus: {} } };
    const b = { ...miniProduct("b", 1000, {}), identifiers: { gtin: ["00012345678905"], merchantSkus: {} } };
    const { matched, review } = triageRows([row({ gtin: "00012345678905" }), row({ title: "Hooga HG300 panel" })], [a, b], resolver, "2026-09-08T00:00:00Z");
    expect(matched.length).toBe(0);
    expect(review.length).toBe(2);
    expect(review[0].result.kind).toBe("ambiguous");
    expect(review[1].result.kind).toBe("unmatched");
  });
});

describe("MockAIProvider", () => {
  const ai = new MockAIProvider();

  it("extracts budget, coverage and footprint from the canonical example", async () => {
    const cat = categoryById("red-light")!;
    const p = await ai.extractPreferences({ text: "I need a full-body panel under $700 that won't take over my apartment.", category: cat });
    expect(p.hard).toEqual([{ key: "price", op: "lte", value: 70000 }]);
    expect(p.soft).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "coverage", value: "full_body" }),
        expect.objectContaining({ key: "footprint", value: "compact" }),
      ]),
    );
    expect(p.medicalIntent).toBe(false);
  });

  it("maps per-serving budgets and sugar-free phrasing for drinks", async () => {
    const cat = categoryById("wellness-drinks")!;
    const p = await ai.extractPreferences({ text: "Sugar free electrolytes under $2 per serving", category: cat });
    expect(p.hard).toEqual(
      expect.arrayContaining([
        { key: "price_per_serving_minor", op: "lte", value: 200 },
        { key: "sugar_g", op: "eq", value: 0 },
      ]),
    );
    expect(p.soft.some((s) => s.key === "function")).toBe(true);
  });

  it("flags medical intent and declines factual answers about treatment", async () => {
    expect(detectMedicalIntent("Which panel will treat my arthritis?")).toBe(true);
    const a = await ai.answerFactualQuestion({ question: "Which one cures arthritis?", facts: [] });
    expect(a.declined).toBe(true);
    expect(a.declineReason).toBe("medical");
  });

  it("records unmapped concepts instead of inventing filters", async () => {
    const cat = categoryById("red-light")!;
    const p = await ai.extractPreferences({ text: "something quiet", category: cat });
    expect(p.unmapped).toContain("noise level");
    expect(p.hard).toEqual([]);
  });
});

describe("analytics", () => {
  it("accepts typed events only", async () => {
    const a = new MemoryAnalyticsProvider();
    await a.track({ type: "category_viewed", categoryId: "red-light" });
    expect(a.events.length).toBe(1);
  });
});
