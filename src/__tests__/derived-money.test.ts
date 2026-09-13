import { describe, expect, it } from "vitest";
import { CategoryDefinition as CategorySchema } from "@/domain/category";
import { computeValue } from "@/domain/recommend/value";
import { scoreProducts, toScoringInput } from "@/domain/recommend/score";
import { manufacturer } from "@/domain/provenance";
import { evaluateCondition } from "@/domain/conditions";
import { applyPreferences } from "@/domain/personalization/match";
import { toProductView } from "@/domain/view";
import { miniCategory, miniProduct, testBrand, testMerchant, viewsFor } from "./fixtures";

// Two rules, and the line between them.
//
// A value computed from a placeholder price is worth what that price is worth,
// which is nothing. A value that merely happens to be money is not: a merchant
// might state a per-serving price directly, and throwing it away because a
// different figure on the same product is prototype data would be inventing a
// dependency nobody recorded.

const money = CategorySchema.parse({
  ...JSON.parse(JSON.stringify(miniCategory)),
  attributeDefinitions: [
    ...JSON.parse(JSON.stringify(miniCategory.attributeDefinitions)),
    { key: "cost_per_use_minor", label: "Cost per use", type: "integer", unit: "USD_minor", group: "g", compareOrder: 9, preferenceDirection: "lower_better" },
    { key: "shipping_minor", label: "Shipping", type: "integer", unit: "USD_minor", group: "g", compareOrder: 10, preferenceDirection: "lower_better" },
  ],
});

const view = (id: string, priceMinor: number, demoPrice: boolean) => {
  const p = miniProduct(id, priceMinor, { power: 50, size: "m" }, "unknown", [], demoPrice);
  const src = { url: "https://example.com", retrievedAt: "2026-09-08", unit: "USD_minor" };
  p.attributes.cost_per_use_minor = { ...manufacturer(120, { ...src, note: "Pack price divided by uses." }), derivedFrom: "price" as const };
  p.attributes.shipping_minor = manufacturer(499, { ...src, note: "Flat shipping, stated on the merchant's own page." });
  return toProductView(p, { category: money, brands: [testBrand], merchants: [testMerchant] });
};

describe("a value computed from a price is worth what the price is worth", () => {
  it("withholds the derived figure when the price is prototype data", () => {
    const v = view("demo-priced", 10000, true);
    expect(v.price.isDemo).toBe(true);
    expect(v.attributes.cost_per_use_minor).toBeUndefined();
    expect(v.specs.find((s) => s.key === "cost_per_use_minor")!.formatted).toBe("Check current price");
  });

  it("keeps a money figure that stands on its own source", () => {
    // The defect this replaces withheld every attribute in the money unit,
    // which assumed a derivation nobody had recorded.
    const v = view("demo-priced", 10000, true);
    expect(v.attributes.shipping_minor).toBe(499);
    expect(v.specs.find((s) => s.key === "shipping_minor")!.formatted).toBe("$4.99");
  });

  it("keeps both when the price is real", () => {
    const v = view("real-priced", 10000, false);
    expect(v.attributes.cost_per_use_minor).toBe(120);
    expect(v.attributes.shipping_minor).toBe(499);
  });

  it("marks a per-serving cost as derived only where it was computed here", () => {
    // Four of the six are the pack price divided by servings. Two are not:
    // LMNT states $1.50 a stick and Liquid I.V. states $1.56, both read from
    // the makers' own pages, so both stand on their sources rather than on a
    // pack price. Liquid I.V.'s was derived until 2026-09-09, and derived from
    // an Amazon amount recorded for a variety pack at that.
    const derived = viewsFor("wellness-drinks").filter((v) => v.provenance["attributes.price_per_serving_minor"]?.derivedFrom === "price");
    const stated = viewsFor("wellness-drinks").filter((v) => v.provenance["attributes.price_per_serving_minor"]?.derivedFrom === undefined);
    expect(derived.length).toBe(4);
    expect(stated.map((v) => v.id).sort()).toEqual(["liquid-iv-hydration-multiplier-16", "lmnt-citrus-salt-30"]);
    for (const v of stated) {
      expect(v.provenance["attributes.price_per_serving_minor"]?.verification, v.id).toBe("manufacturer_reported");
    }
  });
});

