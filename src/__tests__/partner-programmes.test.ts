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

const PRODUCT = "https://selectsaunas.com/products/dundalk-luna-4-person";

describe("what each programme issued", () => {
  it("records the five partners with an arrangement and the one without", () => {
    expect(PROGRAMMES.map((p) => p.partnerId).sort()).toEqual([
      "hooga-shopify",
      "lifepro",
      "saunabox",
      "select-saunas-shopify",
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
    // Two named buttons, and no claim about what either does.
    expect(p.productLinks.kind).toBe("portal_tool");
    if (p.productLinks.kind === "portal_tool") {
      expect(p.productLinks.tools).toEqual(["Get product link", "Get link with source"]);
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

  it("records SAUNABOX's rate and code and nothing about its setup link", () => {
    const p = programmeFor("saunabox")!;
    expect(p.commissionPercent).toBe(5);
    expect(p.trackingCode).toBe("MATT41058");
    expect(p.referralLink).toBeUndefined();
    expect(p.inventory.kind).toBe("none");
    // The approval mail's complete-signup link is a single-use key to the
    // account. Its absence is the assertion.
    expect(JSON.stringify(p)).not.toMatch(/https:\/\/[^"]*sign[_-]?up|complete[_-]?signup|activate/i);
  });

  it("writes one line a person can read beside a partner's name", () => {
    expect(programmeNote(programmeFor("therasage")!)).toContain("10%");
    expect(programmeNote(programmeFor("therasage")!)).toContain("30-day referral window");
    expect(programmeNote(programmeFor("therasage")!)).toContain("compliance requirement");
    expect(programmeNote(programmeFor("saunabox")!)).toContain("tracking code MATT41058");
    expect(programmeNote(programmeFor("topture-shopify")!)).toContain("no verified product link");
  });
});

describe("a link to one product", () => {
  it("is refused for every partner, with the reason naming the tool that would make one", () => {
    for (const programme of PROGRAMMES) {
      const link = productLink(programme, PRODUCT);
      expect(link.ok, programme.partnerId).toBe(false);
      if (!link.ok) expect(link.reason, programme.partnerId).toContain(programme.merchantName);
    }
    const selectSaunas = productLink(programmeFor("select-saunas-shopify"), PRODUCT);
    expect(selectSaunas.ok).toBe(false);
    if (!selectSaunas.ok) {
      expect(selectSaunas.reason).toContain("Get product link");
      expect(selectSaunas.reason).toContain("Get link with source");
    }
  });

  it("carries no template on a route nobody has verified, so nothing can compose one by accident", () => {
    for (const programme of PROGRAMMES) {
      const route = programme.productLinks;
      expect(route.kind, programme.partnerId).not.toBe("verified");
      // The only field that could build a link exists only on a verified route.
      expect(Object.keys(route), programme.partnerId).not.toContain("template");
    }
  });

  it("composes from the recorded template once a person has verified one, and not before", () => {
    const verified = {
      ...programmeFor("select-saunas-shopify")!,
      productLinks: { kind: "verified" as const, template: "https://selectsaunas.com/a/x?u={url}", verifiedOn: "2026-09-20", verifiedBy: "Matt" },
    };
    const link = productLink(verified, PRODUCT);
    expect(link.ok).toBe(true);
    if (link.ok) expect(link.url).toBe(`https://selectsaunas.com/a/x?u=${encodeURIComponent(PRODUCT)}`);
  });

  it("still refuses a verified route while the partner's terms are unmet", () => {
    const verified = {
      ...programmeFor("therasage")!,
      productLinks: { kind: "verified" as const, template: "https://therasage.com/x?u={url}", verifiedOn: "2026-09-20", verifiedBy: "Matt" },
    };
    const link = productLink(verified, PRODUCT);
    expect(link.ok).toBe(false);
    if (!link.ok) expect(link.reason).toContain("compliance requirement");
  });
});

describe("what the catalogue says about these links", () => {
  it("calls a joined programme with no verified link unresolved, not unknown", () => {
    for (const programme of PROGRAMMES) {
      expect(affiliateStatusFor(programme), programme.partnerId).toBe("affiliate_link_unresolved");
    }
    // A partner nobody has recorded is the only thing that stays unknown.
    expect(affiliateStatusFor(undefined)).toBe("unknown");
  });

  it("gives such a link no sponsored rel, because it is not sponsored", () => {
    expect(outboundRel("affiliate_link_unresolved")).toBe("nofollow noopener");
    expect(RELATIONSHIP_COPY.affiliate_link_unresolved).toContain("earns nothing");
  });

  it("puts the same state on the three sources that can be read", () => {
    for (const source of SHOPIFY_PARTNERS) {
      expect(source.affiliate.status, source.id).toBe("affiliate_link_unresolved");
      // A status that asserts an arrangement has to name the arrangement.
      expect(source.affiliate.network, source.id).toBeDefined();
      expect(source.affiliate.programRef, source.id).toBeDefined();
      // And nothing on the source composes a link out of it.
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
    expect(requirements.some((r) => r.includes("restrict"))).toBe(true);
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
