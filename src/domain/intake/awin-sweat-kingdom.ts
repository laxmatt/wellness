/**
 * The Sweat Kingdom Awin feed, and nothing else.
 *
 * Narrow on purpose. This reads advertiser 125462's feed F3219 as it actually
 * arrived on 2026-09-13, and it is not a template for the next partner: Select
 * Saunas and SaunaCloud have sent nothing, and writing a universal importer
 * against one file would be inventing three formats from one sample.
 *
 * What the feed does and does not carry, measured across all 225 rows:
 *
 * - 62 columns, 47 of them empty in every row. No dimensions, no weight, no
 *   `product_detail`, no `product_highlight`, no `certification`. **There is
 *   not one structured specification in this feed.** Everything a shopper would
 *   compare a sauna on is either absent or buried in prose, so this adapter
 *   writes no attributes at all. Reading "5X6 Footprint - 2-3 Person" out of a
 *   title is a guess wearing a parser's clothes.
 * - `item_group_id` is empty on every row, so the feed states no variant
 *   grouping. The merchant's own product path does: 225 rows share 38 paths.
 *   That is the grouping used here, because it is the merchant's, not ours.
 * - `price` is one string, "5145.00 USD". Parsed strictly, never as a float.
 * - `availability` is the merchant's own machine-readable claim and is recorded
 *   as stated. 210 of 225 rows say `out_of_stock`, and many descriptions state
 *   a lead time in prose. A made-to-order cabin that takes five weeks is how
 *   the thing is sold, so the description is kept whole and nothing here reads
 *   a lead time out of it or contradicts the field beside it.
 * - `aw_deep_link` is a real issued tracking link, one per variant. Those are
 *   affiliate links and they say so.
 *
 * **One product per family, named for one configuration.** A family of 18 rows
 * is one page selling one sauna in eighteen configurations. Emitting eighteen
 * products would fill a comparison with near-identical rows; emitting one
 * unpriced product would throw away the prices the feed does carry. So the
 * lowest-priced variant is the product: its title, its price, its own deep
 * link, and a note saying how many configurations it was chosen from and what
 * the range is. The choice is editorial and it is written down.
 */

import { z } from "zod";
import { Currency } from "@/domain/money";
import { Brand, Merchant, Product, type ImageAsset, type MerchantOffer } from "@/domain/product";
import type { Source } from "@/domain/provenance";

export const ADVERTISER_ID = "125462";
export const FEED_ID = "F3219";
export const PUBLISHER_ID = "3090899";

/** Google product categories in this feed that name a sauna rather than a part of one. */
const SAUNA_CATEGORY = "Home & Garden > Pool & Spa > Saunas";

export type FeedRow = Record<string, string>;

export type Family = {
  /** The merchant's own product path, which is the grouping the feed does not state. */
  path: string;
  rows: FeedRow[];
  /** The row this family is represented by: the cheapest configuration. */
  chosen: FeedRow;
  minMinor: number;
  maxMinor: number;
  currency: string;
  categories: string[];
  imageCount: number;
  inStock: number;
};

export type FeedAudit = {
  rows: number;
  families: Family[];
  /** Columns with a value in at least one row. */
  populated: string[];
  /** Columns empty in every row. */
  empty: string[];
};

/** "5145.00 USD" and nothing looser. Minor units from the digits, never from a float. */
export function readFeedPrice(raw: string): { amountMinor: number; currency: string } | undefined {
  const m = /^(\d+)(?:\.(\d{1,2}))?\s+([A-Z]{3})$/.exec(raw.trim());
  if (!m) return undefined;
  const cents = (m[2] ?? "").padEnd(2, "0");
  const amountMinor = Number(m[1]) * 100 + Number(cents);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return undefined;
  return { amountMinor, currency: m[3] };
}

const productPath = (link: string): string => {
  try {
    return new URL(link).pathname;
  } catch {
    return "";
  }
};

