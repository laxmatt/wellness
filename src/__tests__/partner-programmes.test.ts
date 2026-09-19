/**
 * What five affiliate programmes issued, and the one thing none of them has
 * given us yet.
 *
 * Matt finished the logins, so the facts in these records came out of real
 * dashboards rather than an approval email's promise. That raises the stakes on
 * exactly one question: three of the five dashboards have a button that makes a
 * link to a single product, and nobody has pressed one. The tests below exist
 * to make sure the distance between "a person can generate this" and "we know
 * what it looks like" never closes by itself.
 */

import { describe, expect, it } from "vitest";
import {
  PROGRAMMES,
  RECORDING_RULES,
  affiliateStatusFor,
  needsComplianceReview,
  outstandingCompliance,
  productLink,
  programmeFor,
  programmeNote,
  secretsIn,
} from "@/domain/affiliate/programmes";
import { outboundRel, RELATIONSHIP_COPY } from "@/domain/outbound";
import { BLOCKED_PARTNERS, SHOPIFY_PARTNERS } from "../../scripts/shopify-partners";

describe("what each programme issued", () => {
  it("records the five partners with an arrangement and the one without", () => {
    expect(PROGRAMMES.map((p) => p.partnerId).sort()).toEqual([
      "frostonic-shopify",
      "hooga-shopify",
      "lifepro",
      "saunabox",
      "saunakits-shopify",
      "select-saunas-shopify",
      "sweattent-shopify",
      "sweaty-yeti-woocommerce",
      "therasage",
      "topture-shopify",
    ]);
  });

  it("keeps Select Saunas' default link exactly as UpPromote issued it", () => {
    const p = programmeFor("select-saunas-shopify")!;
    expect(p.network).toBe("uppromote");
    expect(p.dashboard).toBe("active");
    expect(p.referralLink).toBe("https://selectsaunas.com?sca_ref=12323351.NbtdIcjAoO");
    expect(p.programRef).toBe("12323351.NbtdIcjAoO");
    // The product-link tool has been run now, and what it did is recorded as
    // the one parameter it added.
    expect(p.productLinks.kind).toBe("verified");
    if (p.productLinks.kind === "verified") {
      expect(p.productLinks.tag.param).toBe("sca_ref");
      expect(p.productLinks.tag.value).toBe("12323351.NbtdIcjAoO");
      expect(p.productLinks.tag.origin).toBe("https://selectsaunas.com");
    }
  });

  it("records the transformation each portal actually performed", () => {
    const observed: [string, string, string, string][] = [
      // The plain address a person started from, and the link that came back.
      [
        "select-saunas-shopify",
        "https://selectsaunas.com/products/dynamic-saunas-dyn-6106-01-barcelona-1-2-person-low-emf-far-infrared-sauna",
        "https://selectsaunas.com/products/dynamic-saunas-dyn-6106-01-barcelona-1-2-person-low-emf-far-infrared-sauna?sca_ref=12323351.NbtdIcjAoO",
        "sca_ref",
      ],
      [
        "saunakits-shopify",
        "https://saunakits.com/products/saunalife-4-person-cube-series-outdoor-home-sauna-kit-cl5g",
        "https://saunakits.com/products/saunalife-4-person-cube-series-outdoor-home-sauna-kit-cl5g?sca_ref=12323721.J7K7UndolP",
        "sca_ref",
      ],
      ["topture-shopify", "https://topture.com/products/thermasol-vue-sauna-cabin", "https://topture.com/products/thermasol-vue-sauna-cabin?ref=MATTORR", "ref"],
      ["hooga-shopify", "https://hoogahealth.com/products/sauna-series-floor-stand", "https://hoogahealth.com/products/sauna-series-floor-stand?ref=MATTORR", "ref"],
      ["sweaty-yeti-woocommerce", "https://sweatyyetisauna.com/product/sauna-plus/", "https://sweatyyetisauna.com/product/sauna-plus/?sld=126", "sld"],
      ["frostonic-shopify", "https://frostonic.com/products/air-pro-inflatable-ice-bath-tub?variant=46564189929610", "https://frostonic.com/products/air-pro-inflatable-ice-bath-tub?variant=46564189929610&ref=MATT", "ref"],
    ];
    for (const [id, plain, expected, param] of observed) {
      const link = productLink(programmeFor(id), plain);
      expect(link.ok, id).toBe(true);
      if (link.ok) expect(link.url, id).toBe(expected);
      const route = programmeFor(id)!.productLinks;
      expect(route.kind, id).toBe("verified");
      if (route.kind === "verified") expect(route.tag.param, id).toBe(param);
    }
  });

  it("keeps Therasage's referral link whole, coupon and campaign parameters included", () => {
    const p = programmeFor("therasage")!;
    expect(p.network).toBe("refersion");
    expect(p.referralLink).toBe(
      "https://therasage.com/discount/WELLNESSFITCHECK?rfsn=9327338.019740&utm_source=refersion&utm_medium=affiliate&utm_campaign=9327338.019740",
    );
    expect(p.coupon).toBe("WELLNESSFITCHECK");
    expect(p.commissionPercent).toBe(10);
    expect(p.referralWindowDays).toBe(30);
    expect(p.inventory.kind).toBe("none");
  });

  it("records SAUNABOX's verified referral and public Shopify inventory source without its setup link", () => {
    const p = programmeFor("saunabox")!;
    expect(p.commissionPercent).toBe(5);
    expect(p.trackingCode).toBe("MATT41058");
    expect(p.programRef).toBe("80182564");
    expect(p.referralLink).toBe("https://www.saunabox.com/MATT41058");
    expect(p.inventory).toEqual({ kind: "shopify_json", url: "https://www.saunabox.com/products.json" });
    // The approval mail's complete-signup link is a single-use key to the
    // account. Its absence is the assertion.
    expect(JSON.stringify(p)).not.toMatch(/https:\/\/[^"]*sign[_-]?up|complete[_-]?signup|activate/i);
  });

  it("writes one line a person can read beside a partner's name", () => {
    expect(programmeNote(programmeFor("therasage")!)).toContain("10%");
    expect(programmeNote(programmeFor("therasage")!)).toContain("30-day referral window");
    expect(programmeNote(programmeFor("therasage")!)).toContain("compliance requirement");
    expect(programmeNote(programmeFor("saunabox")!)).toContain("tracking code MATT41058");
    expect(programmeNote(programmeFor("topture-shopify")!)).toContain("product links verified");
    expect(programmeNote(programmeFor("saunabox")!)).toContain("no verified product link");
  });
});

describe("a link to one product", () => {
  it("keeps the query string a product address already carries", () => {
    // A Shopify variant address names the configuration. Losing it would land a
    // shopper on the wrong one of the right product.
    const link = productLink(programmeFor("topture-shopify"), "https://topture.com/products/thermasol-vue-sauna-cabin?variant=1011");
    expect(link.ok).toBe(true);
    if (link.ok) expect(link.url).toBe("https://topture.com/products/thermasol-vue-sauna-cabin?variant=1011&ref=MATTORR");
  });

  it("keeps the fragment, after the query, where it belongs", () => {
    const link = productLink(programmeFor("topture-shopify"), "https://topture.com/products/x?variant=9#specs");
    expect(link.ok).toBe(true);
    if (link.ok) expect(link.url).toBe("https://topture.com/products/x?variant=9&ref=MATTORR#specs");
  });

  it("is unchanged by composing twice", () => {
    const once = productLink(programmeFor("hooga-shopify"), "https://hoogahealth.com/products/sauna-series-floor-stand");
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = productLink(programmeFor("hooga-shopify"), once.url);
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.url).toBe(once.url);
  });

  it("refuses an address that is not the merchant's, so it can never be a redirect", () => {
    for (const elsewhere of [
      "https://evil.example/products/x",
      "https://topture.com.evil.example/products/x",
      "https://evil.example/?u=https://topture.com/products/x",
      // Userinfo: the host is evil.example, whatever it is dressed up as.
      "https://topture.com@evil.example/products/x",
      // A subdomain is a different origin and is not what was verified.
      "https://shop.topture.com/products/x",
    ]) {
      const link = productLink(programmeFor("topture-shopify"), elsewhere);
      expect(link.ok, elsewhere).toBe(false);
    }
  });

  it("refuses anything that is not https, and anything that is not an address", () => {
    for (const bad of ["http://topture.com/products/x", "javascript:alert(1)", "data:text/html,<p>x", "not an address", "//topture.com/products/x"]) {
      expect(productLink(programmeFor("topture-shopify"), bad).ok, bad).toBe(false);
    }
  });

  it("refuses to overwrite somebody else's referral on the same parameter", () => {
    const theirs = productLink(programmeFor("topture-shopify"), "https://topture.com/products/x?ref=SOMEBODYELSE");
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.reason).toContain("already carries ref");
  });

  it("refuses a partner with nothing to link through, naming what is missing", () => {
    const saunabox = productLink(programmeFor("saunabox"), "https://saunabox.com/products/x");
    expect(saunabox.ok).toBe(false);
    if (!saunabox.ok) expect(saunabox.reason).toContain("no verified product-level transformation");
    expect(productLink(undefined, "https://topture.com/products/x").ok).toBe(false);
  });

  it("refuses Therasage whatever its route says, because permission is the blocker", () => {
    const asIs = productLink(programmeFor("therasage"), "https://therasage.com/products/x");
    expect(asIs.ok).toBe(false);
    // Even handed a verified transformation, the terms still say no.
    const verified = {
      ...programmeFor("therasage")!,
      productLinks: {
        kind: "verified" as const,
        tag: { param: "rfsn", value: "9327338.019740", origin: "https://therasage.com", verifiedOn: "2026-09-15", verifiedBy: "Matt" },
      },
    };
    const link = productLink(verified, "https://therasage.com/products/x");
    expect(link.ok).toBe(false);
    if (!link.ok) expect(link.reason).toContain("compliance requirement");
  });
});

