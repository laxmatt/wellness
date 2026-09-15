/**
 * An approved reading, turned into catalogue records.
 *
 * An intake file is what somebody read on a page on a date, written down before
 * anything was built from it. This turns one into a `Product`, a `Brand` and a
 * `Merchant`, and it is deliberately dull: every value comes from the file, and
 * the only judgements encoded here are the ones about what may be *left out*.
 *
 * Four of those judgements, and they are the point of the module.
 *
 * **No price is not a price of zero.** A page that asks for a quote states no
 * amount. Such a record gets no offer at all, because an offer carries an
 * integer `priceMinor` and any integer there would be a number nobody quoted.
 * It gets a `referencePrice` entry with no value and `not_stated`, which is how
 * this catalogue already says "read, and it states nothing".
 *
 * **A link that earns nothing says so.** Three programmes are approved and one
 * has issued a link, to the site root, which is not the link below. So every
 * offer here is `non_affiliate`: that is what the URL is. The programme's own
 * reference is kept on the offer anyway, because holding a programme's identity
 * is not the same as a link being commissioned.
 *
 * **A retailer is not the maker.** Where a specification was read from a
 * seller's listing, the claim is still the maker's and the reading is not: the
 * value is `manufacturer_reported` with `source.kind: "retailer"`, which is the
 * distinction this catalogue already draws and renders as "Via retailer".
 *
 * **Two statements about stock are not one.** A page that says sold out and
 * also states a lead time has said two things. Availability is `unknown` and
 * both statements are kept in the note.
 */

import { z } from "zod";
import { AttributePrimitive, type AttributeValue } from "@/domain/attributes";
import { Currency } from "@/domain/money";
import { AffiliateNetwork, Brand, Id, Merchant, Product, Slug, type MerchantOffer } from "@/domain/product";
import type { Source } from "@/domain/provenance";

export const IntakeMerchant = z.object({
  id: Id,
  name: z.string().min(1),
  websiteUrl: z.url().optional(),
  network: AffiliateNetwork.optional(),
  /** The programme's own reference for this site. Identity, never a claim that this link pays. */
  programRef: z.string().min(1).optional(),
  /** A link the programme actually issued, recorded verbatim. Never composed here. */
  issuedLink: z.url().optional(),
  issuedLinkNote: z.string().min(1),
});

export const IntakeProduct = z.object({
  /** Stable across re-imports. The record's identity, not the seller's code. */
  key: Id,
  name: z.string().min(1),
  url: z.url(),
  /** Who was read. "manufacturer" is the maker's own domain; "retailer" is a seller's listing. */
  sourceKind: z.enum(["manufacturer", "retailer"]),
  brand: z.object({ id: Id, name: z.string().min(1), websiteUrl: z.url().optional() }),
  merchant: IntakeMerchant,
  /** null means the page states no amount. It never means zero. */
  price: z.object({ amountMinor: z.number().int().positive(), currency: Currency }).nullable(),
  priceNote: z.string().optional(),
  description: z.string().min(1),
  mpn: z.string().min(1).optional(),
  attributes: z.record(z.string(), AttributePrimitive),
  /** Fields the page was read for and does not state. Recorded as read, not as absent. */
  notStated: z.array(z.string()).default([]),
  /** Two claims about stock on one page. Availability stays unknown and this is why. */
  availabilityConflict: z.string().optional(),
  caveats: z.array(z.string()).default([]),
});
export type IntakeProduct = z.infer<typeof IntakeProduct>;

export const IntakeFile = z.object({
  categoryId: Id,
  readOn: z.iso.date(),
  readBy: z.string().min(1),
  approval: z.string().min(1),
  products: z.array(IntakeProduct).min(1),
});
export type IntakeFile = z.infer<typeof IntakeFile>;

export type CatalogRecords = { products: Product[]; brands: Brand[]; merchants: Merchant[] };
export type IntakeRefusal = { key: string; reasons: string[] };
export type IntakeResult = { records: CatalogRecords; refusals: IntakeRefusal[] };

function pageSource(p: IntakeProduct, file: IntakeFile, note?: string): Source {
  return {
    kind: p.sourceKind,
    url: p.url,
    ref: `Read by ${file.readBy.split(",")[0]} on ${file.readOn}`,
    retrievedAt: file.readOn,
    // Who was read, not whether a page was opened. A retailer's listing
    // relaying a maker's specification is the maker's claim reaching us at one
    // remove, however directly that listing was read, and this catalogue says
    // so with "secondhand". `catalog.test.ts` enforces it and caught the first
    // version of this file getting it wrong.
    method: p.sourceKind === "manufacturer" ? "direct" : "secondhand",
    note: [note, ...p.caveats].filter(Boolean).join(" ") || undefined,
  };
}

/**
 * What the programme is, on every record it touches.
 *
 * The issued link belongs on a quote-only record as much as on a priced one:
 * it is the only link anybody has for that programme, and a record with no
 * offer is exactly where somebody would otherwise go looking for it and find
 * nothing.
 */
function merchantNote(p: IntakeProduct): string {
  return [p.merchant.issuedLinkNote, p.merchant.issuedLink ? `Issued link, recorded and linked to from nowhere: ${p.merchant.issuedLink}` : undefined].filter(Boolean).join(" ");
}

/** The catalogue stores one currency. A reading in another is refused, never converted. */
const supportedCurrency = (code: string): boolean => Currency.safeParse(code).success;