export function auditFeed(rows: FeedRow[]): FeedAudit {
  const columns = Object.keys(rows[0] ?? {});
  const populated = columns.filter((c) => rows.some((r) => (r[c] ?? "").trim() !== ""));
  const byPath = new Map<string, FeedRow[]>();
  for (const r of rows) {
    const path = productPath(r.link ?? "");
    if (!path) continue;
    byPath.set(path, [...(byPath.get(path) ?? []), r]);
  }

  const families: Family[] = [];
  for (const [path, group] of byPath) {
    const priced = group.map((r) => ({ r, p: readFeedPrice(r.price ?? "") })).filter((x): x is { r: FeedRow; p: { amountMinor: number; currency: string } } => x.p !== undefined);
    if (priced.length === 0) continue;
    const cheapest = priced.reduce((a, b) => (b.p.amountMinor < a.p.amountMinor ? b : a));
    families.push({
      path,
      rows: group,
      chosen: cheapest.r,
      minMinor: Math.min(...priced.map((x) => x.p.amountMinor)),
      maxMinor: Math.max(...priced.map((x) => x.p.amountMinor)),
      currency: cheapest.p.currency,
      categories: [...new Set(group.map((r) => (r.google_product_category ?? "").trim()))],
      imageCount: new Set(group.map((r) => (r.image_link ?? "").trim())).size,
      inStock: group.filter((r) => (r.availability ?? "").trim() === "in_stock").length,
    });
  }
  families.sort((a, b) => b.rows.length - a.rows.length || a.path.localeCompare(b.path));
  return { rows: rows.length, families, populated, empty: columns.filter((c) => !populated.includes(c)) };
}

/** Only a family the feed itself classifies as a sauna. A blank category is not a yes. */
export const isSaunaFamily = (f: Family): boolean => f.categories.length === 1 && f.categories[0] === SAUNA_CATEGORY;

export type BuildOptions = {
  /** Product paths to build, chosen by a person. Nothing is imported wholesale. */
  paths: string[];
  readOn: string;
  feedFile: string;
  merchantId: string;
  categoryId: string;
};

export type BuildRefusal = { path: string; reasons: string[] };
export type BuildResult = { products: Product[]; brands: Brand[]; merchant: Merchant; refusals: BuildRefusal[] };

const idFor = (path: string): string => `sweat-kingdom-${path.replace(/^\/products\//, "")}`.replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/-$/, "");
const brandIdFor = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function feedSource(f: Family, o: BuildOptions, note: string): Source {
  return {
    kind: "merchant_feed",
    url: f.chosen.link,
    ref: `Awin advertiser ${ADVERTISER_ID}, feed ${FEED_ID}, downloaded ${o.readOn}: ${o.feedFile}`,
    retrievedAt: o.readOn,
    // The feed is the merchant publishing its own catalogue. It was read as it
    // arrived, not relayed by anybody.
    method: "direct",
    note,
  };
}

