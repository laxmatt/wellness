/**
 * Fields to a catalogue record, and back.
 *
 * The flow keeps a record as a flat set of fields for as long as it can, so
 * that ownership and the three-way merge have something simple to reason
 * about. This is the pair of doors at either end: reading a stored record back
 * into fields, and assembling fields into a `Product` the catalogue will accept.
 *
 * Two things it refuses to fake.
 *
 * **Nothing claims a right to an image.** An image from a partner's feed is
 * recorded with no licence and a note saying so. A feed carrying a picture is
 * not permission to publish it, and the partner's image terms are a thing
 * somebody reads before publication rather than a thing this assumes.
 *
 * **The note says what this import actually did.** A record whose price came
 * from today's file and whose name was held back because an editor wrote it
 * says exactly that, field by field. Writing one note that called the whole
 * record a reading of the feed would be the easy lie: half of it would not be.
 */

import { tagUrl } from "@/domain/affiliate/tag";
import type { AttributeDefinition, AttributeMap, AttributePrimitive } from "@/domain/attributes";
import type { Derivation } from "@/domain/provenance";
import { Brand, Product, type ImageAsset, type MerchantOffer } from "@/domain/product";
import type { Source } from "@/domain/provenance";
import { ATTR_PREFIX } from "./build";
import type { FieldOutcome } from "./merge";
import type { PartnerSource } from "./profile";

export type RecordFields = Record<string, unknown>;

/** A stored record, read back into the same shape a file produces. */
export function fieldsFromProduct(product: Product, merchantId: string): { fields: RecordFields; notes: Record<string, string>; derivations: Record<string, Derivation> } {
  const offer = product.offers[0];
  const fields: RecordFields = {
    name: product.name,
    description: product.description,
    brand: product.brandId,
  };
  const notes: Record<string, string> = {};
  const derivations: Record<string, Derivation> = {};

  if (offer) {
    fields.link = offer.url;
    fields.availability = offer.availability;
    fields.price = offer.priceMinor !== undefined ? { minor: offer.priceMinor, currency: offer.currency } : { quoteOnly: true };
  }
  if (product.images[0]) fields.image = product.images[0].src;
  if (product.sourceTitle !== undefined) fields.source_title = product.sourceTitle;
  if (product.family) fields.family = product.family;
  const sku = product.identifiers.merchantSkus[merchantId];
  if (sku !== undefined) fields.merchant_sku = sku;
  if (product.identifiers.mpn !== undefined) fields.mpn = product.identifiers.mpn;

  for (const [key, value] of Object.entries(product.attributes)) {
    if (value.value === undefined) continue;
    fields[`${ATTR_PREFIX}${key}`] = value.value;
    if (value.source.note) notes[`${ATTR_PREFIX}${key}`] = value.source.note;
    if (value.derivation) derivations[`${ATTR_PREFIX}${key}`] = value.derivation;
  }
  return { fields, notes, derivations };
}

export type AssembleContext = {
  source: PartnerSource;
  profileVersion: number;
  fileName: string;
  readOn: string;
  groupNote: string;
  brandName: string;
  defs: Map<string, AttributeDefinition>;
};

export type Assembled = { ok: true; product: Product; brand: Brand } | { ok: false; reasons: string[] };

/**
 * What this import did to this record, in a sentence a reviewer can check
 * against the diff beside it.
 */
function outcomeNote(outcomes: FieldOutcome[]): string {
  const say = (kind: FieldOutcome["outcome"]): string[] => outcomes.filter((o) => o.outcome === kind).map((o) => o.label);
  const parts: string[] = [];
  const written = say("written");
  if (written.length > 0) parts.push(`Written by this import: ${written.join(", ")}.`);
  const editorial = say("held_editorial");
  if (editorial.length > 0) parts.push(`Held because this site owns ${editorial.length === 1 ? "it" : "them"}: ${editorial.join(", ")}.`);
  const local = say("held_local");
  if (local.length > 0) parts.push(`Held because somebody changed ${local.length === 1 ? "it" : "them"} here and the file has not moved since: ${local.join(", ")}.`);
  const conflict = say("conflict");
  if (conflict.length > 0) parts.push(`Left alone and queued as a conflict, because both the file and this site changed ${conflict.length === 1 ? "it" : "them"}: ${conflict.join(", ")}.`);
  const review = say("review");
  if (review.length > 0) parts.push(`Left alone and queued for review, because the file proposes a change to ${review.join(", ")}.`);
  return parts.join(" ");
}

const asString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

