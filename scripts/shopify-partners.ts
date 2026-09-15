/**
 * The three approved partners that publish their own Shopify catalogue, and
 * the three with no catalogue to read.
 *
 * Every programme fact lives in `src/domain/affiliate/programmes.ts` and is
 * read from there: the rate, the referral link, the coupon, the referral
 * window, whatever the dashboard can generate, and any condition the partner's
 * terms place on using it. This file decides which of a store's products are
 * saunas. It does not restate an arrangement. Each profile says
 * which of that store's products are complete saunas and which are heaters,
 * stones, accessories, or something from another aisle entirely.
 *
 * **Every profile here is version 1 and unapproved, and that is deliberate.**
 * The inclusion rules are written against the structured fields a Shopify store
 * publishes, `product_type` and `tags`, but the exact words each store puts in
 * those fields are that store's own and have not been read yet: the addresses
 * are unreachable from the machine this was written on. So the rules are a
 * proposal, the tool shows the real counts and the real reasons the first time
 * a snapshot arrives, and a person approves them or fixes them before anything
 * imports. Nothing here asserts a count.
 *
 * What is asserted: no rule reads prose. `body_text` is on every row and no
 * profile maps a derivation onto it, because a merchant's marketing paragraph
 * is not a classification and a keyword hit in one is not inventory.
 */

import { affiliateStatusFor, needsComplianceReview, productLink, programmeFor, programmeNote, PROGRAMMES, type PartnerProgramme } from "@/domain/affiliate/programmes";
import { MappingProfile, PartnerSource } from "@/domain/ingestion/profile";

export type ShopifyPartner = { id: string; name: string; storeUrl: string };

/** The stores `npm run fetch:shopify` knows how to read. */
export const SHOPIFY_SOURCES: ShopifyPartner[] = [
  { id: "topture-shopify", name: "Topture", storeUrl: "https://topture.com" },
  { id: "select-saunas-shopify", name: "Select Saunas", storeUrl: "https://selectsaunas.com" },
  { id: "hooga-shopify", name: "Hooga Health", storeUrl: "https://hoogahealth.com" },
];

/**
 * The referral link each programme issued, kept in one place for a person to
 * copy out of.
 *
 * Every one of these is a link to a store's front door with an affiliate tag on
 * it, and not one is a link to a product. Whether a product address carrying
 * the same tag is tracked is a thing each programme decides, and three of these
 * programmes have a button in their dashboard that answers the question
 * properly. Until somebody presses it and records what comes back, a record
 * built from these sources links to the plain product address and says its
 * affiliate state is unresolved. Nothing composes a tracking parameter.
 *
 * The values are public by construction: a referral link exists to be put in
 * front of shoppers and its identifier is in the address bar of every referred
 * visit. `src/domain/affiliate/programmes.ts` holds the rest of each
 * programme's facts and the rule about what never gets written down.
 */
export const REFERRAL_BASES: Record<string, string> = Object.fromEntries(
  PROGRAMMES.filter((p) => p.referralLink !== undefined).map((p) => [p.partnerId, p.referralLink as string]),
);

/** The programme behind a source, or a loud failure: a source with no programme is a gap, not a default. */
function programme(id: string): PartnerProgramme {
  const found = programmeFor(id);
  if (!found) throw new Error(`No affiliate programme is recorded for ${id}. Add one to src/domain/affiliate/programmes.ts rather than leaving a source with no arrangement behind it.`);
  return found;
}

function shopifySource(opts: {
  id: string;
  name: string;
  merchantId: string;
  merchantName: string;
  merchantWebsite: string;
  idPrefix: string;
  defaultBrand: string;
  notes: string;
}): PartnerSource {
  const p = programme(opts.id);
  return PartnerSource.parse({
    id: opts.id,
    name: opts.name,
    format: "json",
    merchantId: opts.merchantId,
    merchantName: opts.merchantName,
    merchantWebsite: opts.merchantWebsite,
    categoryId: "saunas",
    // A shop. A specification in its catalogue is somebody's claim reaching us
    // through them.
    relationship: "retailer",
    priceCurrency: "USD",
    idPrefix: opts.idPrefix,
    defaultBrand: opts.defaultBrand,
    // Joined programmes, each with a dashboard somebody has now opened, and not
    // one with a verified way to link to an individual product. That is exactly
    // `affiliate_link_unresolved`: the arrangement is real and recorded, and
    // this link does not pay. It used to say `unknown`, which means nobody had
    // recorded the relationship at all, and that stopped being true the day the
    // logins were completed.
    affiliate: { status: affiliateStatusFor(p), network: p.network, programRef: p.programRef },
    allowQuoteOnly: false,
    // No `linkPrefix`. The rows carry the store's own product addresses, which
    // is what this links to; a prefix here would refuse every row for not being
    // an issued link that nobody has issued.
    notes: `${opts.notes} ${programmeNote(p)}`,
  });
}

