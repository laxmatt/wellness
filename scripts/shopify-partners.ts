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
 * What is asserted: inclusion and exclusion never read prose. Select Saunas
 * additionally has reviewed, label-anchored specification rules for comparison
 * facts; those rules cannot make an item eligible for the catalogue.
 */

import { affiliateStatusFor, needsComplianceReview, productLink, programmeFor, programmeNote, verifiedTag, PROGRAMMES, type PartnerProgramme } from "@/domain/affiliate/programmes";
import { MappingProfile, PartnerSource } from "@/domain/ingestion/profile";
import { SAUNA_DESCRIPTION_RULES } from "@/domain/ingestion/sauna-description";

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
    // Joined programmes, each with a dashboard somebody has opened and a
    // transformation somebody has run and compared. The status and the tag both
    // come from the programme record: a source says its offers pay only when it
    // carries the parameter that makes them pay, and the schema refuses the
    // claim without it.
    affiliate: { status: affiliateStatusFor(p), network: p.network, programRef: p.programRef, ...(verifiedTag(p) ? { tag: verifiedTag(p) } : {}) },
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
 * The rules that separate a complete sauna from the rest of a store's aisles.
 *
 * Structured fields only, joined into `classified_as`: the store's own title,
 * its own product type and its own tags. Nothing reads `body_text`, here or
 * anywhere, because a merchant's marketing paragraph mentions saunas on the
 * page for a sauna cover.
 *
 * **Why the earlier version excluded nothing.** It leaned on `product_type
 * not_contains "sauna"`, which assumes a store files its non-saunas somewhere
 * else. Select Saunas does not: it is a sauna shop, so a rain jacket for a
 * barrel sauna, a floor kit and a bucket all sit under a sauna product type,
 * and every one of 737 records came through as a candidate. A store's own
 * classification is evidence of what aisle a thing is in and not evidence that
 * it is a sauna.
 *
 * So the shape is two-sided and both sides are literal.
 *
 * 1. **A blocklist of what a thing is.** Whole words, in the store's own
 *    classification: an accessory, a part, a heater, something from another
 *    category entirely. Word matching rather than substring, because a rule for
 *    the tiki bar written as a substring excludes every barrel sauna.
 * 2. **A requirement that something says sauna.** Last, so anything the
 *    blocklist did not name still has to be classified as a sauna by the store
 *    to survive. This is what catches the air tunnel, the tiki bar and the
 *    outdoor shower without anybody having listed them.
 *
 * Both sides are conservative in the same direction: they drop a real sauna
 * before they keep a bucket. A sauna wrongly excluded appears in the excluded
 * table with the rule that dropped it, where a reviewer sees it; a bucket
 * wrongly kept becomes a product page.
 */

/** One class of thing that is not a sauna, and every word a store calls it. */
type NotASauna = { reason: string; words: string[] };