describe("what the catalogue says about these links", () => {
  it("says a verified link pays, and says an unverified one does not", () => {
    for (const id of ["topture-shopify", "select-saunas-shopify", "saunakits-shopify", "hooga-shopify"]) {
      expect(affiliateStatusFor(programmeFor(id)), id).toBe("affiliate");
    }
    // A verified transformation the terms forbid is still not a paying link.
    for (const id of ["therasage", "saunabox", "lifepro"]) {
      expect(affiliateStatusFor(programmeFor(id)), id).toBe("affiliate_link_unresolved");
    }
    // A partner nobody has recorded is the only thing that stays unknown.
    expect(affiliateStatusFor(undefined)).toBe("unknown");
  });

  it("marks a paying link sponsored and an unresolved one not", () => {
    expect(outboundRel("affiliate")).toBe("sponsored nofollow noopener");
    expect(outboundRel("affiliate_link_unresolved")).toBe("nofollow noopener");
    expect(RELATIONSHIP_COPY.affiliate_link_unresolved).toContain("earns nothing");
  });

  it("puts the verified tag on the three sources that can be read", () => {
    for (const source of SHOPIFY_PARTNERS) {
      expect(source.affiliate.status, source.id).toBe("affiliate");
      // A status that asserts an arrangement has to name the arrangement.
      expect(source.affiliate.network, source.id).toBeDefined();
      expect(source.affiliate.programRef, source.id).toBeDefined();
      // And what makes the link pay is on the record, not assumed.
      expect(source.affiliate.tag?.origin, source.id).toBe(source.merchantWebsite);
      expect(source.affiliate.tag?.verifiedOn, source.id).toMatch(/^2026-09-(15|17)$/);
      // Never both: an issued deep link and an added parameter say different
      // things about one link.
      expect(source.affiliate.linkPrefix, source.id).toBeUndefined();
    }
  });
});