export const TOPTURE = shopifySource({
  id: "topture-shopify",
  name: "Topture (GoAffPro, 2%)",
  merchantId: "topture-store",
  merchantName: "Topture",
  merchantWebsite: "https://topture.com",
  idPrefix: "topture",
  defaultBrand: "Topture",
  notes:
    "The dashboard offers a product-link generator and no file export, and the store publishes its own catalogue at /products.json. No product-level tracking parameter has been verified, so offers link to the store's own product address and say their affiliate state is unresolved.",
});

export const SELECT_SAUNAS = shopifySource({
  id: "select-saunas-shopify",
  name: "Select Saunas (UpPromote)",
  merchantId: "select-saunas",
  merchantName: "Select Saunas",
  merchantWebsite: "https://selectsaunas.com",
  idPrefix: "select-saunas",
  defaultBrand: "Select Saunas",
  notes:
    "Marketing Tools holds no files, and the store publishes its own catalogue at /products.json. The dashboard has \"Get product link\" and \"Get link with source\", so a per-product link is something a person can generate; what either button does to an address has not been read, and guessing at it is the one thing that would turn an honest gap into a false claim. Whatever the portal returns goes in this record when somebody runs it.",
});

export const HOOGA = shopifySource({
  id: "hooga-shopify",
  name: "Hooga Health (GoAffPro, 8%)",
  merchantId: "hooga-store",
  merchantName: "Hooga",
  merchantWebsite: "https://hoogahealth.com",
  idPrefix: "hooga",
  defaultBrand: "Hooga",
  notes:
    "Product-link generator in the dashboard, no file export, catalogue published at /products.json. Hooga is primarily a red-light brand; how much of its catalogue is a complete sauna is a question the first snapshot answers and this does not guess at.",
});

export const SHOPIFY_PARTNERS: PartnerSource[] = [TOPTURE, SELECT_SAUNAS, HOOGA];

/**
 * Approved partners with no catalogue to read, recorded as what each one is.
 *
 * "Blocked" here means blocked from ingestion, not blocked from the programme.
 * All three are approved and two have an active dashboard. What none of them
 * has is a machine-readable list of what they sell, and the reasons differ
 * enough to matter:
 *
 * - Lifepro refuses the requests that would show one, and going around a
 *   refusal is the thing this must not do.
 * - Therasage's portal has now been read end to end. There is no feed behind
 *   the login, which settles the question the earlier record left open, and its
 *   terms restrict where the link and the coupon may be placed.
 * - SAUNABOX approved with a rate and a code and sent no inventory at all.
 *
 * Each carries its programme's facts from `programmes.ts`, so the tool shows a
 * person the rate, the window, the coupon and any outstanding compliance
 * requirement beside the reason the catalogue is absent.
 */
export type BlockedState =
  /** The store refuses automated reading and has supplied no export. */
  | "blocked_pending_authorized_export"
  /** The portal has been reviewed by a person. It holds no bulk feed. */
  | "portal_review_complete_no_bulk_feed"
  /** Approved, with nothing resembling an inventory feed on offer. */
  | "approved_no_inventory_feed";

export type BlockedPartner = {
  id: string;
  name: string;
  state: BlockedState;
  why: string;
  /** Programme facts, copied at seed time so the record stands on its own. */
  programme?: {
    network: string;
    dashboard: string;
    commissionPercent?: number;
    referralWindowDays?: number;
    coupon?: string;
    trackingCode?: string;
    referralLink?: string;
    productLinks: string;
  };
  /** Requirements a person must clear before any link or code is placed. */
  compliance?: { id: string; requirement: string; statedIn: string; state: string }[];
  /** Set while anything in `compliance` is outstanding. Nothing publishes past it. */
  complianceReview?: "required" | "clear";
};

function blocked(id: string, state: BlockedState, why: string): BlockedPartner {
  const p = programme(id);
  return {
    id,
    name: p.merchantName,
    state,
    why,
    programme: {
      network: p.network,
      dashboard: p.dashboard,
      ...(p.commissionPercent !== undefined ? { commissionPercent: p.commissionPercent } : {}),
      ...(p.referralWindowDays !== undefined ? { referralWindowDays: p.referralWindowDays } : {}),
      ...(p.coupon ? { coupon: p.coupon } : {}),
      ...(p.trackingCode ? { trackingCode: p.trackingCode } : {}),
      ...(p.referralLink ? { referralLink: p.referralLink } : {}),
      productLinks: productLink(p, "https://example.invalid/product").ok ? "verified" : "no verified per-product link",
    },
    ...(p.compliance.length > 0 ? { compliance: p.compliance } : {}),
    complianceReview: needsComplianceReview(p) ? "required" : "clear",
  };
}