const NOT_SAUNAS: NotASauna[] = [
  {
    reason: "A cold plunge belongs to another category of this site.",
    words: ["cold plunge", "cold plunges", "plunge", "plunges", "ice bath", "ice baths", "chiller", "chillers"],
  },
  {
    reason: "A hot tub or a spa belongs to another category of this site.",
    words: ["hot tub", "hot tubs", "tub", "tubs", "jacuzzi", "swim spa", "swim spas"],
  },
  {
    reason: "A shower is not a sauna.",
    words: ["shower", "showers", "showerhead"],
  },
  {
    reason: "A red-light product belongs to another category of this site.",
    words: ["red light", "light therapy", "led panel", "led panels"],
  },
  {
    reason: "This is a building or a piece of outdoor furniture, not a sauna.",
    words: ["tiki", "bar", "bars", "pergola", "pergolas", "gazebo", "gazebos", "bunkie", "bunkies", "cabana", "cabanas", "pavilion", "shed", "sheds", "bunk house", "playhouse", "greenhouse", "grill", "grills", "pizza oven", "fire pit", "fire pits", "furniture", "chair", "chairs", "lounger", "loungers"],
  },
  {
    reason: "Stones are a consumable, not a sauna.",
    words: ["stone", "stones", "rock", "rocks"],
  },
  {
    reason: "A heater is a part fitted inside a sauna, not a sauna.",
    words: ["heater", "heaters", "stove", "stoves", "steam generator", "steam generators", "generator", "boiler"],
  },
  {
    reason: "This is a part of a sauna, not a complete one.",
    // Deliberately missing: door, window, bench, roof, wall, band, handle. Each
    // is a part a store sells on its own and also a feature a complete sauna's
    // title brags about, and "Barrel Sauna with Glass Door" is a sauna. A word
    // that appears in both is not evidence, so it is not a rule.
    words: [
      "part", "parts", "spare", "spares", "replacement", "component", "components",
      "floor kit", "roof kit", "door kit", "vent kit", "trim kit", "lighting kit", "repair kit", "upgrade kit", "conversion kit",
      "backrest", "backrests", "headrest", "headrests", "flooring", "duckboard", "duckboards",
      "chimney", "chimneys", "flue", "flues", "vent", "vents", "air tunnel", "air tunnels", "duct", "ducts",
      "heat shield", "guard", "guards", "railing", "railings",
      "control", "controls", "controller", "controllers", "thermostat", "thermostats", "timer", "timers", "sensor", "sensors",
      "lighting", "light kit", "speaker", "speakers", "sound system", "harness", "cable", "cables", "hose", "hoses",
      "strap", "straps", "bracket", "brackets", "hinge", "hinges", "latch", "latches",
    ],
  },
  {
    reason: "An accessory is not a complete sauna.",
    words: [
      "accessory", "accessories", "kit and accessories",
      "bucket", "buckets", "ladle", "ladles", "thermometer", "thermometers", "hygrometer", "hygrometers", "sand timer",
      "pillow", "pillows", "mat", "mats", "towel", "towels", "robe", "robes",
      "jacket", "jackets", "cover", "covers", "blanket", "blankets", "cushion", "cushions", "brush", "brushes", "whisk", "whisks",
      "oil", "oils", "essential oil", "fragrance", "fragrances", "scent", "scents", "salt", "salts", "soap", "soaps",
      "cleaner", "cleaners", "sealant", "sealer", "stain", "wood treatment", "care kit", "starter kit",
      "gift card", "gift cards", "warranty", "shipping", "sample", "samples", "swatch", "swatches", "manual", "manuals",
    ],
  },
];

export function saunaExclusions(store: string) {
  // Most specific first. Exclusions stop at the first rule that matches, so the
  // order decides which reason a reviewer reads: a cold plunge caught by "this
  // store does not classify it as a sauna" is excluded correctly and explained
  // badly, and a badly explained exclusion is one nobody can check.
  const rules = NOT_SAUNAS.flatMap((klass) =>
    klass.words.map((value) => ({ column: "classified_as", op: "contains_word" as const, value, reason: klass.reason })),
  );
  return [
    ...rules,
    // Last, and the reason the list above does not have to be exhaustive. A row
    // the store itself does not file under saunas is not one of ours, whatever
    // it turns out to be.
    {
      column: "classified_as",
      op: "not_contains_word" as const,
      value: "sauna",
      reason: `${store} does not call this a sauna in its own title, product type or tags.`,
    },
    { column: "available", op: "empty" as const, reason: "The store states nothing about whether this variant can be bought." },
  ];
}

/**
 * A first mapping for a Shopify store, in the shape every one of them
 * publishes.
 *
 * Every column below exists on every Shopify snapshot, so this mapping is the
 * same for all three partners and nothing about it is guessed at per store.
 * The attribute rules are the part a person has to read: each one names a
 * column, a pattern, and the values it may produce, and every one arrives
 * unapproved so the tool shows what it actually extracted before anybody
 * agrees to it.
 */
