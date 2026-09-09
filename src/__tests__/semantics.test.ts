import { describe, expect, it } from "vitest";
import { categories, categoryById } from "@/domain/categories";
import { buildCompareModel } from "@/domain/compare";
import { evaluateCondition, unconfirmedByPrice } from "@/domain/conditions";
import { assignBadges, recommendCategory, scoreProducts, toScoringInput } from "@/domain/recommend";
import { catalog, viewsFor } from "./fixtures";

const redLight = categoryById("red-light")!;

describe("what the score claims", () => {
  it("every category states what its score measures and does not call it quality", () => {
    for (const cat of categories) {
      expect(cat.scoring.meaning.length, cat.id).toBeGreaterThan(40);
      expect(cat.scoring.label.toLowerCase(), cat.id).not.toContain("quality");
    }
  });

  it("publishes each criterion's share of the score so the number can be checked", () => {
    const results = scoreProducts(viewsFor("red-light").map(toScoringInput), redLight);
    const shares = results[0].criteria.map((c) => c.share);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    // Coverage dominates red light, which is why the number is capability, not quality.
    const coverage = results[0].criteria.find((c) => c.key === "coverage")!;
    expect(coverage.share).toBeGreaterThan(0.4);
  });

  it("a targeted panel's lower score comes from coverage weight, not from any quality judgement", () => {
    const results = scoreProducts(viewsFor("red-light").map(toScoringInput), redLight);
    const hg300 = results.find((r) => r.id === "hooga-hg300")!;
    const warranty = hg300.criteria.find((c) => c.key === "warranty_years")!;
    const coverage = hg300.criteria.find((c) => c.key === "coverage")!;
    // It ties the field on warranty and only loses coverage.
    expect(warranty.normalized).toBe(1);
    expect(coverage.normalized).toBe(0);
  });
});

describe("demo data never counts as evidence", () => {
  it("drops placeholder attribute values before scoring and records which", () => {
    const flex = viewsFor("red-light").find((v) => v.id === "infraredi-flex-max")!;
    // The placeholder is withheld from `attributes` itself now, one layer
    // earlier than before, because `evaluateCondition` reads that map and a
    // demo value was matchable while being hidden from every screen.
    expect(flex.attributes.coverage).toBeUndefined();
    expect(flex.provenance["attributes.coverage"].verification).toBe("demo");
    const input = toScoringInput(flex);
    expect(input.attributes.coverage).toBeUndefined();
    // Still named, so the score can say what it could not use.
    expect(input.demoKeys).toContain("coverage");
  });

  it("counts a placeholder against completeness exactly like a missing value", () => {
    const flex = viewsFor("red-light").find((v) => v.id === "infraredi-flex-max")!;
    expect(flex.flags.completeness).toBeLessThan(1);
    const result = scoreProducts(viewsFor("red-light").map(toScoringInput), redLight).find((r) => r.id === "infraredi-flex-max")!;
    expect(result.demoCriteria).toContain("coverage");
    expect(result.eligible).toBe(false);
  });

  it("no product carrying a placeholder price wins a price-based badge", () => {
    for (const cat of categories) {
      const views = viewsFor(cat.id);
      const byId = new Map(views.map((v) => [v.id, v]));
      const set = assignBadges(views.map(toScoringInput), cat);
      for (const b of set.badges) {
        if (b.badge === "best_overall") continue;
        expect(byId.get(b.productId)!.price.isDemo, `${cat.id} ${b.badge} ${b.productId}`).toBe(false);
      }
    }
  });

  it("says which badges were withheld rather than quietly showing fewer picks", () => {
    const set = assignBadges(viewsFor("red-light").map(toScoringInput), redLight);
    const withheldBadges = set.withheld.map((w) => w.badge);
    expect(withheldBadges).toContain("best_budget");
    expect(withheldBadges).toContain("best_premium");
    for (const w of set.withheld) expect(w.reason.length).toBeGreaterThan(20);
  });

  it("keeps Best Overall available, since it makes no claim about price", () => {
    const set = assignBadges(viewsFor("red-light").map(toScoringInput), redLight);
    expect(set.badges.some((b) => b.badge === "best_overall")).toBe(true);
  });

  it("a placeholder value can never raise a score", () => {
    const views = viewsFor("wellness-drinks");
    const olipop = views.find((v) => v.id === "olipop-root-beer-12")!;
    // Sugar and calories are placeholders, so its label score cannot benefit.
    const r = scoreProducts(views.map(toScoringInput), categoryById("wellness-drinks")!).find((x) => x.id === olipop.id)!;
    expect(r.demoCriteria).toEqual(expect.arrayContaining(["sugar_g", "calories"]));
    expect(r.score).toBe(0);
  });
});

