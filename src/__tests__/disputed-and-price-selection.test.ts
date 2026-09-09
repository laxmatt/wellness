import { describe, expect, it } from "vitest";
import { redLight } from "@/domain/categories";
import { evaluateCondition } from "@/domain/conditions";
import { buildCompareModel } from "@/domain/compare";
import { recommendCategory } from "@/domain/recommend";
import { scoreProducts, toScoringInput } from "@/domain/recommend/score";
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
    const items = recommendCategory(viewsFor("red-light"), redLight).products.filter((p) =>
      ["hooga-hg300", "platinumled-biomax-900"].includes(p.view.id),
    );
    const row = buildCompareModel(items, redLight)
      .groups.flatMap((g) => g.rows)
      .find((r) => r.key === "irradiance_mw_cm2")!;
    expect(row.cells.every((c) => !c.best)).toBe(true);
    expect(row.notComparable).toMatch(/states its figure two ways/);
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