export function shopifyProfile(source: PartnerSource, on: string, store: string): MappingProfile {
  return MappingProfile.parse({
    sourceId: source.id,
    version: 1,
    format: "json",
    createdOn: on,
    createdBy: "seed script",
    note: `First mapping of ${store}'s own Shopify catalogue. The inclusion rules read the store's own title, product type and tags and never its marketing prose; approve them only after reading the counts and the reasons the tool shows.`,
    // A Shopify product is a model and its variants are the configurations it
    // is sold in. Grouped on the store's own product address, which is the
    // store's own grouping rather than one this invented, and the variant query
    // is not part of a path so every configuration of one model lands together.
    grouping: { mode: "url_path", column: "product_url", representative: "cheapest" },
    columns: [
      {
        target: "name",
        column: "product_title",
        ownership: "review_on_change",
        // The same shape of rule the Awin baseline uses: the model out of a
        // longer title, with the whole title kept on the record.
        extract: { pattern: "^(.*?)(?: [-–] |$)", flags: "", approved: false },
      },
      // The store's own description, as text with the markup thrown away.
      { target: "description", column: "body_text", ownership: "feed" },
      { target: "brand", column: "vendor", ownership: "review_on_change" },
      { target: "price", column: "price", ownership: "feed" },
      { target: "availability", column: "available", ownership: "feed", valueMap: { true: "in_stock", false: "out_of_stock" } },
      { target: "image", column: "image_src", ownership: "review_on_change" },
      // The store's own product address. The affiliate parameter is added when
      // the offer is built, from the tag on the source, and never here.
      { target: "link", column: "variant_url", ownership: "feed" },
      // The store's own code for its own variant. Not a manufacturer part
      // number: a Shopify catalogue publishes none, and putting a retailer's
      // SKU in `mpn` would make two retailers' codes for one product look like
      // two different parts, which is the one thing cross-partner matching
      // must not be told.
      { target: "merchant_sku", column: "variant_sku", ownership: "feed" },
    ],
    // The filters a shopper narrows with, and nothing else.
    //
    // Eligibility and classification read `classified_as` or the title. The
    // Select Saunas adapter additionally reads explicitly labelled specification
    // blocks from preserved descriptions; optional prose is intentionally ignored.
    attributes: [
      {
        // "Far Infrared Sauna", "Traditional Barrel Sauna". The two words the
        // category already knows, and no third thing inferred from a heater.
        from: "extract",
        key: "sauna_type",
        column: "classified_as",
        pattern: "(far infrared|infrared|traditional)",
        flags: "i",
        valueMap: { "far infrared": "far_infrared", infrared: "far_infrared", traditional: "traditional" },
        ownership: "review_on_change",
        approved: false,
      },
      {
        // The maker's own words for how many it seats, kept as written.
        from: "extract",
        key: "capacity_label",
        column: "product_title",
        pattern: "(\\d+\\s*[-–]\\s*\\d+\\s*(?:person|people)|\\d+\\s*(?:person|people))",
        flags: "i",
        ownership: "review_on_change",
        approved: false,
      },
      {
        // The upper number of a range, which is what "seats up to" means.
        from: "extract",
        key: "capacity_max_people",
        column: "product_title",
        pattern: "(?:\\d+\\s*[-–]\\s*)?(\\d+)\\s*(?:Person|person|People|people)",
        flags: "",
        ownership: "review_on_change",
        approved: false,
      },
      {
        from: "extract",
        key: "sauna_style",
        column: "classified_as",
        pattern: "(Barrel|Cabin|Pod|Box|Mobile|Trailer)",
        flags: "i",
        valueMap: { barrel: "barrel", cabin: "cabin", pod: "pod", box: "box", mobile: "mobile", trailer: "mobile" },
        ownership: "review_on_change",
        approved: false,
      },
      {
        // Combined forms first: a store writing "Indoor/Outdoor" means both,
        // and an alternation that tried "outdoor" first would record one.
        from: "extract",
        key: "placement",
        column: "classified_as",
        pattern: "(indoor\\s*[/&]\\s*outdoor|indoor or outdoor|outdoor|indoor)",
        flags: "i",
        // Every spelling of the combined form the pattern can capture, because
        // "both" is a different answer from "outdoor" and guessing between them
        // is not this flow's to make.
        valueMap: { outdoor: "outdoor", indoor: "indoor", "indoor/outdoor": "indoor_outdoor", "indoor / outdoor": "indoor_outdoor", "indoor&outdoor": "indoor_outdoor", "indoor & outdoor": "indoor_outdoor", "indoor or outdoor": "indoor_outdoor" },
        ownership: "review_on_change",
        approved: false,
      },
      {
        // Only where the store says it. Most will not, and an empty cell is the
        // right answer when nobody stated one.
        from: "extract",
        key: "connection",
        column: "classified_as",
        pattern: "(plug\\s*-?\\s*in|hard\\s*-?\\s*wired|hardwired)",
        flags: "i",
        valueMap: { "plug in": "plug_in", "plug-in": "plug_in", plugin: "plug_in", hardwired: "hardwired", "hard wired": "hardwired", "hard-wired": "hardwired" },
        ownership: "review_on_change",
        approved: false,
      },
      ...(source.id === "select-saunas-shopify" ? [] : [{
        // 120 and 240 only. A store writing 110 or 220 is describing the same
        // supply loosely, and mapping one onto the other is a conversion this
        // has no business making.
        from: "extract",
        key: "voltage",
        column: "classified_as",
        pattern: "\\b(120|240)\\s*v\\b",
        flags: "i",
        valueMap: { "120": "120v", "240": "240v" },
        ownership: "review_on_change",
        approved: false,
      }]),
      ...(source.id === "select-saunas-shopify" ? SAUNA_DESCRIPTION_RULES : []),
    ],
    exclusions: saunaExclusions(store),
    families: [],
    proposedFilters: [],
  });
}
