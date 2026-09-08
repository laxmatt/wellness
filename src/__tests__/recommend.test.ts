import { describe, expect, it } from "vitest";
import { categoryById } from "@/domain/categories";
import { assignBadges, computeValue, deriveInsights, scoreProducts, toScoringInput } from "@/domain/recommend";
import type { Product } from "@/domain/product";
import { catalog, miniCategory, miniProduct, miniView, viewsFor } from "./fixtures";

const inputs = (ps: Product[]) => ps.map((p) => toScoringInput(miniView(p)));

describe("scoring", () => {
  it("normalizes by direction and treats missing as zero", () => {
    const ps = [
      miniProduct("a", 10000, { power: 100, noise: 10, size: "l", wifi: true }),
      miniProduct("b", 10000, { power: 50, noise: 40, size: "s", wifi: false }),
      miniProduct("c", 10000, { power: 75, size: "m" }),
    ];
    const s = scoreProducts(inputs(ps), miniCategory);
    const byId = Object.fromEntries(s.map((x) => [x.id, x]));
    expect(byId.a.score).toBe(100);
    expect(byId.b.score).toBe(0);
    const c = byId.c;
    expect(c.criteria.find((x) => x.key === "noise")!.normalized).toBe(0);
    expect(c.criteria.find((x) => x.key === "power")!.normalized).toBeCloseTo(0.5);
    expect(c.completeness).toBe(1);
    expect(c.eligible).toBe(true);
  });

  it("marks products below the completeness floor ineligible", () => {
    const ps = [miniProduct("a", 10000, { power: 100, size: "l" }), miniProduct("b", 10000, { noise: 5 })];
    const s = scoreProducts(inputs(ps), miniCategory);
    expect(s.find((x) => x.id === "b")!.eligible).toBe(false);
  });
});

describe("value formula", () => {
  const ps = [
    miniProduct("best", 100000, { power: 100, noise: 10, size: "l", wifi: true }),
    miniProduct("mid", 40000, { power: 90, noise: 15, size: "l", wifi: true }),
    miniProduct("cheap", 15000, { power: 80, noise: 20, size: "m", wifi: true }),
    miniProduct("junk", 5000, { power: 10, noise: 90, size: "s", wifi: false }),
  ];

  it("scores affordability 100 for the cheapest and 0 for the priciest, then blends by weight", () => {
    const ins = inputs(ps);
    const scores = scoreProducts(ins, miniCategory);
    const v = Object.fromEntries(computeValue(ins, scores, miniCategory).map((x) => [x.id, x]));
    expect(v.junk.affordability).toBe(100);
    expect(v.best.affordability).toBe(0);
    expect(v.best.value).toBeCloseTo(0.65 * 100, 1);
    expect(v.cheap.value).toBeCloseTo(0.65 * v.cheap.quality + 0.35 * v.cheap.affordability, 0);
  });

  it("is tunable: shifting weight to affordability moves the winner toward the cheaper product", () => {
    const ins = inputs(ps);
    const scores = scoreProducts(ins, miniCategory);
    const winner = (override: Parameters<typeof computeValue>[3]) =>
      computeValue(ins, scores, miniCategory, override)
        .filter((x) => x.eligible)
        .sort((a, b) => b.value - a.value)[0].id;
    expect(winner({ qualityWeight: 1, affordabilityWeight: 0 })).toBe("best");
    expect(winner({ qualityWeight: 0.4, affordabilityWeight: 0.6 })).toBe("cheap");
  });

  it("optional minQualityShare guard excludes weak products when enabled", () => {
    const ins = inputs(ps);
    const scores = scoreProducts(ins, miniCategory);
    const off = computeValue(ins, scores, miniCategory).find((x) => x.id === "junk")!;
    expect(off.eligible).toBe(true);
    const on = computeValue(ins, scores, miniCategory, { minQualityShare: 0.5 }).find((x) => x.id === "junk")!;
    expect(on.eligible).toBe(false);
  });

  it("supports an attribute price basis", () => {
    const cat = { ...miniCategory, value: { ...miniCategory.value, priceBasis: "attribute:noise" } };
    const ins = inputs(ps);
    const scores = scoreProducts(ins, cat);
    const v = computeValue(ins, scores, cat);
    expect(v.find((x) => x.id === "best")!.priceBasisValue).toBe(10);
  });
});