describe("comparison dots require comparable measurements", () => {
  const items = (ids: string[]) => {
    const all = recommendCategory(viewsFor("red-light"), redLight).products;
    return all.filter((p) => ids.includes(p.view.id));
  };

  it("suppresses the irradiance winner when a measurement distance is missing", () => {
    // PRO1500 reports irradiance with no stated distance; HG300 reports at 6 in.
    const model = buildCompareModel(items(["hooga-pro1500", "hooga-hg300"]), redLight);
    const row = model.groups.flatMap((g) => g.rows).find((r) => r.key === "irradiance_mw_cm2")!;
    expect(row.cells.every((c) => !c.best)).toBe(true);
    expect(row.notComparable).toMatch(/not stated for every product/);
  });

  it("suppresses the irradiance winner when one figure is a floor, even at the same distance", () => {
    // HG300 and BIOMAX 900 both report at 6 in, so the distance rule is
    // satisfied. HG300's figure is "over 73", which the maker states as a
    // floor: BIOMAX's 185 looks like the winner and the real HG300 number is
    // not known. A row nobody can rank is left unranked.
    const model = buildCompareModel(items(["hooga-hg300", "platinumled-biomax-900"]), redLight);
    const row = model.groups.flatMap((g) => g.rows).find((r) => r.key === "irradiance_mw_cm2")!;
    expect(row.cells.every((c) => !c.best)).toBe(true);
    expect(row.notComparable).toMatch(/bound its maker stated/);
  });

  it("still marks a winner on a row of exact figures", () => {
    // The bound rule is not a blanket refusal to rank. LED count is stated
    // exactly by both, and BIOMAX's 300 wins it.
    const model = buildCompareModel(items(["hooga-hg300", "platinumled-biomax-900"]), redLight);
    const row = model.groups.flatMap((g) => g.rows).find((r) => r.key === "led_count")!;
    expect(row.notComparable).toBeUndefined();
    expect(row.cells.filter((c) => c.best).length).toBe(1);
    expect(row.cells.findIndex((c) => c.best)).toBe(model.columns.findIndex((c) => c.id === "platinumled-biomax-900"));
  });

  it("never marks a winner in a row containing placeholder data", () => {
    const model = buildCompareModel(items(["hooga-pro1500", "platinumled-biomax-900"]), redLight);
    const wavelengths = model.groups.flatMap((g) => g.rows).find((r) => r.key === "wavelengths_nm")!;
    expect(wavelengths.cells.every((c) => !c.best)).toBe(true);
    const price = model.groups[0].rows.find((r) => r.key === "price")!;
    expect(price.cells.every((c) => !c.best)).toBe(true);
    expect(price.notComparable).toMatch(/placeholder/);
  });

  it("labels the score row with the category's own name for it", () => {
    const model = buildCompareModel(items(["hooga-pro1500", "hooga-hg300"]), redLight);
    expect(model.groups[0].rows.find((r) => r.key === "score")!.label).toBe("Capability score");
  });
});

describe("tradeoff copy", () => {
  it("says tradeoffs were not assessed rather than implying none exist", () => {
    const items = recommendCategory(viewsFor("red-light"), redLight).products.filter((p) => ["hooga-pro1500", "hooga-hg300"].includes(p.view.id));
    const model = buildCompareModel(items, redLight);
    const row = model.groups[0].rows.find((r) => r.key === "tradeoff")!;
    const texts = row.cells.map((c) => c.text);
    expect(texts.some((t) => t === "Tradeoffs not assessed")).toBe(true);
    expect(texts.some((t) => /none flagged/i.test(t))).toBe(false);
  });
});

describe("catalogue integrity after the guards", () => {
  it("still awards Best Overall in every category", () => {
    for (const cat of categories) {
      const set = assignBadges(viewsFor(cat.id).map(toScoringInput), cat);
      expect(set.badges.some((b) => b.badge === "best_overall"), cat.id).toBe(true);
    }
  });

  it("keeps the affiliate-neutrality guarantee intact", () => {
    const c = catalog();
    for (const cat of c.categories) {
      const base = assignBadges(viewsFor(cat.id).map(toScoringInput), cat);
      const flipped = assignBadges(
        viewsFor(
          cat.id,
          c.products.map((p) => ({
            ...p,
            offers: p.offers.map((o) => ({ ...o, affiliate: { ...o.affiliate, status: o.affiliate.status === "affiliate" ? ("non_affiliate" as const) : ("affiliate" as const) } })),
          })),
        ).map(toScoringInput),
        cat,
      );
      expect(flipped.ranking).toEqual(base.ranking);
      expect(flipped.badges).toEqual(base.badges);
    }
  });
});

describe("a placeholder price is not budget evidence", () => {
  const budget = [{ key: "price", op: "lte" as const, value: 70000 }];

  it("cannot confirm an unverified price meets a budget", () => {
    const views = viewsFor("red-light");
    const pro = views.find((v) => v.id === "hooga-pro1500")!;
    // Listed at $649, which is under $700, but the price is a placeholder.
    expect(pro.price.money.amountMinor).toBeLessThan(70000);
    expect(pro.price.isDemo).toBe(true);
    expect(evaluateCondition(pro, redLight, budget[0])).toBe(false);
  });

  it("surfaces those products separately rather than hiding them", () => {
    const views = viewsFor("red-light");
    const apart = unconfirmedByPrice(views, redLight, budget);
    expect(apart.map((v) => v.id)).toContain("hooga-pro1500");
    // Everything listed apart genuinely has an unverified price.
    for (const v of apart) expect(v.price.isDemo).toBe(true);
  });

  it("still matches products whose price is verified", () => {
    const views = viewsFor("red-light");
    const mitomin = views.find((v) => v.id === "mito-mitomin-2")!;
    expect(mitomin.price.isDemo).toBe(false);
    expect(evaluateCondition(mitomin, redLight, budget[0])).toBe(true);
  });

  it("applies the same doubt to per-serving cost, which is derived from price", () => {
    const drinks = categoryById("wellness-drinks")!;
    const olipop = viewsFor("wellness-drinks").find((v) => v.id === "olipop-root-beer-12")!;
    expect(olipop.price.isDemo).toBe(true);
    expect(evaluateCondition(olipop, drinks, { key: "price_per_serving_minor", op: "lte", value: 1000 })).toBe(false);
  });

  it("leaves non-price conditions untouched", () => {
    const views = viewsFor("red-light");
    const pro = views.find((v) => v.id === "hooga-pro1500")!;
    expect(evaluateCondition(pro, redLight, { key: "coverage", op: "eq", value: "full_body" })).toBe(true);
  });
});