function offerFor(p: IntakeProduct, file: IntakeFile): MerchantOffer | undefined {
  // A merchant that quotes on request still sells the thing, and a made-to-order
  // cabinet is the ordinary case rather than a defect. It gets an offer with no
  // amount, pointed at the one link that programme actually issued.
  //
  // That link is the referral link, so this one does earn, and it says so. It
  // addresses the merchant's site root rather than the product, because a deep
  // link has not been issued and none is composed here: the note on the record
  // says which it is.
  if (!p.price) {
    if (!p.merchant.issuedLink) return undefined;
    return {
      id: `${p.key}-offer`,
      merchantId: p.merchant.id,
      market: "US",
      currency: "USD",
      quoteOnly: true,
      url: p.merchant.issuedLink,
      affiliate: {
        status: "affiliate",
        ...(p.merchant.network ? { network: p.merchant.network } : {}),
        ...(p.merchant.programRef ? { programRef: p.merchant.programRef } : {}),
      },
      discountCodes: [],
      availability: "unknown",
      lastChecked: file.readOn,
      source: pageSource(p, file, [p.priceNote, merchantNote(p)].filter(Boolean).join(" ")),
    };
  }
  return {
    id: `${p.key}-offer`,
    merchantId: p.merchant.id,
    market: "US",
    currency: p.price.currency,
    priceMinor: p.price.amountMinor,
    url: p.url,
    // What this URL is, not what the programme is. No tracking parameter has
    // been issued for it, so a click on it pays nobody.
    affiliate: {
      status: "non_affiliate",
      ...(p.merchant.network ? { network: p.merchant.network } : {}),
      ...(p.merchant.programRef ? { programRef: p.merchant.programRef } : {}),
    },
    discountCodes: [],
    // Never claimed from a page that contradicts itself, and never assumed
    // from a page that says nothing.
    availability: "unknown",
    lastChecked: file.readOn,
    source: pageSource(p, file, [p.priceNote, p.availabilityConflict, merchantNote(p)].filter(Boolean).join(" ")),
  };
}

export function toCatalogRecords(file: IntakeFile): IntakeResult {
  const products: Product[] = [];
  const brands = new Map<string, Brand>();
  const merchants = new Map<string, Merchant>();
  const refusals: IntakeRefusal[] = [];
  const taken = new Map<string, string>();

  for (const p of file.products) {
    const reasons: string[] = [];
    if (p.price && !supportedCurrency(p.price.currency)) {
      reasons.push(`${p.price.currency} is not a currency this catalogue stores. Converting it here would invent a rate and a date.`);
    }
    if (!Slug.safeParse(p.key).success) reasons.push(`"${p.key}" is not usable as a slug.`);
    const clash = taken.get(p.key);
    if (clash) reasons.push(`Two records in this file claim the key "${p.key}".`);

    const attributes: Record<string, AttributeValue> = {};
    for (const [key, value] of Object.entries(p.attributes)) {
      attributes[key] = { value, source: pageSource(p, file), verification: "manufacturer_reported" };
    }
    for (const key of p.notStated) {
      if (attributes[key]) {
        reasons.push(`"${key}" is listed as not stated and also carries a value.`);
        continue;
      }
      // Read, and the page says nothing. Different from a field nobody looked
      // for, which is simply absent from the record.
      attributes[key] = {
        source: pageSource(p, file, `The page was read for this and states none.`),
        verification: "not_stated",
      };
    }

    const offer = offerFor(p, file);
    const parsed = Product.safeParse({
      id: p.key,
      slug: p.key,
      name: p.name,
      brandId: p.brand.id,
      categoryId: file.categoryId,
      description: p.description,
      // Never published by an import. A person reads the draft and decides.
      status: "draft",
      availability: "unknown",
      market: "US",
      // Empty on purpose. No brand has granted any right to reuse a photograph,
      // and a publicly visible image is not a licence.
      images: [],
      offers: offer ? [offer] : [],
      ...(offer
        ? {}
        : {
            referencePrice: {
              source: pageSource(p, file, [p.priceNote, merchantNote(p)].filter(Boolean).join(" ")),
              verification: "not_stated" as const,
            },
          }),
      identifiers: { gtin: [], merchantSkus: {}, ...(p.mpn ? { mpn: p.mpn } : {}) },
      attributes,
      editorial: { strengths: [], tradeoffs: [] },
      source: pageSource(p, file, `Approved for intake: ${file.approval}`),
      lastUpdated: file.readOn,
      flags: { demo: false, newArrival: false },
    });
    if (!parsed.success) reasons.push(...parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`));

    if (reasons.length > 0 || !parsed.success) {
      refusals.push({ key: p.key, reasons: reasons.length > 0 ? reasons : ["The record could not be built."] });
      continue;
    }
    taken.set(p.key, p.key);
    products.push(parsed.data);
    brands.set(p.brand.id, Brand.parse({ id: p.brand.id, slug: p.brand.id, name: p.brand.name, ...(p.brand.websiteUrl ? { websiteUrl: p.brand.websiteUrl } : {}), market: "US" }));
    merchants.set(
      p.merchant.id,
      Merchant.parse({
        id: p.merchant.id,
        slug: p.merchant.id,
        name: p.merchant.name,
        ...(p.merchant.websiteUrl ? { websiteUrl: p.merchant.websiteUrl } : {}),
        ...(p.merchant.network ? { network: p.merchant.network } : {}),
        markets: ["US"],
      }),
    );
  }

  return { records: { products, brands: [...brands.values()], merchants: [...merchants.values()] }, refusals };
}
