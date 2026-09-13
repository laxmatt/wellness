import { join } from "node:path";
import { categoryById } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { CategoryDefinition as CategorySchema } from "@/domain/category";
import type { Brand, Merchant, MerchantOffer, Product } from "@/domain/product";
import { demo, manufacturer } from "@/domain/provenance";
import { toProductView, type ProductView } from "@/domain/view";
import { loadLocalCatalog, type LoadedCatalog } from "@/providers/catalog/LocalCatalogProvider";

export const CATALOG_DIR = join(process.cwd(), "catalog");

let cached: LoadedCatalog | undefined;
export function catalog(): LoadedCatalog {
  cached ??= loadLocalCatalog(CATALOG_DIR);
  return cached;
}

export function viewsFor(categoryId: string, products = catalog().products): ProductView[] {
  const c = catalog();
  return products
    .filter((p) => p.categoryId === categoryId)
    .map((p) => toProductView(p, { category: categoryById(p.categoryId)!, brands: c.brands, merchants: c.merchants }));
}

export const testBrand: Brand = { id: "acme", slug: "acme", name: "Acme", images: [], market: "US" };
export const testMerchant: Merchant = { id: "shop", slug: "shop", name: "Shop", markets: ["US"] };

export function offer(id: string, priceMinor: number, status: MerchantOffer["affiliate"]["status"] = "unknown", demoPrice = false): MerchantOffer {
  return {
    id,
    merchantId: "shop",
    market: "US",
    currency: "USD",
    priceMinor,
    url: "https://example.com/" + id,
    affiliate: { status },
    discountCodes: [],
    availability: "unknown",
    lastChecked: "2026-09-08",
    source: demoPrice ? { kind: "demo", method: "direct" } : { kind: "merchant_feed", method: "direct", retrievedAt: "2026-09-08" },
  };
}

// Minimal category for engine tests. Two numeric criteria, one enum, one boolean.
export const miniCategory: CategoryDefinition = CategorySchema.parse({
  id: "mini",
  slug: "mini",
  name: "Mini",
  navLabel: "Mini",
  tagline: "t",
  intro: "i",
  attributeDefinitions: [
    { key: "power", label: "Power", type: "number", group: "g", compareOrder: 1, preferenceDirection: "higher_better", required: true },
    { key: "noise", label: "Noise", type: "number", group: "g", compareOrder: 2, preferenceDirection: "lower_better" },
    { key: "size", label: "Size", type: "enum", enumOptions: [{ value: "s", label: "S", rank: 1 }, { value: "m", label: "M", rank: 2 }, { value: "l", label: "L", rank: 3 }], group: "g", compareOrder: 3, preferenceDirection: "higher_better", required: true },
    { key: "wifi", label: "Wifi", type: "boolean", group: "g", compareOrder: 4, preferenceDirection: "higher_better" },
  ],
  cardSpecKeys: ["power"],
  compareGroups: [{ label: "g", keys: ["power", "noise", "size", "wifi"] }],
  filters: [],
  scoring: { criteria: [{ key: "power", weight: 2 }, { key: "noise", weight: 1 }, { key: "size", weight: 1 }, { key: "wifi", weight: 1 }], label: "Capability score", meaning: "Test scale.", completenessFloor: 0.5 },
  value: { qualityWeight: 0.65, affordabilityWeight: 0.35, priceBasis: "price" },
  badges: { priceBasis: "price", budgetMaxMinor: 20000, premiumMinMinor: 80000, minQualifying: 2, tieBreak: ["power"] },
  insightRules: [{ id: "cheap", when: [{ key: "price", op: "lt", value: 20000 }], text: "Under $200 with {power} of power.", tone: "strength" }],
  relaxationOrder: ["price", "size"],
  priceTiers: [{ id: "b", label: "b", maxMinor: 20000 }, { id: "p", label: "p" }],
  facets: [],
});

export function miniProduct(
  id: string,
  priceMinor: number,
  attrs: { power?: number; noise?: number; size?: "s" | "m" | "l"; wifi?: boolean },
  status: MerchantOffer["affiliate"]["status"] = "unknown",
  // Keys whose value should be recorded as placeholder data, for guard tests.
  demoKeys: string[] = [],
  demoPrice = false,
): Product {
  const src = (k: string, v: never) =>
    demoKeys.includes(k) ? demo(v) : manufacturer(v, { url: "https://example.com", retrievedAt: "2026-09-08" });
  const attributes: Product["attributes"] = {};
  if (attrs.power !== undefined) attributes.power = src("power", attrs.power as never);
  if (attrs.noise !== undefined) attributes.noise = src("noise", attrs.noise as never);
  if (attrs.size !== undefined) attributes.size = src("size", attrs.size as never);
  if (attrs.wifi !== undefined) attributes.wifi = src("wifi", attrs.wifi as never);
  return {
    id,
    slug: id,
    name: id,
    brandId: "acme",
    categoryId: "mini",
    description: "",
    status: "published",
    availability: "unknown",
    market: "US",
    images: [{ id: `${id}-primary`, kind: "demo_placeholder", role: "primary", src: `demo:${id}`, alt: id }],
    offers: [offer(`${id}-o`, priceMinor, status, demoPrice)],
    identifiers: { gtin: [], merchantSkus: {} },
    attributes,
    editorial: { strengths: [], tradeoffs: [] },
    source: { kind: "demo", method: "direct" },
    lastUpdated: "2026-09-08",
    flags: { demo: true, newArrival: false },
  };
}

export function miniView(p: Product): ProductView {
  return toProductView(p, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
}

// A category with two money attributes: one that says it was computed from the
// price, and one that stands on its own source.
//
// Tests that need a withheld money figure build on this rather than naming
// whichever catalogue product still carries a prototype price. That product
// keeps changing: it was Liquid I.V., then OLIPOP, and each real price read
// broke a test that was never about that product.
export const moneyCategory: CategoryDefinition = CategorySchema.parse({
  ...JSON.parse(JSON.stringify(miniCategory)),
  attributeDefinitions: [
    ...JSON.parse(JSON.stringify(miniCategory.attributeDefinitions)),
    { key: "cost_per_use_minor", label: "Cost per use", type: "integer", unit: "USD_minor", group: "g", compareOrder: 9, preferenceDirection: "lower_better" },
    { key: "shipping_minor", label: "Shipping", type: "integer", unit: "USD_minor", group: "g", compareOrder: 10, preferenceDirection: "lower_better" },
  ],
});

// `cost_per_use_minor` is derived from the price; `shipping_minor` is not.
export function moneyView(
  id: string,
  priceMinor: number,
  demoPrice: boolean,
  amounts: { derived?: number; stated?: number } = {},
): ProductView {
  const p = miniProduct(id, priceMinor, { power: 50, size: "m" }, "unknown", [], demoPrice);
  const src = { url: "https://example.com", retrievedAt: "2026-09-09", unit: "USD_minor" };
  p.attributes.cost_per_use_minor = {
    ...manufacturer(amounts.derived ?? 120, { ...src, note: "Pack price divided by uses." }),
    derivedFrom: "price" as const,
  };
  p.attributes.shipping_minor = manufacturer(amounts.stated ?? 499, { ...src, note: "Flat shipping, stated on the merchant's own page." });
  return toProductView(p, { category: moneyCategory, brands: [testBrand], merchants: [testMerchant] });
}