describe("terms a person has to clear", () => {
  it("holds Therasage's two restrictions open and marks the partner", () => {
    const therasage = programmeFor("therasage")!;
    expect(needsComplianceReview(therasage)).toBe(true);
    expect(outstandingCompliance(therasage)).toHaveLength(2);
    const requirements = therasage.compliance.map((c) => c.requirement.toLowerCase());
    expect(requirements.some((r) => r.includes("disclosure"))).toBe(true);
    // Read in full now: the code is for social profiles, and this is a website.
    expect(requirements.some((r) => r.includes("social profiles") && r.includes("website"))).toBe(true);
    expect(requirements.some((r) => r.includes("express written permission"))).toBe(true);
  });

  it("records why the Therasage link was never generated, without pretending it matters", () => {
    const route = programmeFor("therasage")!.productLinks;
    expect(route.kind).toBe("portal_tool");
    if (route.kind === "portal_tool") {
      expect(route.why).toContain("logged out");
      expect(route.why).toContain("unusable");
    }
  });

  it("leaves every other partner clear rather than flagging all of them", () => {
    for (const programme of PROGRAMMES.filter((p) => p.partnerId !== "therasage")) {
      expect(needsComplianceReview(programme), programme.partnerId).toBe(false);
    }
  });

  it("reaches the workspace record, so the tool shows the flag beside the partner", () => {
    const therasage = BLOCKED_PARTNERS.find((p) => p.id === "therasage")!;
    expect(therasage.complianceReview).toBe("required");
    expect(therasage.compliance).toHaveLength(2);
  });
});

describe("what never gets written down", () => {
  it("finds nothing resembling a credential in any recorded value", () => {
    for (const programme of PROGRAMMES) expect(secretsIn(programme), programme.partnerId).toEqual([]);
  });

  it("catches one if somebody pastes it into a referral field", () => {
    const slip = { ...programmeFor("saunabox")!, referralLink: "https://saunabox.com/account/complete-signup?token=abc123" };
    const found = secretsIn(slip);
    expect(found.length).toBeGreaterThan(0);
    expect(found.map((f) => f.field)).toContain("referralLink");
  });

  it("checks values and leaves prose alone, so a note can say a portal needs a login", () => {
    const wordy = { ...programmeFor("lifepro")!, notes: "The portal needs a login and a password before anything is visible." };
    expect(secretsIn(wordy)).toEqual([]);
    expect(RECORDING_RULES.valueFields).not.toContain("notes");
  });

  it("records no session or login state anywhere in the partner records", () => {
    const everything = JSON.stringify({ PROGRAMMES, BLOCKED_PARTNERS, SHOPIFY_PARTNERS });
    for (const pattern of [/"cookie"/i, /set-cookie/i, /sessionid/i, /"password"/i, /authorization/i, /x-api-key/i]) {
      expect(everything, String(pattern)).not.toMatch(pattern);
    }
  });
});
