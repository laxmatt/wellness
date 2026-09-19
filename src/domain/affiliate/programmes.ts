/**
 * Every affiliate programme this site has joined, what each one issued, and
 * what none of them has yet shown how to do.
 *
 * Six partners, five programmes and one refusal. The interesting part is not
 * the list: it is the shape of `ProductLinkRoute`. A route a portal can
 * generate carries the *name of the tool* and nothing else. There is no
 * template on it, no base to append to, no parameter to copy, so no code here
 * or anywhere downstream can build a product link out of one. Only a `verified`
 * route carries a template, only a person who has run a real link through a
 * real dashboard and watched the click register sets one, and today not one
 * route is verified.
 *
 * That is deliberate. "Get product link" existing in a dashboard means a person
 * can produce a link. Guessing at the transformation behind that button means
 * publishing links that earn nothing and look like they earn something, and the
 * difference is invisible until a payout does not arrive.
 *
 * What is recorded here is public by construction: a referral link is the thing
 * a programme issues to be put in front of shoppers, and its identifier travels
 * in every click. No login, no session, no cookie, no password and no
 * single-use account link is recorded, and `RECORDING_RULES` says so where the
 * next person to add a partner will read it.
 */

import type { AffiliateNetwork, AffiliateStatus } from "@/domain/product";
import { tagUrl, type AffiliateTag } from "./tag";

/**
 * How a link to one product gets made, if it can be made at all.
 *
 * Three kinds, and the gap between the second and the third is the whole point.
 */
export type ProductLinkRoute =
  /** Nothing in the programme produces a per-product link. */
  | { kind: "none"; why: string }
  /**
   * The dashboard has a tool that makes one, and what that tool does to an
   * address is unverified. Deliberately carries no pattern: a route nobody has
   * checked must not be capable of producing a link by accident.
   */
  | { kind: "portal_tool"; tools: string[]; why: string }
  /**
   * Awin's public redirector, verified by following a real generated URL to
   * the intended product on the advertiser's own storefront.
   */
  | { kind: "awin_redirect"; advertiserId: string; publisherId: string; destinationOrigin: string; verifiedOn: string; verifiedBy: string }
  /**
   * Somebody generated a real link in the portal, compared it against the plain
   * product address it came from, and recorded the difference.
   *
   * The difference, in all three cases, is one query parameter. Recorded as a
   * parameter and an origin rather than a template with a slot in it: a
   * template that takes an address is the shape of a redirector, and this is
   * not one. `tag.ts` decides what may be tagged.
   */
  | { kind: "verified"; tag: AffiliateTag };

/**
 * A condition a partner's terms place on using their links, and whether
 * anybody has met it.
 *
 * An outstanding requirement is not a warning. It is a partner's own rule about
 * where a link or a code may appear, unmet, and publishing against it breaks
 * the agreement that makes the link worth having.
 */
export type ComplianceRequirement = {
  id: string;
  requirement: string;
  /** Where the rule comes from, so somebody can go and read it. */
  statedIn: string;
  state: "outstanding" | "satisfied";
};

export type PartnerProgramme = {
  partnerId: string;
  merchantName: string;
  network: AffiliateNetwork;
  /** Joined and active, or joined with the catalogue still out of reach. */
  dashboard: "active" | "not_reviewed";
  /**
   * The programme's own identifier for this account, as it travels in a public
   * link. Not a credential: every shopper who clicks one sees it.
   */
  programRef?: string;
  /** The store-front link the programme issued, whole and unmodified. */
  referralLink?: string;
  /** A code the programme issued for use in a link or at a checkout. */
  trackingCode?: string;
  /** A discount code the programme issued, where one exists. */
  coupon?: string;
  commissionPercent?: number;
  /** How long after a click the programme says it still credits a sale. */
  referralWindowDays?: number;
  productLinks: ProductLinkRoute;
  /** Whether a catalogue exists to read, and in what form. */
  inventory:
    | { kind: "shopify_json"; url: string }
    | { kind: "woocommerce_store_api"; url: string }
    | { kind: "none"; why: string };
  compliance: ComplianceRequirement[];
  /** When a person last read this partner's dashboard and wrote these facts down. */
  verifiedOn: string;
  notes: string;
};

/**
 * What goes in this file and what never does.
 *
 * Stated as data so a test can hold the file to it rather than a reviewer
 * having to remember.
 */
