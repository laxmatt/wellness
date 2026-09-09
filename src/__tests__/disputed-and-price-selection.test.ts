import { describe, expect, it } from "vitest";
import { redLight } from "@/domain/categories";
import { CategoryDefinition as CategorySchema } from "@/domain/category";
import { evaluateCondition } from "@/domain/conditions";
import { buildCompareModel } from "@/domain/compare";
import { recommendCategory } from "@/domain/recommend";
import { scoreProducts, toScoringInput } from "@/domain/recommend/score";
import { applyPreferences } from "@/domain/personalization/match";
import { derivePrice, toProductView } from "@/domain/view";
import { miniCategory, miniProduct, offer, testBrand, testMerchant, viewsFor } from "./fixtures";

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
    expect(v.price.money.amountMinor).toBe(19900);
    expect(v.price.isDemo).toBe(false);
  });

  it("takes the lowest of the real amounts", () => {
    const v = build([
      { amount: 29900, demoPrice: false },
      { amount: 19900, demoPrice: false },
      { amount: 900, demoPrice: true },
    ]);
    expect(v.price.money.amountMinor).toBe(19900);
    expect(v.price.isDemo).toBe(false);
  });

  it("stays unconfirmed when every amount is prototype data", () => {
    const v = build([
      { amount: 14900, demoPrice: true },
      { amount: 19900, demoPrice: true },
    ]);
    expect(v.price.money.amountMinor).toBe(14900);
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
    expect(v.price.money.amountMinor).toBe(19900);
    expect(v.price.isDemo).toBe(false);
    expect(v.offers.find((o) => o.priceIsDemo)!.price.amountMinor).toBe(14900);
    // The provenance shown for the price is the offer the price came from.
    expect(v.provenance.price.source.url).toContain("hoogahealth.com");
  });

  it("leaves a product with one real offer exactly as it was", () => {
    const p = miniProduct("single", 12345, { power: 50, size: "m" });
    expect(derivePrice(p).money.amountMinor).toBe(12345);
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
