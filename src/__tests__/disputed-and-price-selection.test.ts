import { describe, expect, it } from "vitest";
import { categoryById, redLight } from "@/domain/categories";
import { CategoryDefinition as CategorySchema } from "@/domain/category";
import { evaluateCondition } from "@/domain/conditions";
import { buildCompareModel, type CompareModel } from "@/domain/compare";
import { assignBadges, recommendCategory } from "@/domain/recommend";
import { scoreProducts, toScoringInput } from "@/domain/recommend/score";
import { applyPreferences } from "@/domain/personalization/match";
import { derivePrice, displayPrice, numericValue, toProductView, PRICE_UNCONFIRMED } from "@/domain/view";
import { validateCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { catalog, miniCategory, miniProduct, miniView, offer, testBrand, testMerchant, viewsFor } from "./fixtures";

// Two defects, both reproduced from real records.
//
// Hooga's HG300 page states its irradiance twice and the two statements
// disagree: "over 73 mW/cm2" in the highlights, "73" in the table. Recording
// the floor made the site answer "more than 73" with a page that also says 73.
//
// The same product carried $199 read from its maker and a prototype $149 on an
// Amazon record. The shown price was the lowest offer, so the invented number
// won and the page said "Check current price" about a price it had.

const hg300 = () => viewsFor("red-light").find((v) => v.id === "hooga-hg300")!;

describe("a figure its own source states two ways answers nothing", () => {
  it("is withheld from matching, in both directions", () => {
    const v = hg300();
    const ask = (op: "gt" | "gte" | "lt" | "lte" | "eq" | "neq", value: number) =>
      evaluateCondition(v, redLight, { key: "irradiance_mw_cm2", op, value });
    // The floor reading would have answered these two.
    expect(ask("gt", 73)).toBe(false);
    expect(ask("neq", 73)).toBe(false);
    // The exact reading would have answered these.
    expect(ask("eq", 73)).toBe(false);
    expect(ask("gte", 73)).toBe(false);
    expect(ask("lte", 73)).toBe(false);
    expect(ask("lt", 100)).toBe(false);
    expect(evaluateCondition(v, redLight, { key: "irradiance_mw_cm2", op: "exists" })).toBe(false);
  });

  it("keeps both statements visible with the value", () => {
    const v = hg300();
    const spec = v.specs.find((s) => s.key === "irradiance_mw_cm2")!;
    expect(spec.formatted).toBe("73 mW/cm², disputed");
    expect(spec.disputed).toBe(true);
    const note = v.provenance["attributes.irradiance_mw_cm2"].source.note ?? "";
    expect(note).toContain("over 73");
    expect(note).toContain("73 exactly");
    // Not "the source never stated it", which is a different and false claim.
    expect(v.provenance["attributes.irradiance_mw_cm2"].verification).toBe("manufacturer_reported");
  });

  it("scores zero and says which kind of withholding it was", () => {
    const inputs = viewsFor("red-light").map(toScoringInput);
    const result = scoreProducts(inputs, redLight).find((r) => r.id === "hooga-hg300")!;
    expect(result.disputedCriteria).toContain("irradiance_mw_cm2");
    expect(result.demoCriteria).not.toContain("irradiance_mw_cm2");
    expect(result.criteria.find((c) => c.key === "irradiance_mw_cm2")!.raw).toBeUndefined();
  });

  it("ranks nothing on it in a comparison", () => {
    // The live pair that used to reach this branch no longer does: BIOMAX's
    // irradiance is withheld on its ninth-generation record, so the row is
    // unranked for that reason first. The branch itself is exercised on
    // fixtures in semantics.test.ts; here the live claim is the narrower one,
    // that HG300's disputed figure is shown and wins nothing.
    const items = recommendCategory(viewsFor("red-light"), redLight).products.filter((p) =>
      ["hooga-hg300", "platinumled-biomax-900"].includes(p.view.id),
    );
    const row = buildCompareModel(items, redLight)
      .groups.flatMap((g) => g.rows)
      .find((r) => r.key === "irradiance_mw_cm2")!;
    expect(row.cells.every((c) => !c.best)).toBe(true);
    expect(row.cells.some((c) => c.text.includes("73 mW/cm², disputed"))).toBe(true);
    expect(row.notComparable).toBeTruthy();
  });
});

describe("a disputed required field is missing, as far as completeness is concerned", () => {
  // The checklist read "3 of 4 required specifications carry a usable value"
  // beside "completeness 100%" on the same product. Both were computed, and
  // they disagreed: the completeness sum counted a required field that answers
  // nothing, because it only asked whether the record had a usable tier.
  const withDisputedRequired = () => {
    const p = miniProduct("disputed-required", 20000, { power: 50, size: "m" });
    // `size` is required in this category, and this one's source says two
    // things.
    p.attributes.size!.disputed = true;
    p.attributes.size!.source.note = "Stated as m in one place and l in another.";
    return p;
  };

  it("does not count toward completeness", () => {
    const before = toProductView(miniProduct("plain", 20000, { power: 50, size: "m" }), {
      category: miniCategory,
      brands: [testBrand],
      merchants: [testMerchant],
    });
    const after = toProductView(withDisputedRequired(), { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
    expect(before.flags.completeness).toBe(1);
    // Two required attributes in this category, power and size.
    expect(after.flags.completeness).toBe(0.5);
    expect(after.attributes.size).toBeUndefined();
  });

  it("can cost a product its eligibility, the same way a placeholder does", () => {
    // A category that asks for three quarters of its required specifications,
    // as the live ones do. Half is not enough.
    const strict = CategorySchema.parse({
      ...JSON.parse(JSON.stringify(miniCategory)),
      scoring: { ...JSON.parse(JSON.stringify(miniCategory.scoring)), completenessFloor: 0.75 },
    });
    const inputs = [withDisputedRequired(), miniProduct("plain", 20000, { power: 50, size: "m" })].map((p) =>
      toScoringInput(toProductView(p, { category: strict, brands: [testBrand], merchants: [testMerchant] })),
    );
    const scored = scoreProducts(inputs, strict);
    expect(scored.find((r) => r.id === "disputed-required")!.eligible).toBe(false);
    expect(scored.find((r) => r.id === "plain")!.eligible).toBe(true);
  });

  it("counts the same as a value the source does not state", () => {
    const notStated = miniProduct("not-stated", 20000, { power: 50, size: "m" });
    notStated.attributes.size = { unit: undefined, source: { kind: "manufacturer", method: "direct", note: "Silent." }, verification: "not_stated" };
    const v = toProductView(notStated, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
    expect(v.flags.completeness).toBe(0.5);
  });
});

describe("the shown price comes from the offers whose amounts are real", () => {
  const build = (offers: { amount: number; demoPrice: boolean }[]) => {
    const p = miniProduct("subject", offers[0].amount, { power: 50, size: "m" });
    p.offers = offers.map((o, i) => offer(`o${i}`, o.amount, "unknown", o.demoPrice));
    return toProductView(p, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
  };

  it("prefers a real amount over a lower prototype one", () => {
    const v = build([
      { amount: 14900, demoPrice: true },
      { amount: 19900, demoPrice: false },
    ]);
    expect(v.price.money!.amountMinor).toBe(19900);
    expect(v.price.isDemo).toBe(false);
  });

  it("takes the lowest of the real amounts", () => {
    const v = build([
      { amount: 29900, demoPrice: false },
      { amount: 19900, demoPrice: false },
      { amount: 900, demoPrice: true },
    ]);
    expect(v.price.money!.amountMinor).toBe(19900);
    expect(v.price.isDemo).toBe(false);
  });

  it("stays unconfirmed when every amount is prototype data", () => {
    const v = build([
      { amount: 14900, demoPrice: true },
      { amount: 19900, demoPrice: true },
    ]);
    expect(v.price.money!.amountMinor).toBe(14900);
    expect(v.price.isDemo).toBe(true);
  });

  it("counts retailers from the same set the price came from", () => {
    const v = build([
      { amount: 14900, demoPrice: true },
      { amount: 19900, demoPrice: false },
      { amount: 24900, demoPrice: false },
    ]);
    expect(v.price.offerCount).toBe(2);
    // The offer list still shows all three; the ones with no amount say so.
    expect(v.offers.length).toBe(3);
    expect(v.offers.filter((o) => o.priceIsDemo).length).toBe(1);
  });

  it("never invents availability from the choice", () => {
    const v = build([
      { amount: 14900, demoPrice: true },
      { amount: 19900, demoPrice: false },
    ]);
    for (const o of v.offers) expect(o.availability).toBe("unknown");
    expect(v.availability).toBe("unknown");
  });

  it("holds on the real record it was found in", () => {
    const v = hg300();
    expect(v.price.money!.amountMinor).toBe(19900);
    expect(v.price.isDemo).toBe(false);
    expect(v.offers.find((o) => o.priceIsDemo)!.price.amountMinor).toBe(14900);
    // The provenance shown for the price is the offer the price came from.
    expect(v.provenance.price.source.url).toContain("hoogahealth.com");
  });

  it("leaves a product with one real offer exactly as it was", () => {
    const p = miniProduct("single", 12345, { power: 50, size: "m" });
    expect(derivePrice(p).money!.amountMinor).toBe(12345);
    expect(derivePrice(p).isDemo).toBe(false);
    expect(derivePrice(p).offerCount).toBe(1);
  });
});

describe("a prototype amount cannot make a product look cheap", () => {
  // PRO1500 was ranked cheapest of eight panels on a prototype $649. The
  // amount was already excluded from price claims and from the affordability
  // formula; the preference ranking still read it.
  const view = (id: string, amount: number, demoPrice: boolean) =>
    toProductView(miniProduct(id, amount, { power: 50, size: "m" }, "unknown", [], demoPrice), {
      category: miniCategory,
      brands: [testBrand],
      merchants: [testMerchant],
    });

  const rank = (views: ReturnType<typeof view>[], direction: "prefer_low" | "prefer_high" | "prefer_value", value?: number) =>
    applyPreferences(views, miniCategory, {
      hard: [],
      soft: [{ key: "price", direction, value, weight: 1 }],
      unmapped: [],
      medicalIntent: false,
    });

  const real = () => [view("cheap", 20000, false), view("dear", 60000, false)];

  it("keeps the ordering of real prices", () => {
    const r = rank(real(), "prefer_low");
    expect(r.rankedIds).toEqual(["cheap", "dear"]);
    expect(r.explanations.cheap.softScore).toBeGreaterThan(r.explanations.dear.softScore);
  });

  it("does not let an extreme prototype amount move a real product's score", () => {
    const without = rank(real(), "prefer_low");
    const withLow = rank([...real(), view("invented-low", 1, true)], "prefer_low");
    const withHigh = rank([...real(), view("invented-high", 9_000_000, true)], "prefer_low");
    for (const id of ["cheap", "dear"]) {
      expect(withLow.explanations[id].softScore, id).toBe(without.explanations[id].softScore);
      expect(withHigh.explanations[id].softScore, id).toBe(without.explanations[id].softScore);
    }
  });

  it("does the same for a preference pointing the other way", () => {
    const without = rank(real(), "prefer_high");
    const withHigh = rank([...real(), view("invented-high", 9_000_000, true)], "prefer_high");
    for (const id of ["cheap", "dear"]) {
      expect(withHigh.explanations[id].softScore, id).toBe(without.explanations[id].softScore);
    }
  });

  it("gives the prototype-priced product no credit, in either direction", () => {
    const low = rank([...real(), view("invented-low", 1, true)], "prefer_low");
    expect(low.explanations["invented-low"].softScore).toBe(0);
    expect(low.rankedIds[low.rankedIds.length - 1]).toBe("invented-low");
    const high = rank([...real(), view("invented-high", 9_000_000, true)], "prefer_high");
    expect(high.explanations["invented-high"].softScore).toBe(0);
  });

  it("refuses a named amount against a price nobody recorded", () => {
    const r = rank([view("invented", 20000, true), view("cheap", 20000, false)], "prefer_value", 20000);
    expect(r.explanations.cheap.softScore).toBeGreaterThan(0);
    expect(r.explanations.invented.softScore).toBe(0);
    expect(r.explanations.invented.misses.join(" ")).toContain("not confirmed");
  });

  it("says the price is not confirmed rather than quoting the placeholder", () => {
    const r = rank([view("invented", 124900, true), view("cheap", 20000, false)], "prefer_low");
    const misses = r.explanations.invented.misses.join(" ");
    expect(misses).toContain("not confirmed");
    expect(misses).not.toContain("$1,249");
  });
});

// The third case, and the one the first two do not cover: an offer whose
// amount is real, is not this product's.
//
// Liquid I.V.'s record carried an Amazon row at $27.99 whose own note said the
// figure was for a variety pack. The record is a 16-stick Lemon Lime box. That
// $27.99 was the shown price, it beat the maker's own $24.99 into second place
// as the only non-prototype amount, and the per-serving cost was computed from
// it. Nothing in the file was hidden: the note said "variety pack" and the
// site priced on it anyway.
//
// Preferring the direct offer would not have fixed this. The direct offer only
// happened to be right; the rule has to be that a mismatched amount prices
// nothing, wherever it sits and whatever it costs.
describe("an offer whose amount belongs to another product prices nothing", () => {
  const withOffers = (offers: ReturnType<typeof offer>[]) => {
    const p = miniProduct("subject", 10000, { power: 50, size: "m" });
    p.offers = offers;
    return toProductView(p, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
  };
  const disputedOffer = (id: string, priceMinor: number) => ({
    ...offer(id, priceMinor),
    disputed: true,
    source: { kind: "manufacturer" as const, url: "https://example.com", retrievedAt: "2026-09-09", method: "secondhand" as const, note: "Reported for a different pack." },
  });

  it("does not set the price, even when it is the cheapest real amount on the record", () => {
    const v = withOffers([offer("real", 2499), disputedOffer("mismatched", 1999)]);
    expect(v.price.money!.amountMinor).toBe(2499);
    expect(v.price.isDemo).toBe(false);
  });

  it("does not count as a retailer", () => {
    const v = withOffers([offer("real", 2499), disputedOffer("mismatched", 1999)]);
    expect(v.price.offerCount).toBe(1);
  });

  it("loses to a placeholder, which is at least this product's placeholder", () => {
    const v = withOffers([offer("placeholder", 9999, "unknown", true), disputedOffer("mismatched", 1999)]);
    expect(v.price.money!.amountMinor).toBe(9999);
    expect(v.price.isDemo).toBe(true);
    expect(v.price.offerCount).toBe(1);
  });

  it("stays visible on the record, with what is known about it", () => {
    const v = withOffers([offer("real", 2499), disputedOffer("mismatched", 1999)]);
    const row = v.offers.find((o) => o.id === "mismatched")!;
    expect(row.price.amountMinor).toBe(1999);
    expect(row.disputed).toBe(true);
    expect(row.disputeNote).toBe("Reported for a different pack.");
    expect(v.offers.find((o) => o.id === "real")!.disputed).toBeUndefined();
  });

  it("is what the real record now does with the Amazon row", () => {
    const v = viewsFor("wellness-drinks").find((x) => x.id === "liquid-iv-hydration-multiplier-16")!;
    const amazon = v.offers.find((o) => o.merchant.name.toLowerCase().includes("amazon"))!;
    expect(amazon.disputed).toBe(true);
    expect(amazon.price.amountMinor).toBe(2799);
    expect(v.price.money!.amountMinor).toBe(2499);
    expect(v.price.offerCount).toBe(1);

    // And the per-serving figure no longer follows any price: the maker states
    // it. It read 175 while the mismatched $27.99 was the basis.
    expect(v.attributes.price_per_serving_minor).toBe(156);
    expect(v.provenance["attributes.price_per_serving_minor"]?.derivedFrom).toBeUndefined();
    expect(v.provenance["attributes.price_per_serving_minor"]?.verification).toBe("manufacturer_reported");
  });
  it("must say why, or the marker is a silent deletion", () => {
    const c = catalog();
    const p = structuredClone(c.products.find((x) => x.id === "liquid-iv-hydration-multiplier-16")!);
    const amazon = p.offers.find((o) => o.id === "liquid-iv-16-amazon")!;
    delete amazon.source.note;
    const issues = validateCatalog({ ...c, products: [...c.products.filter((x) => x.id !== p.id), p] });
    expect(issues.map((i) => i.message).join(" ")).toMatch(/disputed with no note/);
  });

  it("refuses a marker on prototype data, which is a different problem", () => {
    const c = catalog();
    const p = structuredClone(c.products.find((x) => x.id === "liquid-iv-hydration-multiplier-16")!);
    const amazon = p.offers.find((o) => o.id === "liquid-iv-16-amazon")!;
    amazon.source = { kind: "demo", ref: "Prototype demo value", method: "direct", note: "Placeholder." };
    const issues = validateCatalog({ ...c, products: [...c.products.filter((x) => x.id !== p.id), p] });
    expect(issues.map((i) => i.message).join(" ")).toMatch(/also prototype data/);
  });
});

// A product every one of whose offers is withheld has no price. Not a zero,
// not an invented reference, not a placeholder: no price.
//
// This exists because the argument for keeping a contradicted $6,990 on
// Plunge's public page was that withholding the offer would fail the build. It
// did fail: `derivePrice` threw, and a second defect sat behind it, an
// undefined written into the provenance map that crashed the catalogue report.
// A type that cannot express "no price" is not a reason to publish a price.
describe("a product whose every offer is withheld has no price, and still works", () => {
  const unpriced = () => {
    const p = miniProduct("unpriced", 10000, { power: 50, size: "m" });
    p.offers = [
      {
        ...offer("mismatched", 1999),
        disputed: true,
        source: { kind: "manufacturer" as const, url: "https://example.com", retrievedAt: "2026-09-09", method: "secondhand" as const, note: "Reported for a different configuration." },
      },
    ];
    return toProductView(p, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
  };

  it("reports no amount rather than throwing, inventing one, or falling back to zero", () => {
    const v = unpriced();
    expect(v.price.money).toBeUndefined();
    expect(v.price.basis).toBe("none");
    expect(v.price.offerCount).toBe(0);
    // Not flagged as a placeholder either: a missing amount and an invented
    // amount are different things and the copy for them differs.
    expect(v.price.isDemo).toBe(false);
    expect(displayPrice(v.price)).toBe(PRICE_UNCONFIRMED);
  });

  it("keeps the withheld amount on the record with its reason", () => {
    const row = unpriced().offers.find((o) => o.id === "mismatched")!;
    expect(row.price.amountMinor).toBe(1999);
    expect(row.disputed).toBe(true);
    expect(row.disputeNote).toBe("Reported for a different configuration.");
  });

  it("leaves no hole in the provenance map", () => {
    // The catalogue report iterates Object.values(provenance). An undefined
    // written under the "price" key crashed it.
    const v = unpriced();
    expect(Object.values(v.provenance).every((p) => p !== undefined)).toBe(true);
    expect("price" in v.provenance).toBe(false);
  });

  it("still scores, and stays eligible and comparable", () => {
    // Three, so the unpriced one is not the floor on every criterion by
    // construction: a zero there would say nothing about the price path.
    const priced = miniView(miniProduct("priced", 30000, { power: 90, size: "l" }));
    const weak = miniView(miniProduct("weak", 20000, { power: 10, size: "s" }));
    const set = assignBadges([unpriced(), priced, weak].map(toScoringInput), miniCategory);
    expect(set.scores.unpriced.eligible).toBe(true);
    expect(set.scores.unpriced.score).toBeGreaterThan(0);
    expect(set.ranking).toContain("unpriced");
    const model = buildCompareModel(recommendCategory([unpriced(), priced], miniCategory).products, miniCategory);
    const priceRow = model.groups[0].rows.find((r) => r.key === "price")!;
    expect(priceRow.cells[0].text === PRICE_UNCONFIRMED || priceRow.cells[1].text === PRICE_UNCONFIRMED).toBe(true);
    // Two products, one of which has no amount, are not "the same price".
    expect(priceRow.same).toBe(false);
  });

  it("earns no affordability and no price badge from an amount it does not have", () => {
    const dearer = miniView(miniProduct("dearer", 90000, { power: 40, size: "s" }));
    const cheaper = miniView(miniProduct("cheaper", 12000, { power: 30, size: "s" }));
    const ins = [unpriced(), dearer, cheaper].map(toScoringInput);
    expect(ins.find((i) => i.id === "unpriced")!.priceMinor).toBeUndefined();
    const set = assignBadges(ins, miniCategory);
    const value = set.values.unpriced;
    expect(value.eligible).toBe(false);
    expect(value.affordability).toBe(0);
    expect(value.reason).toMatch(/no amount on record/);
    for (const b of set.badges) {
      if (b.badge !== "best_overall") expect(b.productId, b.badge).not.toBe("unpriced");
    }
  });

  it("answers no price condition and sorts last on price, rather than as free", () => {
    const v = unpriced();
    expect(evaluateCondition(v, miniCategory, { key: "price", op: "lte", value: 100000 })).toBe(false);
    expect(evaluateCondition(v, miniCategory, { key: "price", op: "exists" })).toBe(false);
    expect(numericValue(v, "price")).toBeUndefined();
  });

  it("is what the real record now does with Plunge", () => {
    const v = viewsFor("cold-plunge").find((x) => x.id === "plunge-original")!;
    expect(v.price.money).toBeUndefined();
    expect(v.offers[0].disputed).toBe(true);
    expect(v.offers[0].price.amountMinor).toBe(699000);
    const set = assignBadges(viewsFor("cold-plunge").map(toScoringInput), categoryById("cold-plunge")!);
    expect(set.scores["plunge-original"].eligible).toBe(true);
    expect(set.badgesByProduct["plunge-original"]).toBeUndefined();
  });
});

// Going to a retailer from the comparison took a detour through the product
// page: the columns linked internally and nowhere else.
describe("the comparison offers retailers directly", () => {
  const model = (catId: string, ids: string[]) => {
    const cat = categoryById(catId)!;
    const views = viewsFor(catId);
    const items = recommendCategory(views, cat).products.filter((p) => ids.includes(p.view.id));
    return buildCompareModel(items, cat);
  };

  it("names every retailer on the record, with the amount only where there is one", () => {
    const [pro] = model("red-light", ["hooga-pro1500"]).columns;
    expect(pro.merchants.map((m) => m.merchant)).toEqual(["Hooga (direct)", "Amazon"]);
    expect(pro.merchants[0].price).toBe("$1,199");
    // Amazon's amount is prototype data. The retailer and the link are real,
    // so the link stands; the invented number is not quoted.
    expect(pro.merchants[1].price).toBeUndefined();
    for (const m of pro.merchants) expect(m.url).toMatch(/^https:\/\//);
  });

  it("keeps a retailer a shopper can use even when no price can be shown", () => {
    const [flex] = model("red-light", ["infraredi-flex-max"]).columns;
    expect(flex.price).toBe(PRICE_UNCONFIRMED);
    expect(flex.merchants).toHaveLength(1);
    expect(flex.merchants[0].price).toBeUndefined();
    expect(flex.merchants[0].url).toContain("infraredi.com");
  });

  it("offers nothing at all when the record holds no way to buy", () => {
    // Plunge's only offer is withheld: its amount belongs to a configuration
    // nobody matched. A fabricated destination would be worse than none.
    const [plunge] = model("cold-plunge", ["plunge-original"]).columns;
    expect(plunge.merchants).toEqual([]);
  });

  it("never offers a withheld listing, on the real three-product path", () => {
    const cols = model("cold-plunge", ["renu-cold-stoic-2", "plunge-original", "ice-barrel-500"]).columns;
    const urls = cols.flatMap((c) => c.merchants.map((m) => m.url));
    expect(urls).not.toContain("https://www.amazon.com/dp/B01IT9NLHW");
    expect(urls.some((u) => u.includes("renutherapy.com"))).toBe(true);
    expect(urls.some((u) => u.includes("icebarrel.com"))).toBe(true);
  });

  it("orders retailers by amount, and never by who might pay", () => {
    const flip = (views: ReturnType<typeof viewsFor>) =>
      views.map((v) => ({ ...v, offers: v.offers.map((o) => ({ ...o, affiliateStatus: "affiliate" as const })) }));
    const cat = categoryById("wellness-drinks")!;
    const ids = ["lmnt-citrus-salt-30", "cure-hydration-lemonade-14"];
    const before = buildCompareModel(recommendCategory(viewsFor("wellness-drinks"), cat).products.filter((p) => ids.includes(p.view.id)), cat);
    const after = buildCompareModel(recommendCategory(flip(viewsFor("wellness-drinks")), cat).products.filter((p) => ids.includes(p.view.id)), cat);
    // Everything but the status itself, which is now carried so the link can
    // be marked up as what it is. What must not move is which retailers appear
    // and in what order: marking every offer as paying changes neither.
    const ordering = (m: CompareModel) => m.columns.map((c) => c.merchants.map(({ offerId, merchant, url, price }) => ({ offerId, merchant, url, price })));
    expect(ordering(after)).toEqual(ordering(before));
    // And it is carried faithfully rather than assumed.
    expect(after.columns.flatMap((c) => c.merchants.map((m) => m.affiliateStatus))).toEqual(after.columns.flatMap((c) => c.merchants.map(() => "affiliate")));
    expect(before.columns.flatMap((c) => c.merchants.map((m) => m.affiliateStatus))).toEqual(before.columns.flatMap((c) => c.merchants.map(() => "unknown")));
    // Real amounts first, cheapest first, placeholders last.
    for (const c of before.columns) {
      const shown = c.merchants.filter((m) => m.price !== undefined).length;
      expect(c.merchants.slice(0, shown).every((m) => m.price !== undefined)).toBe(true);
    }
  });
});