export const RECORDING_RULES = {
  recorded: "Referral links, programme identifiers, tracking codes, coupons, commission rates and referral windows. All of these are published to shoppers by design.",
  neverRecorded:
    "Usernames, passwords, session cookies, bearer tokens, API keys, one-time account links and anything else that would let a reader act as this account. A programme's complete-signup link is one of those: it is a single-use key to an account, not a share link.",
  /**
   * Patterns no *value* may match.
   *
   * Values, not prose. A note explaining that a portal needs a login is a
   * useful sentence and refusing it would teach the next person to write worse
   * notes; a referral link with `session` in its query string is a mistake. So
   * this runs over the fields that carry identifiers and addresses and never
   * over the fields that carry sentences.
   */
  forbidden: [/password/i, /session/i, /cookie/i, /bearer/i, /api[_-]?key/i, /secret/i, /token/i, /complete[_-]?signup/i, /magic[_-]?link/i, /\blogin\b/i, /activate/i],
  /** The fields checked against `forbidden`. Everything else on a programme is prose. */
  valueFields: ["programRef", "referralLink", "trackingCode", "coupon"] as const,
} as const;

/**
 * Which of a programme's recorded values look like something that should never
 * have been written down.
 *
 * Empty for every programme here, and the point is the next one: a person
 * copying out of a dashboard pastes the wrong thing eventually, and a
 * one-time account link in a repository is not a mistake anybody notices by
 * reading.
 */
export function secretsIn(programme: PartnerProgramme): { field: string; matched: string }[] {
  const found: { field: string; matched: string }[] = [];
  for (const field of RECORDING_RULES.valueFields) {
    const value = programme[field];
    if (typeof value !== "string") continue;
    for (const pattern of RECORDING_RULES.forbidden) {
      const hit = pattern.exec(value);
      if (hit) found.push({ field, matched: hit[0] });
    }
  }
  return found;
}