describe("a placeholder price cannot move a real product's affordability", () => {
  const real = [
    miniProduct("cheap", 10000, { power: 40, size: "m" }),
    miniProduct("dear", 30000, { power: 80, size: "l" }),
  ].map((p) => toProductView(p, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] }));
  // A placeholder priced far outside the real range: if it reached the
  // formula, it would move both ends of it.
  const placeholder = toProductView(miniProduct("invented", 500, { power: 60, size: "m" }, "unknown", [], true), {
    category: miniCategory,
    brands: [testBrand],
    merchants: [testMerchant],
  });

  const valuesFor = (views: typeof real) => {
    const inputs = views.map(toScoringInput);
    return computeValue(inputs, scoreProducts(inputs, miniCategory), miniCategory);
  };

  it("leaves every real product's value and affordability untouched", () => {
    const without = valuesFor(real);
    const with_ = valuesFor([...real, placeholder]);
    for (const id of ["cheap", "dear"]) {
      const a = without.find((v) => v.id === id)!;
      const b = with_.find((v) => v.id === id)!;
      expect({ id, value: b.value, affordability: b.affordability }).toEqual({ id, value: a.value, affordability: a.affordability });
    }
  });

  it("gives the placeholder-priced product no value, and says why", () => {
    const v = valuesFor([...real, placeholder]).find((x) => x.id === "invented")!;
    expect(v.eligible).toBe(false);
    expect(v.value).toBe(-Infinity);
    expect(v.reason).toMatch(/placeholder/);
  });
});

describe("a value derived from the price agrees with the price it is derived from", () => {
  it("holds for every drink whose per-serving cost is computed here", () => {
    // Liquid I.V. carried $1.56 a serving, computed from a prototype $24.99,
    // long after its real $27.99 became the shown price. A derived figure that
    // disagrees with its own basis is a wrong number with a citation.
    for (const v of viewsFor("wellness-drinks")) {
      const pps = v.attributes.price_per_serving_minor as number | undefined;
      const servings = v.attributes.servings_per_pack as number | undefined;
      const derived = v.provenance["attributes.price_per_serving_minor"]?.derivedFrom === "price";
      if (!derived || pps === undefined || servings === undefined) continue;
      expect(pps, v.id).toBe(Math.round(v.price.money!.amountMinor / servings));
    }
  });
});

describe("the money boundary follows provenance, not the unit", () => {
  // Same prototype pack price on both. One money figure says it was computed
  // from that price; the other stands on its own source. The first is
  // withheld, the second is a fact and stays one.
  const subject = () => {
    const p = miniProduct("prototype-priced", 10000, { power: 50, size: "m" }, "unknown", [], true);
    const src = { url: "https://example.com", retrievedAt: "2026-09-09", unit: "USD_minor" };
    p.attributes.cost_per_use_minor = { ...manufacturer(120, { ...src, note: "Pack price divided by uses." }), derivedFrom: "price" as const };
    p.attributes.shipping_minor = manufacturer(499, { ...src, note: "Flat shipping, stated by the merchant." });
    return toProductView(p, { category: money, brands: [testBrand], merchants: [testMerchant] });
  };

  it("keeps the independently sourced amount matchable", () => {
    const v = subject();
    expect(v.price.isDemo).toBe(true);
    expect(evaluateCondition(v, money, { key: "shipping_minor", op: "lte", value: 500 })).toBe(true);
    expect(evaluateCondition(v, money, { key: "shipping_minor", op: "eq", value: 499 })).toBe(true);
  });

  it("still withholds the one computed from the prototype price", () => {
    const v = subject();
    expect(evaluateCondition(v, money, { key: "cost_per_use_minor", op: "lte", value: 500 })).toBe(false);
    expect(evaluateCondition(v, money, { key: "cost_per_use_minor", op: "exists" })).toBe(false);
  });

  it("lets a preference rank on the independently sourced amount", () => {
    const cheapShipping = subject();
    const dearShipping = (() => {
      const p = miniProduct("dear-shipping", 10000, { power: 50, size: "m" }, "unknown", [], true);
      p.attributes.shipping_minor = manufacturer(1999, { url: "https://example.com", retrievedAt: "2026-09-09", unit: "USD_minor", note: "Flat shipping, stated by the merchant." });
      return toProductView(p, { category: money, brands: [testBrand], merchants: [testMerchant] });
    })();
    const rank = (views: ReturnType<typeof subject>[]) =>
      applyPreferences(views, money, {
        hard: [],
        soft: [{ key: "shipping_minor", direction: "prefer_low", weight: 1 }],
        unmapped: [],
        medicalIntent: false,
      });
    const without = rank([cheapShipping, dearShipping]);
    expect(without.rankedIds).toEqual(["prototype-priced", "dear-shipping"]);
    expect(without.explanations["prototype-priced"].softScore).toBeGreaterThan(0);

    // An extreme prototype price on a third product changes nothing about the
    // amounts that stand on their own sources.
    const extreme = (() => {
      const p = miniProduct("invented", 9_000_000, { power: 50, size: "m" }, "unknown", [], true);
      p.attributes.cost_per_use_minor = { ...manufacturer(1, { url: "https://example.com", retrievedAt: "2026-09-09", unit: "USD_minor", note: "Pack price divided by uses." }), derivedFrom: "price" as const };
      return toProductView(p, { category: money, brands: [testBrand], merchants: [testMerchant] });
    })();
    const withExtreme = rank([cheapShipping, dearShipping, extreme]);
    for (const id of ["prototype-priced", "dear-shipping"]) {
      expect(withExtreme.explanations[id].softScore, id).toBe(without.explanations[id].softScore);
    }
    expect(withExtreme.explanations.invented.softScore).toBe(0);
  });
});
