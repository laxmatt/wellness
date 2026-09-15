import { z } from "zod";
import { AttributeMap } from "./attributes";
import { Currency, Market, Money } from "./money";
import { Source, sourced } from "./provenance";

export const Slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const Id = z.string().regex(/^[a-z][a-z0-9_-]*$/);

export const ProductStatus = z.enum(["draft", "published", "hidden", "discontinued"]);
export type ProductStatus = z.infer<typeof ProductStatus>;

export const Availability = z.enum(["in_stock", "backorder", "preorder", "out_of_stock", "unknown", "discontinued"]);
export type Availability = z.infer<typeof Availability>;

/**
 * What an outbound link to a merchant is.
 *
 * `affiliate_link_unresolved` is the newest and the most specific: a programme
 * this site has joined, a store whose catalogue it reads, and no demonstrated
 * way to link to an individual product so that the programme credits it. Three
 * partners are in exactly that position. It is not `affiliate`, because nothing
 * shows the link pays; it is not `non_affiliate`, because that is a denial; and
 * it is not `unknown`, because plenty is known. Saying so is the difference
 * between an honest gap and an invented tracking parameter.
 */
export const AffiliateStatus = z.enum(["affiliate", "non_affiliate", "affiliate_link_unresolved", "unknown"]);
export type AffiliateStatus = z.infer<typeof AffiliateStatus>;

/**
 * The networks a merchant's programme actually runs on.
 *
 * Three Shopify-side programmes joined the list when three retailers approved
 * on them. `other` is still here for a network nobody has named, and `direct`
 * for an arrangement with no network in the middle at all.
 */
export const AffiliateNetwork = z.enum(["awin", "impact", "cj", "amazon", "goaffpro", "uppromote", "refersion", "direct", "other"]);
export type AffiliateNetwork = z.infer<typeof AffiliateNetwork>;

export const ImageKind = z.enum(["affiliate_feed", "approved_creative", "licensed_upload", "demo_placeholder"]);
export const ImageRole = z.enum(["primary", "card", "lifestyle", "gallery", "logo"]);

// src for demo_placeholder is "demo:<seed>" and is rendered procedurally.
export const ImageAsset = z.object({
  id: Id,
  kind: ImageKind,
  role: ImageRole,
  src: z.string().min(1),
  alt: z.string(),
  license: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  source: Source.optional(),
});
export type ImageAsset = z.infer<typeof ImageAsset>;

export const Brand = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  description: z.string().optional(),
  websiteUrl: z.url().optional(),
  images: z.array(ImageAsset).default([]),
  market: Market.default("US"),
});
export type Brand = z.infer<typeof Brand>;

export const Merchant = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  websiteUrl: z.url().optional(),
  network: AffiliateNetwork.optional(),
  markets: z.array(Market).default(["US"]),
});
export type Merchant = z.infer<typeof Merchant>;

export const DiscountCode = z.object({
  code: z.string().min(1),
  description: z.string(),
  expiresAt: z.iso.date().optional(),
  source: Source,
});
export type DiscountCode = z.infer<typeof DiscountCode>;

// Offers are first class. A product may have zero, one, or many.
// isAffiliate is never an input to ranking.
export const MerchantOffer = z.object({
  id: Id,
  merchantId: Id,
  market: Market,
  currency: Currency,
  // Absent when the merchant quotes no amount. A quote-only listing is a real
  // way to buy a real product, and the commonest thing sold that way is a
  // made-to-order cabinet: refusing to list one, or writing a zero so the
  // record parses, are both worse than saying what the page says. Exactly one
  // of `priceMinor` and `quoteOnly` is set, and the refine below enforces it.
  priceMinor: z.number().int().nonnegative().optional(),
  /** The merchant asks for a quote instead of listing a price. */
  quoteOnly: z.boolean().optional(),
  listPriceMinor: z.number().int().nonnegative().optional(),
  url: z.url(),
  affiliate: z.object({
    status: AffiliateStatus,
    network: AffiliateNetwork.optional(),
    programRef: z.string().optional(),
  }),
  discountCodes: z.array(DiscountCode).default([]),
  availability: Availability.default("unknown"),
  shippingNote: z.string().optional(),
  merchantSku: z.string().optional(),
  lastChecked: z.iso.date(),
  source: Source,
  // Set when the recorded amount cannot be shown to belong to this product.
  // The same word, and the same rule, as a disputed attribute value: the row
  // stays visible with its note, and nothing prices, ranks or counts on it.
  // Liquid I.V.'s Amazon row carried $27.99 whose own note said it was for a
  // variety pack, and that amount was the shown price of a 16-stick Lemon
  // Lime box. `check-catalog` refuses a disputed offer with no note.
  disputed: z.boolean().optional(),
}).refine((o) => (o.priceMinor !== undefined) !== (o.quoteOnly === true), {
  message: "An offer states an amount or says the merchant quotes one. Not both, and not neither.",
});
export type MerchantOffer = z.infer<typeof MerchantOffer>;