export function buildFromFeed(rows: FeedRow[], options: BuildOptions): BuildResult {
  const audit = auditFeed(rows);
  const byPath = new Map(audit.families.map((f) => [f.path, f]));
  const products: Product[] = [];
  const brands = new Map<string, Brand>();
  const refusals: BuildRefusal[] = [];

  const merchant = Merchant.parse({
    id: options.merchantId,
    slug: options.merchantId,
    name: "Sweat Kingdom",
    websiteUrl: "https://sweatkingdom.com",
    network: "awin",
    markets: ["US"],
  });

  for (const path of options.paths) {
    const family = byPath.get(path);
    if (!family) {
      refusals.push({ path, reasons: ["No family with this product path in the feed."] });
      continue;
    }
    const reasons: string[] = [];
    if (!isSaunaFamily(family)) {
      reasons.push(`The feed classifies this as ${family.categories.map((c) => c || "(blank)").join(", ")}, not as a sauna. A blank category is not a yes.`);
    }
    const price = readFeedPrice(family.chosen.price ?? "");
    if (!price) reasons.push(`"${family.chosen.price}" is not a price this reads.`);
    if (price && !Currency.safeParse(price.currency).success) {
      reasons.push(`${price.currency} is not a currency this catalogue stores. Converting it here would invent a rate and a date.`);
    }
    const image = (family.chosen.image_link ?? "").trim();
    if (!image) reasons.push("No image_link on the chosen row.");
    const deepLink = (family.chosen.aw_deep_link ?? "").trim();
    if (!deepLink.startsWith("https://www.awin1.com/")) reasons.push("No issued Awin tracking link on the chosen row.");
    if (reasons.length > 0 || !price) {
      refusals.push({ path, reasons });
      continue;
    }

    const id = idFor(path);
    const brandName = (family.chosen.brand ?? "").trim() || "Sweat Kingdom";
    const brandId = brandIdFor(brandName);
    const titleBrand = /^regen/i.test(family.chosen.title ?? "") ? "REGEN" : undefined;
    const configNote =
      family.rows.length === 1
        ? "One configuration in the feed."
        : `Chosen from ${family.rows.length} configurations of this product, ranging $${(family.minMinor / 100).toLocaleString("en-US")} to $${(family.maxMinor / 100).toLocaleString("en-US")}. The cheapest is the one represented, named as the feed names it, and its own tracking link is the link below.`;
    const brandNote =
      titleBrand && brandIdFor(titleBrand) !== brandId
        ? ` The feed's brand field says "${brandName}" and the title begins "${titleBrand}". Recorded from the structured field; the disagreement is the feed's.`
        : "";

    const offer: MerchantOffer = {
      id: `${id}-offer`,
      merchantId: merchant.id,
      market: "US",
      currency: "USD",
      priceMinor: price.amountMinor,
      // The link Awin issued for this exact variant. Not composed here.
      url: deepLink,
      affiliate: { status: "affiliate", network: "awin", programRef: `awin-advertiser-${ADVERTISER_ID}-publisher-${PUBLISHER_ID}` },
      discountCodes: [],
      // The merchant's own value, as stated. 210 of 225 rows say out_of_stock
      // while the prose beside them states a lead time; both are kept and
      // neither is resolved here.
      availability: (family.chosen.availability ?? "").trim() === "in_stock" ? "in_stock" : "out_of_stock",
      merchantSku: (family.chosen.mpn ?? "").trim() || undefined,
      lastChecked: options.readOn,
      source: feedSource(family, options, `${configNote}${brandNote}`),
    };

    const primary: ImageAsset = {
      id: `${id}-primary`,
      // The image came from an affiliate feed, which is what this kind means.
      kind: "affiliate_feed",
      role: "primary",
      src: image,
      alt: (family.chosen.title ?? "").split(" / ")[0],
      source: feedSource(
        family,
        options,
        "Supplied in the feed's image_link. No licence has been established: a feed carrying an image is not a grant to publish it, and the partner's image terms have not been read. The file name suggests a generated render rather than a photograph, which is the merchant's own file name and not a finding about the product.",
      ),
    };

    const parsed = Product.safeParse({
      id,
      slug: id,
      name: (family.chosen.title ?? "").trim(),
      brandId,
      categoryId: options.categoryId,
      // The merchant's own words, whole. Nothing is parsed out of them.
      description: (family.chosen.description ?? "").trim() || (family.chosen.title ?? "").trim(),
      status: "draft",
      availability: offer.availability,
      market: "US",
      images: [primary],
      offers: [offer],
      identifiers: { gtin: [], merchantSkus: { [merchant.id]: (family.chosen.id ?? "").trim() }, ...((family.chosen.mpn ?? "").trim() ? { mpn: family.chosen.mpn.trim() } : {}) },
      // None. The feed states no specification, and a title is not one.
      attributes: {},
      editorial: { strengths: [], tradeoffs: [] },
      source: feedSource(family, options, `${configNote}${brandNote}`),
      lastUpdated: options.readOn,
      flags: { demo: false, newArrival: false },
    });
    if (!parsed.success) {
      refusals.push({ path, reasons: parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`) });
      continue;
    }
    products.push(parsed.data);
    brands.set(brandId, Brand.parse({ id: brandId, slug: brandId, name: brandName, market: "US" }));
  }

  return { products, brands: [...brands.values()], merchant, refusals };
}

export const FeedRowSchema = z.record(z.string(), z.string());