export const PROGRAMMES: PartnerProgramme[] = [
  {
    partnerId: "sunlighten-shopify",
    merchantName: "Sunlighten",
    network: "awin",
    dashboard: "active",
    programRef: "awin-advertiser-63394-publisher-3090899",
    referralLink: "https://www.awin1.com/cread.php?awinmid=63394&awinaffid=3090899",
    productLinks: {
      kind: "awin_redirect",
      advertiserId: "63394",
      publisherId: "3090899",
      destinationOrigin: "https://shop-us.sunlighten.com",
      verifiedOn: "2026-09-19",
      verifiedBy: "Codex, by following the Awin redirect through to a real Sunlighten product",
    },
    inventory: { kind: "shopify_json", url: "https://shop-us.sunlighten.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-19",
    notes: "Awin membership active for advertiser 63394. The official US Shopify catalogue is available; import consolidates finish duplicates and excludes packages, accessories and red-light devices.",
  },
  {
    partnerId: "sweattent-shopify",
    merchantName: "SweatTent",
    network: "refersion",
    dashboard: "active",
    programRef: "9327296.77dd76",
    referralLink: "https://sweattent.com/?rfsn=9327296.77dd76",
    productLinks: {
      kind: "portal_tool",
      tools: ["Refersion affiliate dashboard"],
      why: "The approval email verifies the storefront tracking link, but no product-level transformation has been verified. Published offers therefore use the exact issued storefront link.",
    },
    inventory: { kind: "shopify_json", url: "https://sweattent.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-19",
    notes: "Refersion approval email verified the issued tracking link. The official public Shopify catalogue is available; sauna import keeps the canonical complete sauna and excludes duplicated bundles and accessories.",
  },
  {
    partnerId: "frostonic-shopify",
    merchantName: "FROSTONIC",
    network: "goaffpro",
    dashboard: "active",
    programRef: "MATT",
    referralLink: "https://frostonic.com/?ref=MATT",
    productLinks: {
      kind: "verified",
      tag: {
        param: "ref",
        value: "MATT",
        origin: "https://frostonic.com",
        verifiedOn: "2026-09-19",
        verifiedBy: "Codex, in the programme's own GoAffPro product-link generator",
      },
    },
    inventory: { kind: "shopify_json", url: "https://frostonic.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-19",
    notes: "GoAffPro dashboard active. Its product-link generator verified ?ref=MATT on a product URL. The official public Shopify catalogue is available; cold-plunge import excludes accessories, standalone chillers and sauna products.",
  },
  {
    partnerId: "sweaty-yeti-woocommerce",
    merchantName: "Sweaty Yeti Sauna",
    network: "other",
    dashboard: "active",
    programRef: "126",
    referralLink: "https://sweatyyetisauna.com/?sld=126",
    coupon: "wellnessfitcheck5",
    referralWindowDays: 30,
    productLinks: {
      kind: "verified",
      tag: {
        param: "sld",
        value: "126",
        origin: "https://sweatyyetisauna.com",
        verifiedOn: "2026-09-18",
        verifiedBy: "Codex, in the programme's own Solid Affiliate dashboard",
      },
    },
    inventory: {
      kind: "woocommerce_store_api",
      url: "https://sweatyyetisauna.com/wp-json/wc/store/v1/products?per_page=100",
    },
    compliance: [],
    verifiedOn: "2026-09-18",
    notes:
      "Solid Affiliate dashboard active. The portal explicitly says to add ?sld=126 to any page URL. The official public WooCommerce Store API currently exposes eight product pages; sauna publishing excludes the two products that do not contain a sauna.",
  },
  {
    partnerId: "topture-shopify",
    merchantName: "Topture",
    network: "goaffpro",
    dashboard: "active",
    programRef: "MATTORR",
    referralLink: "https://topture.com/?ref=MATTORR",
    commissionPercent: 2,
    // Verified: https://topture.com/products/thermasol-vue-sauna-cabin became
    // the same address with ?ref=MATTORR on it. Nothing else changed.
    productLinks: { kind: "verified", tag: { param: "ref", value: "MATTORR", origin: "https://topture.com", verifiedOn: "2026-09-15", verifiedBy: "Matt, in the programme's own dashboard" } },
    inventory: { kind: "shopify_json", url: "https://topture.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-14",
    notes: "GoAffPro. The dashboard offers a product-link generator and no file export; the store publishes its own catalogue.",
  },
  {
    partnerId: "select-saunas-shopify",
    merchantName: "Select Saunas",
    network: "uppromote",
    dashboard: "active",
    // UpPromote issues one identifier per affiliate and carries it in the
    // link's `sca_ref`. Public: it is in the address bar of every referred visit.
    programRef: "12323351.NbtdIcjAoO",
    referralLink: "https://selectsaunas.com?sca_ref=12323351.NbtdIcjAoO",
    // Verified through "Get product link":
    // https://selectsaunas.com/products/dynamic-saunas-dyn-6106-01-barcelona-1-2-person-low-emf-far-infrared-sauna
    // became the same address with ?sca_ref=12323351.NbtdIcjAoO on it. The same
    // identifier the store-front referral link carries, on the product's own
    // address, which is why this is a parameter and not a redirect.
    productLinks: { kind: "verified", tag: { param: "sca_ref", value: "12323351.NbtdIcjAoO", origin: "https://selectsaunas.com", verifiedOn: "2026-09-15", verifiedBy: "Matt, in the programme's own dashboard" } },
    inventory: { kind: "shopify_json", url: "https://selectsaunas.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-15",
    notes:
      "UpPromote, dashboard active. Marketing Tools holds no files. Product-level links are generatable through the portal's own tool, so this is a job for a person with the dashboard open, not a transformation to guess at. The commission rate is not stated in this record because nobody has read it.",
  },
  {
    partnerId: "saunakits-shopify",
    merchantName: "SaunaKits.com",
    network: "uppromote",
    dashboard: "active",
    programRef: "12323721.J7K7UndolP",
    referralLink: "https://saunakits.com?sca_ref=12323721.J7K7UndolP",
    // Verified in UpPromote's "Get product link" tool on 2026-09-17:
    // https://saunakits.com/products/saunalife-4-person-cube-series-outdoor-home-sauna-kit-cl5g
    // became the same product address with ?sca_ref=12323721.J7K7UndolP.
    productLinks: {
      kind: "verified",
      tag: {
        param: "sca_ref",
        value: "12323721.J7K7UndolP",
        origin: "https://saunakits.com",
        verifiedOn: "2026-09-17",
        verifiedBy: "Matt, relayed through Codex after using the programme's own dashboard",
      },
    },
    inventory: { kind: "shopify_json", url: "https://saunakits.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-17",
    notes:
      "UpPromote dashboard active. Marketing Tools holds no files. The merchant publishes its official public Shopify catalogue, and the programme's own product-link tool verified the tracking parameter used on direct product links.",
  },
  {
    partnerId: "hooga-shopify",
    merchantName: "Hooga",
    network: "goaffpro",
    dashboard: "active",
    programRef: "MATTORR",
    referralLink: "https://hoogahealth.com/?ref=MATTORR",
    commissionPercent: 8,
    // Verified: https://hoogahealth.com/products/sauna-series-floor-stand became
    // the same address with ?ref=MATTORR on it.
    productLinks: { kind: "verified", tag: { param: "ref", value: "MATTORR", origin: "https://hoogahealth.com", verifiedOn: "2026-09-15", verifiedBy: "Matt, in the programme's own dashboard" } },
    inventory: { kind: "shopify_json", url: "https://hoogahealth.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-14",
    notes: "GoAffPro. Primarily a red-light brand; how much of its catalogue is a complete sauna is a question the first snapshot answers.",
  },
  {
    partnerId: "therasage",
    merchantName: "Therasage",
    network: "refersion",
    dashboard: "active",
    programRef: "9327338.019740",
    referralLink:
      "https://therasage.com/discount/WELLNESSFITCHECK?rfsn=9327338.019740&utm_source=refersion&utm_medium=affiliate&utm_campaign=9327338.019740",
    coupon: "WELLNESSFITCHECK",
    commissionPercent: 10,
    referralWindowDays: 30,
    productLinks: {
      kind: "portal_tool",
      tools: ["Create link to a specific page"],
      // The one attempt to use it ended with the portal logging itself out
      // part-way through, so no link came back and nothing is recorded. The
      // terms make finishing it pointless anyway: see the requirements below.
      why: "The portal logged out during custom-link generation, so no link was produced and no transformation was read. Even a verified one would stay unusable while the requirements below stand.",
    },
    inventory: {
      kind: "none",
      why: "The Refersion portal has been reviewed and holds no inventory feed and no export. There is nothing to fetch, so Therasage products reach this site only by somebody entering them.",
    },
    compliance: [
      {
        id: "therasage-disclosure",
        requirement: "Every placement of the link or the coupon must carry an affiliate disclosure a reader sees before they click.",
        statedIn: "Therasage affiliate terms, read in the Refersion portal on 2026-09-15.",
        state: "outstanding",
      },
      {
        id: "therasage-placement",
        // Read in full now, and the answer is no. This site is a website.
        requirement:
          "The terms say the code is solely for social profiles and not for websites without express written permission. This site is a website and holds no such permission, so the link and the coupon go nowhere on it. Only written permission from Therasage clears this, not a verified link and not a disclosure.",
        statedIn: "Therasage affiliate terms, read in the Refersion portal on 2026-09-15.",
        state: "outstanding",
      },
    ],
    verifiedOn: "2026-09-15",
    notes:
      "Refersion, dashboard active, 10% with a 30-day referral window. The referral link carries a coupon, which makes it a marketing placement as well as a link, and the terms confine both to social profiles. Nothing of Therasage's is published on this site, and a verified product link would not change that: the blocker is permission, not mechanics.",
  },
  {
    partnerId: "saunabox",
    merchantName: "SAUNABOX",
    network: "direct",
    dashboard: "active",
    programRef: "80182564",
    referralLink: "https://www.saunabox.com/MATT41058",
    trackingCode: "MATT41058",
    commissionPercent: 5,
    productLinks: {
      kind: "none",
      why: "Social Snowball issued one storefront referral URL and no verified product-level transformation. Offers use the exact issued storefront URL.",
    },
    inventory: {
      kind: "shopify_json",
      url: "https://www.saunabox.com/products.json",
    },
    compliance: [],
    verifiedOn: "2026-09-15",
    notes:
      "Social Snowball partnership 80182564: 5% customer discount and 5% commission. The dashboard has no feed/export or product-link builder; inventory comes from SAUNABOX's official public Shopify storefront. The prior single-use setup link remains deliberately unrecorded.",
  },
  {
    partnerId: "lifepro",
    merchantName: "Lifepro",
    network: "other",
    dashboard: "not_reviewed",
    productLinks: { kind: "none", why: "Nothing about linking has been read, because the store refuses the requests that would show it." },
    inventory: {
      kind: "none",
      why: "The structured catalogue and the sitemap both answer an automated request with 403. That is the store saying no to this kind of reading, and reading around it is not something this project does.",
    },
    compliance: [],
    verifiedOn: "2026-09-14",
    notes: "Approved. Needs an export the partner supplies, or an address they authorise.",
  },
];

export const programmeFor = (partnerId: string): PartnerProgramme | undefined => PROGRAMMES.find((p) => p.partnerId === partnerId);

/**
 * What a link to this partner's product is, in the catalogue's own words.
 *
 * A joined programme with no verified way to link to a product is not
 * `unknown`: `unknown` is what the catalogue says when nobody has recorded the
 * relationship, and here somebody has. It is `affiliate_link_unresolved`, which
 * says the arrangement exists and this particular link does not pay.
 */
export function affiliateStatusFor(programme: PartnerProgramme | undefined): AffiliateStatus {
  if (!programme) return "unknown";
  if (["verified", "awin_redirect"].includes(programme.productLinks.kind) && !needsComplianceReview(programme)) return "affiliate";
  return "affiliate_link_unresolved";
}

/** Requirements a partner's terms impose that nobody has met yet. */
export const outstandingCompliance = (programme: PartnerProgramme): ComplianceRequirement[] => programme.compliance.filter((c) => c.state === "outstanding");

/** Whether a person has to clear something before this partner's link may be used at all. */
export const needsComplianceReview = (programme: PartnerProgramme): boolean => outstandingCompliance(programme).length > 0;

/**
 * The one place a product link would be built, and the only place that gets to
 * decide it cannot be.
 *
 * Every caller gets a reason rather than a guess. When a route is verified and
 * the terms are clear, this composes from the recorded template and nothing
 * else; `{url}` is the product address and no other substitution exists.
 */
export function productLink(programme: PartnerProgramme | undefined, productUrl: string): { ok: true; url: string } | { ok: false; reason: string } {
  if (!programme) return { ok: false, reason: "No programme is recorded for this partner, so there is nothing to link through." };
  const route = programme.productLinks;
  if (route.kind === "none") return { ok: false, reason: `${programme.merchantName}: ${route.why}` };
  if (route.kind === "portal_tool") {
    return { ok: false, reason: `${programme.merchantName}: ${route.tools.join(" / ")} in the dashboard. ${route.why}` };
  }
  // A verified transformation is still not permission. A partner whose terms
  // restrict where its link may go is refused here, which is the only place
  // that matters, rather than depended on to be refused by whoever calls this.
  const outstanding = outstandingCompliance(programme);
  if (outstanding.length > 0) {
    return { ok: false, reason: `${programme.merchantName}: ${outstanding.length} compliance requirement(s) outstanding. ${outstanding.map((c) => c.requirement).join(" ")}` };
  }
  if (route.kind === "awin_redirect") {
    let destination: URL;
    try {
      destination = new URL(productUrl);
    } catch {
      return { ok: false, reason: `${programme.merchantName}: product URL is invalid.` };
    }
    if (destination.origin !== route.destinationOrigin) {
      return { ok: false, reason: `${programme.merchantName}: ${destination.origin} is not the verified destination origin ${route.destinationOrigin}.` };
    }
    const link = new URL("https://www.awin1.com/cread.php");
    link.searchParams.set("awinmid", route.advertiserId);
    link.searchParams.set("awinaffid", route.publisherId);
    link.searchParams.set("ued", destination.toString());
    return { ok: true, url: link.toString() };
  }
  const tagged = tagUrl(productUrl, route.tag);
  if (!tagged.ok) return { ok: false, reason: `${programme.merchantName}: ${tagged.reason}` };
  return tagged;
}

/** The tag a partner's links carry, for a source record to store beside its status. */
export function verifiedTag(programme: PartnerProgramme | undefined): AffiliateTag | undefined {
  if (!programme || programme.productLinks.kind !== "verified" || needsComplianceReview(programme)) return undefined;
  return programme.productLinks.tag;
}

/** A partner's programme facts as one line, for a source record's notes. */
export function programmeNote(programme: PartnerProgramme): string {
  const bits: string[] = [`${programme.network}, dashboard ${programme.dashboard === "active" ? "active" : "not reviewed"}`];
  if (programme.commissionPercent !== undefined) bits.push(`${programme.commissionPercent}%`);
  if (programme.referralWindowDays !== undefined) bits.push(`${programme.referralWindowDays}-day referral window`);
  if (programme.coupon) bits.push(`coupon ${programme.coupon}`);
  if (programme.trackingCode) bits.push(`tracking code ${programme.trackingCode}`);
  bits.push(
    programme.productLinks.kind === "verified"
      ? `product links verified on ${programme.productLinks.tag.verifiedOn}, ${programme.productLinks.tag.param}`
      : programme.productLinks.kind === "awin_redirect"
        ? `Awin product redirects verified on ${programme.productLinks.verifiedOn}`
      : "no verified product link",
  );
  const outstanding = outstandingCompliance(programme);
  if (outstanding.length > 0) bits.push(`${outstanding.length} compliance requirement(s) outstanding`);
  return `${bits.join(". ")}. Read on ${programme.verifiedOn}.`;
}
