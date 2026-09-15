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
   * Somebody generated a real link, compared it against the product address it
   * came from, and recorded the transformation. Nothing sets this yet.
   */
  | { kind: "verified"; template: string; verifiedOn: string; verifiedBy: string };

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
  inventory: { kind: "shopify_json"; url: string } | { kind: "none"; why: string };
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

const NO_VERIFIED_TRANSFORMATION =
  "The dashboard makes one. What that tool does to a product address is unverified, and composing a parameter that looks like the right one produces a link that earns nothing while claiming it earns something.";

export const PROGRAMMES: PartnerProgramme[] = [
  {
    partnerId: "topture-shopify",
    merchantName: "Topture",
    network: "goaffpro",
    dashboard: "active",
    programRef: "MATTORR",
    referralLink: "https://topture.com/?ref=MATTORR",
    commissionPercent: 2,
    productLinks: { kind: "portal_tool", tools: ["Product link generator"], why: NO_VERIFIED_TRANSFORMATION },
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
    productLinks: {
      kind: "portal_tool",
      // Both buttons exist in the dashboard. Neither has been run, so what
      // either does to an address is not written down here.
      tools: ["Get product link", "Get link with source"],
      why: NO_VERIFIED_TRANSFORMATION,
    },
    inventory: { kind: "shopify_json", url: "https://selectsaunas.com/products.json" },
    compliance: [],
    verifiedOn: "2026-09-15",
    notes:
      "UpPromote, dashboard active. Marketing Tools holds no files. Product-level links are generatable through the portal's own tool, so this is a job for a person with the dashboard open, not a transformation to guess at. The commission rate is not stated in this record because nobody has read it.",
  },
  {
    partnerId: "hooga-shopify",
    merchantName: "Hooga",
    network: "goaffpro",
    dashboard: "active",
    programRef: "MATTORR",
    referralLink: "https://hoogahealth.com/?ref=MATTORR",
    commissionPercent: 8,
    productLinks: { kind: "portal_tool", tools: ["Product link generator"], why: NO_VERIFIED_TRANSFORMATION },
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
      why: NO_VERIFIED_TRANSFORMATION,
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
        requirement: "The terms restrict where the coupon and the link may appear. Which surfaces are permitted has not been read line by line, so no placement is approved yet.",
        statedIn: "Therasage affiliate terms, read in the Refersion portal on 2026-09-15.",
        state: "outstanding",
      },
    ],
    verifiedOn: "2026-09-15",
    notes:
      "Refersion, dashboard active, 10% with a 30-day referral window. The referral link carries a coupon, which makes it a marketing placement as well as a link, and the terms restrict where both may go. Nothing publishes either until somebody clears the compliance requirements above.",
  },
  {
    partnerId: "saunabox",
    merchantName: "SAUNABOX",
    network: "direct",
    dashboard: "active",
    trackingCode: "MATT41058",
    commissionPercent: 5,
    productLinks: {
      kind: "none",
      why: "The approval gave a tracking code and no link builder. How the code attaches to a product address is unknown.",
    },
    inventory: {
      kind: "none",
      why: "The approval carried no inventory feed and no export. Nothing has been found to fetch.",
    },
    compliance: [],
    verifiedOn: "2026-09-15",
    notes:
      "Approved directly at 5% with tracking code MATT41058. The approval mail also carried a link to finish setting up the account; that link is a single-use key to this account and is deliberately not recorded here or anywhere in this repository.",
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
  if (programme.productLinks.kind === "verified" && !needsComplianceReview(programme)) return "affiliate";
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
  const outstanding = outstandingCompliance(programme);
  if (outstanding.length > 0) {
    return { ok: false, reason: `${programme.merchantName}: ${outstanding.length} compliance requirement(s) outstanding. ${outstanding.map((c) => c.requirement).join(" ")}` };
  }
  return { ok: true, url: route.template.replace("{url}", encodeURIComponent(productUrl)) };
}

/** A partner's programme facts as one line, for a source record's notes. */
export function programmeNote(programme: PartnerProgramme): string {
  const bits: string[] = [`${programme.network}, dashboard ${programme.dashboard === "active" ? "active" : "not reviewed"}`];
  if (programme.commissionPercent !== undefined) bits.push(`${programme.commissionPercent}%`);
  if (programme.referralWindowDays !== undefined) bits.push(`${programme.referralWindowDays}-day referral window`);
  if (programme.coupon) bits.push(`coupon ${programme.coupon}`);
  if (programme.trackingCode) bits.push(`tracking code ${programme.trackingCode}`);
  bits.push(programme.productLinks.kind === "verified" ? "product links verified" : "no verified product link");
  const outstanding = outstandingCompliance(programme);
  if (outstanding.length > 0) bits.push(`${outstanding.length} compliance requirement(s) outstanding`);
  return `${bits.join(". ")}. Read on ${programme.verifiedOn}.`;
}