export const BLOCKED_PARTNERS: BlockedPartner[] = [
  blocked(
    "lifepro",
    "blocked_pending_authorized_export",
    "Approved. The structured catalogue and the sitemap both answer an automated request with 403. That is the store saying no to this kind of reading, and reading around it is not something this project does. It needs an export the partner supplies, or an address they authorise.",
  ),
  blocked(
    "therasage",
    "portal_review_complete_no_bulk_feed",
    "Approved, Refersion dashboard active, 10% with a 30-day referral window. A person has now been through the portal: it offers \"Create link to a specific page\" and no inventory feed and no export of any kind, so the question the earlier record left open is settled and the answer is that there is nothing to fetch. Therasage products reach this site only by somebody entering them. Its terms also restrict where the link and the coupon may be placed and require a disclosure, so the compliance review below has to be cleared before either is published anywhere.",
  ),
  blocked(
    "saunabox",
    "approved_no_inventory_feed",
    "Approved directly at 5% with tracking code MATT41058. The approval carried a link to finish setting up the account and no inventory feed, no export and no catalogue address. The setup link is a single-use key to this account, so it is not recorded here or anywhere in this repository. Nothing can be ingested until SAUNABOX supplies a feed or a person enters products by hand.",
  ),
];

/**
 * The rules that separate a sauna from the rest of a store's aisles.
 *
 * Structured fields only: the store's own `product_type` and its own `tags`.
 * Nothing reads the title and nothing reads the description. The words below
 * are the ones these stores are expected to use and have not been confirmed
 * against a snapshot, which is why every profile is unapproved: the tool counts
 * what each rule actually catches, shows the reasons beside the counts, and a
 * person approves or rewrites them.
 */
export function saunaExclusions(store: string) {
  // Most specific first. Exclusions stop at the first rule that matches, so the
  // order decides which reason a reviewer reads: a cold plunge caught by "this
  // store does not call it a sauna" is excluded correctly and explained badly.
  return [
    { column: "tags", op: "contains" as const, value: "cold plunge", reason: "A cold plunge belongs to another category of this site." },
    { column: "tags", op: "contains" as const, value: "red light", reason: "A red-light product belongs to another category of this site." },
    { column: "tags", op: "contains" as const, value: "sauna stones", reason: "Stones are a consumable, not a sauna." },
    { column: "product_type", op: "contains" as const, value: "heater", reason: "A heater is a part fitted inside a sauna, not a sauna." },
    { column: "product_type", op: "contains" as const, value: "accessor", reason: "An accessory is not a complete sauna." },
    { column: "product_type", op: "contains" as const, value: "part", reason: "A part is not a complete sauna." },
    { column: "product_type", op: "not_contains" as const, value: "sauna", reason: `${store} does not classify this as a sauna in its own product type.` },
    { column: "available", op: "empty" as const, reason: "The store states nothing about whether this variant can be bought." },
  ];
}

/** A first mapping for a Shopify store, in the shape every one of them publishes. */
export function shopifyProfile(source: PartnerSource, on: string, store: string): MappingProfile {
  return MappingProfile.parse({
    sourceId: source.id,
    version: 1,
    format: "json",
    createdOn: on,
    createdBy: "seed script",
    note: `First mapping of ${store}'s own Shopify catalogue. The inclusion rules name the words this store is expected to use in its structured fields and have not been checked against a snapshot; approve them only after reading the counts and reasons the tool shows.`,
    // A Shopify product is a model and its variants are the configurations it
    // is sold in, which is the grouping this pipeline already understands.
    grouping: { mode: "column", column: "product_handle", representative: "cheapest" },
    columns: [
      {
        target: "name",
        column: "product_title",
        ownership: "review_on_change",
        // The same shape of rule the Awin baseline uses: the model out of a
        // longer title, with the whole title kept on the record.
        extract: { pattern: "^(.*?)(?: [-–] |$)", flags: "", approved: false },
      },
      { target: "description", column: "body_text", ownership: "feed" },
      { target: "brand", column: "vendor", ownership: "review_on_change" },
      { target: "price", column: "price", ownership: "feed" },
      { target: "availability", column: "available", ownership: "feed", valueMap: { true: "in_stock", false: "out_of_stock" } },
      { target: "image", column: "image_src", ownership: "review_on_change" },
      // The store's own product address. No tracking parameter is composed onto
      // it, here or anywhere.
      { target: "link", column: "variant_url", ownership: "feed" },
      // The store's own code for its own variant. Not a manufacturer part
      // number: a Shopify catalogue publishes none, and putting a retailer's
      // SKU in `mpn` would make two retailers' codes for one product look like
      // two different parts, which is the one thing cross-partner matching
      // must not be told.
      { target: "merchant_sku", column: "variant_sku", ownership: "feed" },
    ],
    attributes: [
      {
        from: "extract",
        key: "capacity_max_people",
        column: "product_title",
        pattern: "(?:\\d+\\s*[-–]\\s*)?(\\d+)\\s*(?:Person|person)",
        flags: "",
        ownership: "review_on_change",
        approved: false,
      },
      {
        from: "extract",
        key: "sauna_style",
        column: "product_type",
        pattern: "(Barrel|Cabin|Pod|Box|Mobile)",
        flags: "i",
        valueMap: { Barrel: "barrel", barrel: "barrel", Cabin: "cabin", cabin: "cabin", Pod: "pod", pod: "pod", Box: "box", box: "box", Mobile: "mobile", mobile: "mobile" },
        ownership: "review_on_change",
        approved: false,
      },
    ],
    exclusions: saunaExclusions(store),
    families: [],
    proposedFilters: [],
  });
}
