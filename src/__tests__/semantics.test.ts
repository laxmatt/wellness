import { describe, expect, it } from "vitest";
import { categories, categoryById } from "@/domain/categories";
import { buildCompareModel } from "@/domain/compare";
import { evaluateCondition, unconfirmedByPrice } from "@/domain/conditions";
import { assignBadges, recommendCategory, scoreProducts, toScoringInput } from "@/domain/recommend";
import { catalog, miniCategory, miniProduct, miniView, moneyCategory, moneyView, viewsFor } from "./fixtures";

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
    // Both price-tier badges are awarded again, each because a real price
    // arrived where a prototype one used to sit: HG300's $199 under the budget
    // line, PRO1500's $1,199 above the premium line, both read on 2026-09-09.
    // Nothing is withheld in this category now, and the reason text is still
    // required wherever something is.
    expect(set.badges.map((b) => b.badge).sort()).toEqual(["best_budget", "best_overall", "best_premium", "best_value"]);
    for (const w of set.withheld) expect(w.reason.length).toBeGreaterThan(20);
  });

  it("keeps Best Overall available, since it makes no claim about price", () => {
    const set = assignBadges(viewsFor("red-light").map(toScoringInput), redLight);
    expect(set.badges.some((b) => b.badge === "best_overall")).toBe(true);
  });

  it("a placeholder value can never raise a score", () => {
    // Built rather than found. This named whichever drink still carried
    // placeholder nutrition, and moved every time a page was read: OLIPOP's
    // sugar and calories are read figures now. The rule is not about OLIPOP.
    const best = miniProduct("real", 10000, { power: 100, noise: 10, size: "l", wifi: true });
    const placeheld = miniProduct("placeheld", 10000, { power: 100, noise: 10, size: "l", wifi: true }, "unknown", [
      "power",
      "noise",
      "size",
      "wifi",
    ]);
    const r = scoreProducts([best, placeheld].map((p) => toScoringInput(miniView(p))), miniCategory).find((x) => x.id === "placeheld")!;
    expect(r.demoCriteria).toEqual(expect.arrayContaining(["power", "noise", "size", "wifi"]));
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

  it("suppresses the winner when one source states its figure two ways", () => {
    // Built rather than found. No live pair reaches this branch any more: the
    // reason a row is unranked is checked in order, and the only two panels
    // that stated a measurement distance no longer both do. The rule is the
    // thing under test, not which products happen to trip it.
    const disputed = miniProduct("disputed", 20000, { power: 60, size: "m" });
    disputed.attributes.power!.disputed = true;
    disputed.attributes.power!.source.note = "Stated as 60 in one place and 80 in another.";
    const exact = miniProduct("exact", 20000, { power: 50, size: "m" });
    const model = buildCompareModel(
      recommendCategory([disputed, exact].map(miniView), miniCategory).products,
      miniCategory,
    );
    const row = model.groups.flatMap((g) => g.rows).find((r) => r.key === "power")!;
    expect(row.cells.every((c) => !c.best)).toBe(true);
    expect(row.notComparable).toMatch(/states its figure two ways/);
    expect(row.cells.some((c) => c.text.includes("60, disputed"))).toBe(true);
  });

  it("still marks a winner on a row of exact figures", () => {
    // Not a blanket refusal to rank: LED count is stated exactly by both.
    const model = buildCompareModel(items(["hooga-hg300", "platinumled-biomax-900"]), redLight);
    const row = model.groups.flatMap((g) => g.rows).find((r) => r.key === "led_count")!;
    expect(row.notComparable).toBeUndefined();
    expect(row.cells.filter((c) => c.best).length).toBe(1);
    expect(row.cells.findIndex((c) => c.best)).toBe(model.columns.findIndex((c) => c.id === "platinumled-biomax-900"));
  });

  it("never marks a winner in a row containing placeholder data", () => {
    // The spec half stays on the live catalogue, where BIOMAX's spectrum is
    // still prototype data. The price half is built, because which products
    // carry a prototype price changes as readings arrive.
    const model = buildCompareModel(items(["hooga-pro1500", "platinumled-biomax-900"]), redLight);
    const wavelengths = model.groups.flatMap((g) => g.rows).find((r) => r.key === "wavelengths_nm")!;
    // A neutral row carries no reason, because there is no better or worse
    // to withhold; it simply marks nothing.
    expect(wavelengths.cells.every((c) => !c.best)).toBe(true);

    const priced = miniView(miniProduct("real", 30000, { power: 50, size: "m" }));
    const unpriced = miniView(miniProduct("prototype", 10000, { power: 50, size: "m" }, "unknown", [], true));
    const built = buildCompareModel(recommendCategory([priced, unpriced], miniCategory).products, miniCategory);
    const price = built.groups[0].rows.find((r) => r.key === "price")!;
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
  // Built rather than found. This used whichever catalogue product still had a
  // prototype price, and moved every time a real one arrived, which tested the
  // catalogue rather than the rule.
  const priced = miniView(miniProduct("real", 30000, { power: 50, size: "m" }));
  const unpriced = miniView(miniProduct("prototype", 10000, { power: 50, size: "m" }, "unknown", [], true));
  const budget = { key: "price", op: "lte" as const, value: 20000 };

  it("cannot confirm an unverified price meets a budget", () => {
    // $100 is under the $200 limit, and it is not a price.
    expect(unpriced.price.money.amountMinor).toBeLessThan(budget.value);
    expect(unpriced.price.isDemo).toBe(true);
    expect(evaluateCondition(unpriced, miniCategory, budget)).toBe(false);
  });

  it("surfaces those products separately rather than hiding them", () => {
    const apart = unconfirmedByPrice([priced, unpriced], miniCategory, [budget]);
    expect(apart.map((v) => v.id)).toEqual(["prototype"]);
    for (const v of apart) expect(v.price.isDemo).toBe(true);
  });

  it("still matches products whose price is real", () => {
    expect(priced.price.isDemo).toBe(false);
    expect(evaluateCondition(priced, miniCategory, { key: "price", op: "lte", value: 40000 })).toBe(true);
  });

  it("applies the same doubt to a cost derived from that price", () => {
    // Same reason as above: the drink this named keeps becoming a read one.
    const view = moneyView("prototype-priced", 3588, true, { derived: 299 });
    expect(view.price.isDemo).toBe(true);
    expect(evaluateCondition(view, moneyCategory, { key: "cost_per_use_minor", op: "lte", value: 1000 })).toBe(false);
    // The amount beside it that stands on its own source still answers.
    expect(evaluateCondition(view, moneyCategory, { key: "shipping_minor", op: "lte", value: 1000 })).toBe(true);
  });

  it("leaves non-price conditions untouched", () => {
    const views = viewsFor("red-light");
    const pro = views.find((v) => v.id === "hooga-pro1500")!;
    expect(evaluateCondition(pro, redLight, { key: "coverage", op: "eq", value: "full_body" })).toBe(true);
  });
});