export function productFromFields(
  id: string,
  fields: RecordFields,
  notes: Record<string, string>,
  derivations: Record<string, Derivation>,
  outcomes: FieldOutcome[],
  ctx: AssembleContext,
): Assembled {
  const reasons: string[] = [];
  const name = asString(fields.name);
  const description = asString(fields.description);
  const link = asString(fields.link);
  const brandId = asString(fields.brand);
  if (!name) reasons.push("A record needs a name.");
  if (!description) reasons.push("A record needs a description. The partner's own words are kept whole; nothing is written in for them.");
  if (!link) reasons.push("A record needs the merchant's own link. Nothing invents one, and a missing one is not made up from a product name.");
  if (!brandId) reasons.push("A record needs a brand.");

  const price = fields.price as { minor: number; currency: string } | { quoteOnly: true } | undefined;
  if (!price) reasons.push("A record needs a price, or a statement that this merchant quotes rather than prices.");
  if (price && "currency" in price && price.currency !== "USD") {
    reasons.push(`${price.currency} is not a currency this catalogue stores. Converting it here would invent a rate and a date.`);
  }
  if (reasons.length > 0) return { ok: false, reasons };

  const base: Source = {
    kind: ctx.source.relationship === "manufacturer" ? "manufacturer" : "merchant_feed",
    url: link,
    ref: `${ctx.source.name}, ${ctx.source.format.toUpperCase()} uploaded ${ctx.readOn}: ${ctx.fileName}. Mapping profile ${ctx.source.id} v${ctx.profileVersion}.`,
    retrievedAt: ctx.readOn,
    // The file was read as it arrived. Whether a specification inside it is the
    // maker speaking is a different question and is answered per attribute.
    method: "direct",
  };
  const recordNote = [ctx.groupNote, outcomeNote(outcomes)].filter((s) => s !== "").join(" ");

  // The address a shopper clicks, and the only composition this flow performs.
  // A source with no verified tag gets the merchant's own address unchanged; a
  // source with one gets that address plus the parameter a person read in the
  // partner's dashboard, and `tagUrl` refuses anything whose origin is not the
  // merchant's. Provenance below keeps the plain address, because that is where
  // these facts were read, not where a shopper is sent.
  const tag = ctx.source.affiliate.tag;
  const tagged = tag ? tagUrl(link!, tag) : undefined;
  if (tagged && !tagged.ok) {
    return { ok: false, reasons: [`This row's link could not carry ${ctx.source.name}'s affiliate parameter. ${tagged.reason}`] };
  }

  const offer: MerchantOffer = {
    id: `${id}-offer`,
    merchantId: ctx.source.merchantId,
    market: "US",
    currency: "USD",
    ...(price && "minor" in price ? { priceMinor: price.minor } : { quoteOnly: true as const }),
    url: tagged?.ok ? tagged.url : link!,
    affiliate: {
      status: ctx.source.affiliate.status,
      ...(ctx.source.affiliate.network ? { network: ctx.source.affiliate.network } : {}),
      ...(ctx.source.affiliate.programRef ? { programRef: ctx.source.affiliate.programRef } : {}),
    },
    discountCodes: [],
    availability: (fields.availability as MerchantOffer["availability"]) ?? "unknown",
    ...(asString(fields.merchant_sku) ? { merchantSku: asString(fields.merchant_sku) } : {}),
    lastChecked: ctx.readOn,
    source: { ...base, note: [recordNote, notes.price, notes.availability].filter(Boolean).join(" ") || undefined },
  };

  const imageSrc = asString(fields.image);
  const images: ImageAsset[] = imageSrc
    ? [
        {
          id: `${id}-primary`,
          // What it is: a picture that arrived in a partner's feed.
          kind: "affiliate_feed",
          role: "primary",
          src: imageSrc,
          alt: name!,
          source: {
            ...base,
            note:
              "Supplied in this partner's feed, and the right to publish it is unresolved. No licence is recorded: a feed carrying an image is not a grant to publish it, nothing in the file says who owns the photograph or what an affiliate may do with it, and this partner's image terms have not been read. File names in these feeds commonly suggest generated renders rather than photographs, which is the merchant's own naming and not a finding about the product.",
          },
        },
      ]
    : [];

  const attributes: AttributeMap = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(ATTR_PREFIX)) continue;
    const attrKey = key.slice(ATTR_PREFIX.length);
    if (!ctx.defs.has(attrKey)) continue;
    attributes[attrKey] = {
      value: value as AttributePrimitive,
      verification: "manufacturer_reported",
      ...(derivations[key] ? { derivation: derivations[key] } : {}),
      source: {
        ...base,
        // A specification in a shop's feed is the maker's claim reaching us
        // through the shop. `catalog.test.ts` refuses any other reading of it.
        method: ctx.source.relationship === "manufacturer" ? "direct" : "secondhand",
        note: notes[key],
      },
    };
  }

  const parsed = Product.safeParse({
    id,
    slug: id,
    name,
    brandId,
    categoryId: ctx.source.categoryId,
    description,
    // Never anything else. Importing drafts, reviewing listings and publishing
    // are three decisions, and this is only the first of them.
    status: "draft",
    availability: offer.availability,
    market: "US",
    images,
    offers: [offer],
    ...(asString(fields.source_title) ? { sourceTitle: asString(fields.source_title) } : {}),
    identifiers: {
      gtin: [],
      merchantSkus: asString(fields.merchant_sku) ? { [ctx.source.merchantId]: asString(fields.merchant_sku)! } : {},
      ...(asString(fields.mpn) ? { mpn: asString(fields.mpn) } : {}),
    },
    attributes,
    // Editorial, and set by the approved mapping profile rather than read from
    // the file: this record is a configuration of another and is compared as
    // part of it. Everything else about it stays its own.
    ...(fields.family ? { family: fields.family } : {}),
    editorial: { strengths: [], tradeoffs: [] },
    source: { ...base, note: recordNote || undefined },
    lastUpdated: ctx.readOn,
    flags: { demo: false, newArrival: false },
  });
  if (!parsed.success) {
    return { ok: false, reasons: parsed.error.issues.map((i) => `${i.path.join(".") || "record"}: ${i.message}`) };
  }

  const brand = Brand.parse({ id: brandId, slug: brandId, name: ctx.brandName, market: "US" });
  return { ok: true, product: parsed.data, brand };
}
