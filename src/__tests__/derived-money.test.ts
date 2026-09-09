import { describe, expect, it } from "vitest";
import { CategoryDefinition as CategorySchema } from "@/domain/category";
import { computeValue } from "@/domain/recommend/value";
import { scoreProducts, toScoringInput } from "@/domain/recommend/score";
import { manufacturer } from "@/domain/provenance";
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
    // Five of the six are the pack price divided by servings. LMNT's is not:
    // its maker states $1.50 a stick on the product page, read on 2026-09-09,
    // so it stands on that source rather than on the pack price.
    const derived = viewsFor("wellness-drinks").filter((v) => v.provenance["attributes.price_per_serving_minor"]?.derivedFrom === "price");
    const stated = viewsFor("wellness-drinks").filter((v) => v.provenance["attributes.price_per_serving_minor"]?.derivedFrom === undefined);
    expect(derived.length).toBe(5);
    expect(stated.map((v) => v.id)).toEqual(["lmnt-citrus-salt-30"]);
    expect(stated[0].provenance["attributes.price_per_serving_minor"]?.verification).toBe("manufacturer_reported");
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