describe("badges", () => {
  it("stacks Best Value onto Best Overall when the same product wins both, and keeps tier badges exclusive", () => {
    const ps = [
      miniProduct("hero", 30000, { power: 100, noise: 10, size: "l", wifi: true }),
      miniProduct("pricey", 90000, { power: 90, noise: 15, size: "l", wifi: true }),
      miniProduct("pricier", 95000, { power: 85, noise: 15, size: "l", wifi: true }),
      miniProduct("cheap1", 15000, { power: 60, noise: 30, size: "s", wifi: false }),
      miniProduct("cheap2", 12000, { power: 55, noise: 35, size: "s", wifi: false }),
    ];
    const set = assignBadges(inputs(ps), miniCategory);
    expect(set.badgesByProduct.hero).toEqual(["best_overall", "best_value"]);
    expect(set.badgesByProduct.pricey).toEqual(["best_premium"]);
    expect(set.badgesByProduct.cheap1).toEqual(["best_budget"]);
    const tierHolders = set.badges.filter((b) => b.badge === "best_budget" || b.badge === "best_premium").map((b) => b.productId);
    expect(new Set(tierHolders).size).toBe(tierHolders.length);
  });

  it("withholds a tier badge when fewer than minQualifying products sit in the tier", () => {
    const ps = [
      miniProduct("a", 50000, { power: 100, size: "l" }),
      miniProduct("b", 50000, { power: 90, size: "m" }),
      miniProduct("only-cheap", 10000, { power: 50, size: "s" }),
    ];
    const set = assignBadges(inputs(ps), miniCategory);
    expect(set.badges.some((b) => b.badge === "best_budget")).toBe(false);
    expect(set.badges.some((b) => b.badge === "best_premium")).toBe(false);
  });

  it("breaks exact ties deterministically", () => {
    const ps = [miniProduct("z", 50000, { power: 100, size: "l" }), miniProduct("y", 50000, { power: 100, size: "l" })];
    const set = assignBadges(inputs(ps), miniCategory);
    expect(set.ranking).toEqual(["y", "z"]);
  });
});

describe("affiliate neutrality", () => {
  it("ranking and badges are identical when every offer's affiliate status flips", () => {
    const c = catalog();
    for (const cat of c.categories) {
      const base = viewsFor(cat.id);
      const flipped = viewsFor(
        cat.id,
        c.products.map((p) => ({
          ...p,
          offers: p.offers.map((o) => ({
            ...o,
            affiliate: { ...o.affiliate, status: o.affiliate.status === "affiliate" ? ("non_affiliate" as const) : ("affiliate" as const) },
          })),
        })),
      );
      const a = assignBadges(base.map(toScoringInput), cat);
      const b = assignBadges(flipped.map(toScoringInput), cat);
      expect(b.ranking).toEqual(a.ranking);
      expect(b.badges).toEqual(a.badges);
    }
  });

  it("ScoringInput carries no offer data", () => {
    const v = viewsFor("red-light")[0];
    const input = toScoringInput(v);
    expect(Object.keys(input).sort()).toEqual(["attributes", "id", "priceMinor"]);
  });
});

describe("review decisions", () => {
  it("caps warranty at 5 years inside scoring while the card shows the product's own warranty text", () => {
    const cat = categoryById("cold-plunge")!;
    const views = viewsFor("cold-plunge");
    const ib400 = views.find((v) => v.id === "ice-barrel-400")!;
    const renu = views.find((v) => v.id === "renu-cold-stoic-2")!;
    const scores = scoreProducts(views.map(toScoringInput), cat);
    const w = (id: string) => scores.find((s) => s.id === id)!.criteria.find((c) => c.key === "warranty_years")!;
    expect(w("ice-barrel-400").raw).toBe(5);
    expect(w("ice-barrel-400").normalized).toBe(w("renu-cold-stoic-2").normalized);
    expect(ib400.attributes.warranty_years).toBe(10);
    expect(ib400.cardSpecs.find((s) => s.key === "warranty_years")!.formatted).toBe("Lifetime warranty");
    expect(renu.cardSpecs.find((s) => s.key === "warranty_years")!.formatted).toBe("5-year limited warranty");
  });

  it("cold plunge value weights are 0.50 / 0.50 and Best Value no longer lands on the priciest tub", () => {
    const cat = categoryById("cold-plunge")!;
    expect(cat.value.qualityWeight).toBe(0.5);
    expect(cat.value.affordabilityWeight).toBe(0.5);
    const set = assignBadges(viewsFor("cold-plunge").map(toScoringInput), cat);
    expect(set.badges.find((b) => b.badge === "best_value")!.productId).not.toBe("renu-cold-stoic-2");
  });
});

describe("real catalog badges", () => {
  it("awards Best Overall in every category and withholds Best Budget in drinks (no product under $1 per serving)", () => {
    const c = catalog();
    for (const cat of c.categories) {
      const set = assignBadges(viewsFor(cat.id).map(toScoringInput), cat);
      expect(set.badges.some((b) => b.badge === "best_overall"), cat.id).toBe(true);
    }
    const drinks = assignBadges(viewsFor("wellness-drinks").map(toScoringInput), categoryById("wellness-drinks")!);
    expect(drinks.badges.some((b) => b.badge === "best_budget")).toBe(false);
  });
});

describe("derived insights", () => {
  it("fills templates from attributes and price", () => {
    const v = miniView(miniProduct("a", 15000, { power: 42, size: "s" }));
    const insights = deriveInsights(v, miniCategory);
    expect(insights.map((i) => i.text)).toEqual(["Under $200 with 42 of power."]);
  });

  it("does not fire irradiance copy with a missing distance placeholder", () => {
    const cat = categoryById("red-light")!;
    const v = viewsFor("red-light").find((x) => x.id === "joovv-solo-3")!;
    const texts = deriveInsights(v, cat).map((i) => i.text);
    expect(texts.some((t) => t.includes("at not stated"))).toBe(false);
    expect(texts.some((t) => t.includes("Measurement distance not stated"))).toBe(true);
  });
});
