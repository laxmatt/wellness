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

  it("keeps the cheapest admitted product at its full score ratio and charges the best for price", () => {
    const ins = inputs(ps);
    const scores = scoreProducts(ins, miniCategory);
    const v = Object.fromEntries(computeValue(ins, scores, miniCategory).map((x) => [x.id, x]));
    expect(v.cheap.relPrice).toBe(0);
    expect(v.cheap.value).toBeCloseTo(v.cheap.scoreRatio, 3);
    expect(v.best.relPrice).toBe(1);
    expect(v.best.value).toBeCloseTo(v.best.scoreRatio - 1, 3);
  });

  it("excludes products below minScoreShare so cheapness alone cannot win", () => {
    const ins = inputs(ps);
    const scores = scoreProducts(ins, miniCategory);
    const v = Object.fromEntries(computeValue(ins, scores, miniCategory).map((x) => [x.id, x]));
    expect(v.junk.eligible).toBe(false);
    expect(v.junk.reason).toMatch(/below 50%/);
  });

  it("is tunable: raising priceWeight moves the winner toward the cheaper product", () => {
    const ins = inputs(ps);
    const scores = scoreProducts(ins, miniCategory);
    const winner = (override: Parameters<typeof computeValue>[3]) =>
      computeValue(ins, scores, miniCategory, override)
        .filter((x) => x.eligible)
        .sort((a, b) => b.value - a.value)[0].id;
    expect(winner({ priceWeight: 0 })).toBe("best");
    expect(winner({ priceWeight: 3 })).toBe("cheap");
  });

  it("supports an attribute price basis", () => {
    const cat = { ...miniCategory, value: { ...miniCategory.value, priceBasis: "attribute:noise", priceScale: "linear" as const } };
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