// Stable identifiers for automatic entity resolution against feeds.
export const ProductIdentifiers = z.object({
  gtin: z.array(z.string().regex(/^\d{8,14}$/)).default([]),
  mpn: z.string().optional(),
  asin: z.string().regex(/^[A-Z0-9]{10}$/).optional(),
  manufacturerSku: z.string().optional(),
  merchantSkus: z.record(Id, z.string()).default({}),
});
export type ProductIdentifiers = z.infer<typeof ProductIdentifiers>;

export const Dimensions = z.object({
  length: z.number().positive(),
  width: z.number().positive(),
  height: z.number().positive().optional(),
});
export type Dimensions = z.infer<typeof Dimensions>;

// Authored editorial. Optional. Claims of experience require a source.
export const EditorialNote = z.object({
  text: z.string().min(1),
  author: z.string(),
  date: z.iso.date(),
  source: Source.optional(),
  experiential: z.boolean().default(false),
}).refine((n) => !n.experiential || n.source !== undefined, {
  message: "Experiential claims require a source",
});
export type EditorialNote = z.infer<typeof EditorialNote>;

/**
 * A record that is a configuration of another record, not a model of its own.
 *
 * A merchant sometimes sells one product on two pages: the cabin, and the same
 * cabin in a blackout finish. Both pages are real, both carry their own price,
 * stock, pictures and link, and both have to be kept. Neither is a second thing
 * to compare against the first, and putting both in a comparison table asks a
 * shopper to choose between a product and its own paint.
 *
 * So the second record says which record it is a configuration of, and a
 * comparison groups on that. The membership is editorial: it is a person's
 * judgement about what a shopper is choosing between, it is written down with
 * the reason, and nothing infers it from a title. See `src/domain/family.ts`.
 *
 * One level only. The record named by `of` may not itself carry a `family`,
 * which is what makes a chain, and therefore a cycle, impossible rather than
 * merely unlikely. `validateCatalog` refuses both.
 */
export const FamilyMembership = z.object({
  /** The record this one is a configuration of. Never a group key invented for the purpose. */
  of: Id,
  /** Why, in a person's words. It is the whole of the evidence for this grouping. */
  because: z.string().min(1),
});
export type FamilyMembership = z.infer<typeof FamilyMembership>;

export const Product = z.object({
  id: Id,
  slug: Slug,
  name: z.string().min(1),
  brandId: Id,
  categoryId: Id,
  subcategoryId: Id.optional(),
  description: z.string(),
  status: ProductStatus,
  availability: Availability.default("unknown"),
  market: Market.default("US"),
  images: z.array(ImageAsset).default([]),
  offers: z.array(MerchantOffer).default([]),
  // Used when there are zero offers, or as a manufacturer list price anchor.
  referencePrice: sourced(Money).optional(),
  identifiers: ProductIdentifiers.default({ gtin: [], merchantSkus: {} }),
  warranty: sourced(z.string()).optional(),
  returnPolicy: sourced(z.string()).optional(),
  dimensions: sourced(Dimensions).optional(),
  weight: sourced(z.number().positive()).optional(),
  attributes: AttributeMap.default({}),
  /**
   * The partner's own title for the configuration this record was built from.
   *
   * Set when `name` is a shortened form of it. A retailer's title carries the
   * model and the configuration in one string, and a card showing the whole
   * thing reads as a warehouse label; a record that throws the rest away
   * cannot say which configuration it priced. So the short form is the name
   * and the whole of it is kept here, shown on the product page and quoted in
   * provenance.
   */
  sourceTitle: z.string().min(1).optional(),
  /** Set when this record is a configuration of another and is compared as part of it. */
  family: FamilyMembership.optional(),
  editorial: z.object({
    strengths: z.array(EditorialNote).default([]),
    tradeoffs: z.array(EditorialNote).default([]),
  }).default({ strengths: [], tradeoffs: [] }),
  source: Source,
  lastUpdated: z.iso.date(),
  flags: z.object({
    demo: z.boolean().default(false),
    newArrival: z.boolean().default(false),
  }).default({ demo: false, newArrival: false }),
}).refine((p) => p.offers.length > 0 || p.referencePrice !== undefined, {
  message: "Product needs at least one offer or a referencePrice",
});
export type Product = z.infer<typeof Product>;

export function deriveAffiliateStatus(offers: MerchantOffer[]): AffiliateStatus {
  if (offers.length === 0) return "unknown";
  if (offers.some((o) => o.affiliate.status === "affiliate")) return "affiliate";
  if (offers.every((o) => o.affiliate.status === "non_affiliate")) return "non_affiliate";
  if (offers.every((o) => o.affiliate.status === "affiliate_link_unresolved")) return "affiliate_link_unresolved";
  return "unknown";
}
