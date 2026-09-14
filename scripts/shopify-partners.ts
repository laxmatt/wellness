/**
 * The three approved partners that publish their own Shopify catalogue, and
 * the two that cannot be read yet.
 *
 * Each source names the store, the referral base the programme issued, and what
 * is and is not known about linking to an individual product. Each profile says
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

import { MappingProfile, PartnerSource } from "@/domain/ingestion/profile";

export type ShopifyPartner = { id: string; name: string; storeUrl: string };

/** The stores `npm run fetch:shopify` knows how to read. */
export const SHOPIFY_SOURCES: ShopifyPartner[] = [
  { id: "topture-shopify", name: "Topture", storeUrl: "https://topture.com" },
  { id: "select-saunas-shopify", name: "Select Saunas", storeUrl: "https://selectsaunas.com" },
  { id: "hooga-shopify", name: "Hooga Health", storeUrl: "https://hoogahealth.com" },
];

/**
 * A referral link a programme issued, and what it is.
 *
 * Every one of these is a link to a store's front door with an affiliate tag on
 * it. None is a link to a product. Whether a product address carrying the same
 * tag is tracked is a thing each programme decides and none has been shown to
 * do it, so a record built from these sources links to the product and says its
 * affiliate state is unresolved. Nothing composes a tracking parameter onto a
 * product address.
 */
export const REFERRAL_BASES: Record<string, string> = {
  "topture-shopify": "https://topture.com/?ref=MATTORR",
  "hooga-shopify": "https://hoogahealth.com/?ref=MATTORR",
};

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
    // Approved programmes, and no product-level tracking has been shown to work
    // for any of them. `unknown` is what this catalogue already means by
    // "nobody has established what this link is", and the record says so rather
    // than claiming a commission it cannot demonstrate.
    affiliate: { status: "unknown" },
    allowQuoteOnly: false,
    notes: opts.notes,
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
    "GoAffPro, approved at 2%. The dashboard offers a product-link generator and no file export, and the store publishes its own catalogue at /products.json. Referral base issued by the programme: https://topture.com/?ref=MATTORR. No product-level tracking parameter has been shown to work, so offers are recorded with their affiliate state unresolved.",
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
    "UpPromote, approved. Marketing Tools holds no files, and the store publishes its own catalogue at /products.json. The programme's deep-link rule is not recorded here and no tracking parameter is composed: whatever UpPromote issues goes in this record when somebody reads it from the dashboard.",
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
    "GoAffPro, approved at 8%. Product-link generator in the dashboard, no file export, catalogue published at /products.json. Referral base issued by the programme: https://hoogahealth.com/?ref=MATTORR. Hooga is primarily a red-light brand; how much of its catalogue is a complete sauna is a question the first snapshot answers and this does not guess at.",
});

export const SHOPIFY_PARTNERS: PartnerSource[] = [TOPTURE, SELECT_SAUNAS, HOOGA];

/**
 * Partners that cannot be read, recorded as what they are.
 *
 * Neither is a failure to try. One answers automated requests with a refusal,
 * and going around that is the thing this must not do; the other is behind a
 * login and a CAPTCHA, and solving one of those is not something anybody should
 * automate. They sit here so the inventory says why they are absent.
 */
export type BlockedPartner = { id: string; name: string; state: "blocked_pending_authorized_export" | "blocked_pending_portal_review"; why: string };

export const BLOCKED_PARTNERS: BlockedPartner[] = [
  {
    id: "lifepro",
    name: "Lifepro",
    state: "blocked_pending_authorized_export",
    why: "Approved. The structured catalogue and the sitemap both answer an automated request with 403. That is the store saying no to this kind of reading, and reading around it is not something this project does. It needs an export the partner supplies, or an address they authorise.",
  },
  {
    id: "therasage",
    name: "Therasage",
    state: "blocked_pending_portal_review",
    why: "Approved. The Refersion portal needs a login and a CAPTCHA, and whether any feed exists behind it is unverified. A CAPTCHA is a person's job and this stops at it.",
  },
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
