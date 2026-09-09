import { describe, expect, it } from "vitest";
import { redLight, wellnessDrinks } from "@/domain/categories";
import type { CategoryDefinition, Condition } from "@/domain/category";
import { buildCompareModel } from "@/domain/compare";
import { evaluateCondition } from "@/domain/conditions";
import { buildFilterGroups } from "@/domain/filters";
import { applyPreferences } from "@/domain/personalization/match";
import { describeFit, describeGap } from "@/domain/personalization/describe";
import { deriveInsights } from "@/domain/recommend/insights";
import { recommendCategory } from "@/domain/recommend";
import { scoreProducts, toScoringInput } from "@/domain/recommend/score";
import { validateCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { CategoryDefinition as CategorySchema } from "@/domain/category";
import { toProductView } from "@/domain/view";
import { catalog, miniCategory, miniProduct, testBrand, testMerchant, viewsFor } from "./fixtures";

// A source that states a bound has not stated an amount.
//
// AG1's label says "less than 1 g total sugar" and the catalogue recorded 1.
// Four red-light panels state irradiance as "over" or "greater than" a figure
// and the catalogue recorded the figure. Every screen then printed an exact
// number nobody claimed, and every filter matched it as one: a shopper asking
// for exactly 1 g of sugar was shown AG1 as a product that has exactly 1 g.
//
// The bound is now carried with the value, through display and through
// matching. What a bound settles, it answers. What it does not settle, it
// declines, the same way a missing value declines.

const drinks = () => viewsFor("wellness-drinks");
const panels = () => viewsFor("red-light");
const ag1 = () => drinks().find((v) => v.id === "ag1-pouch-30")!;
// BON CHARGE's page states its irradiance once, as a floor. Hooga's two
// panels state theirs twice and disagree with themselves, so they are
// disputed rather than bounded and are not the example here.
const bonCharge = () => panels().find((v) => v.id === "bon-charge-max")!;

const ask = (view: ReturnType<typeof ag1>, cat: CategoryDefinition, c: Condition) => evaluateCondition(view, cat, c);

describe("the catalogue records the bound, not a number nobody stated", () => {
  it("carries AG1's sugar as a bound and the four irradiance floors as bounds", () => {
    const bounded: string[] = [];
    for (const p of catalog().products) {
      for (const [key, sv] of Object.entries(p.attributes)) {
        if (sv.bound) bounded.push(`${p.id}.${key} ${sv.bound} ${sv.value}`);
      }
    }
    // Two panels left. Hooga's HG300 and PRO1500 both left this list when
    // their own pages turned out to state the figure twice, once as a floor
    // and once as exact: those are disputed now, not bounded.
    // Back to three. The Ice Barrel 500's warranty was briefly recorded as
    // "more than 5 years", which was this catalogue's scoring cap dressed as a
    // manufacturer claim. A limited lifetime warranty names no number, so the
    // record now names none either.
    expect(bounded.sort()).toEqual([
      "ag1-pouch-30.sugar_g less_than 1",
      "bon-charge-max.irradiance_mw_cm2 greater_than 142",
      "joovv-solo-3.irradiance_mw_cm2 greater_than 100",
    ]);
  });

  it("keeps the whole catalogue valid", () => {
    expect(validateCatalog(catalog())).toEqual([]);
  });
});

describe("what a bound settles, and what it declines", () => {
  it("never answers a question about the exact amount", () => {
    // The defect, in one line: AG1 answered "sugar of exactly 1 g" as a fact.
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "eq", value: 1 })).toBe(false);
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "eq", value: 0 })).toBe(false);
    expect(ask(bonCharge(), redLight, { key: "irradiance_mw_cm2", op: "eq", value: 142 })).toBe(false);
  });

  it("answers the side of the bound the source settled", () => {
    // "Less than 1 g" is under 1 g, and under anything above 1 g.
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "lt", value: 1 })).toBe(true);
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "lte", value: 1 })).toBe(true);
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "lt", value: 5 })).toBe(true);
    // "Over 142" is over 142, and over anything below it.
    expect(ask(bonCharge(), redLight, { key: "irradiance_mw_cm2", op: "gt", value: 142 })).toBe(true);
    expect(ask(bonCharge(), redLight, { key: "irradiance_mw_cm2", op: "gte", value: 142 })).toBe(true);
    expect(ask(bonCharge(), redLight, { key: "irradiance_mw_cm2", op: "gt", value: 100 })).toBe(true);
  });

  it("declines the side the source left open", () => {
    // Somewhere below 1 g could be 0.9 or 0.1. Neither of these is known.
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "lt", value: 0.5 })).toBe(false);
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "gt", value: 0 })).toBe(false);
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "gte", value: 1 })).toBe(false);
    // Somewhere above 142 could be 190 or 400.
    expect(ask(bonCharge(), redLight, { key: "irradiance_mw_cm2", op: "gt", value: 200 })).toBe(false);
    expect(ask(bonCharge(), redLight, { key: "irradiance_mw_cm2", op: "lt", value: 300 })).toBe(false);
    expect(ask(bonCharge(), redLight, { key: "irradiance_mw_cm2", op: "lte", value: 142 })).toBe(false);
  });

  it("says a value differs only when the bound proves it differs", () => {
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "neq", value: 1 })).toBe(true);
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "neq", value: 4 })).toBe(true);
    // It could be 0.5. "Not 0.5" is not established.
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "neq", value: 0.5 })).toBe(false);
  });

  it("still knows the figure exists", () => {
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "exists" })).toBe(true);
    expect(ask(ag1(), wellnessDrinks, { key: "sugar_g", op: "missing" })).toBe(false);
  });

  it("leaves exact values alone", () => {
    const lmnt = drinks().find((v) => v.id === "lmnt-citrus-salt-30")!;
    expect(lmnt.attributes.sugar_g).toBe(0);
    expect(ask(lmnt, wellnessDrinks, { key: "sugar_g", op: "eq", value: 0 })).toBe(true);
    expect(ask(lmnt, wellnessDrinks, { key: "sugar_g", op: "lt", value: 1 })).toBe(true);
  });
});

describe("the qualifier survives to every screen", () => {
  it("formats the spec with the words the source used", () => {
    const sugar = ag1().specs.find((s) => s.key === "sugar_g")!;
    expect(sugar.formatted).toBe("less than 1 g");
    expect(sugar.bound).toBe("less_than");
    const irradiance = bonCharge().specs.find((s) => s.key === "irradiance_mw_cm2")!;
    expect(irradiance.formatted).toBe("more than 142 mW/cm²");
  });

  it("never renders the bare number as the value", () => {
    for (const v of [...drinks(), ...panels()]) {
      for (const key of Object.keys(v.bounds)) {
        const spec = v.specs.find((s) => s.key === key)!;
        expect(spec.formatted, `${v.id}.${key}`).toMatch(/^(less|more) than /);
      }
    }
  });

  it("marks no winner in a comparison row holding a bound", () => {
    const items = recommendCategory(panels(), redLight).products.filter((p) =>
      ["bon-charge-max", "platinumled-biomax-900"].includes(p.view.id),
    );
    const model = buildCompareModel(items, redLight);
    const row = model.groups.flatMap((g) => g.rows).find((r) => r.key === "irradiance_mw_cm2")!;
    expect(row.cells.map((c) => c.text)).toContain("more than 142 mW/cm²");
    expect(row.cells.every((c) => !c.best)).toBe(true);
    expect(row.notComparable).toBeTruthy();
  });

  it("does not offer a bound as an exact filter chip", () => {
    // No numeric attribute in the live catalogue is chip-filtered without
    // presets, so this is built rather than found: a range filter with no
    // presets lists the distinct stated values, and `=== value` would assert
    // an amount a bound does not state. Presets go through the same matching
    // as everything else and need no special case.
    const cat = CategorySchema.parse({
      ...JSON.parse(JSON.stringify(miniCategory)),
      filters: [{ key: "power", label: "Power", kind: "range" }],
    });
    const exact = miniProduct("exact", 10000, { power: 50, size: "m" });
    const floor = miniProduct("floor", 10000, { power: 50, size: "m" });
    floor.attributes.power!.bound = "greater_than";
    floor.attributes.power!.source.note = "Brand states over 50 W.";
    const views = [exact, floor].map((p) => toProductView(p, { category: cat, brands: [testBrand], merchants: [testMerchant] }));

    const group = buildFilterGroups(views, cat).find((g) => g.key === "power");
    // One product states 50 exactly and one states a floor of 50. A chip for
    // "50 W" may match the first and must not match the second.
    expect(group?.options.flatMap((o) => o.matchIds)).not.toContain("floor");
    expect(group?.options.some((o) => o.matchIds.includes("exact"))).toBe(true);
  });

  it("keeps the qualifier in the fit and gap sentences, and invents no distance from a limit", () => {
    const fit = describeFit(ag1(), wellnessDrinks, { key: "sugar_g", op: "lt", value: 5 });
    expect(fit).toContain("less than 1 g");
    expect(fit).not.toMatch(/\b4 g under\b/);
    const gap = describeGap(ag1(), wellnessDrinks, { key: "sugar_g", op: "eq", value: 0 });
    expect(gap.text).toContain("less than 1 g");
  });

  it("keeps the qualifier in derived editorial copy", () => {
    for (const v of panels()) {
      for (const insight of deriveInsights(v, redLight)) {
        if (v.bounds.irradiance_mw_cm2 !== undefined && /mW\/cm²/.test(insight.text)) {
          expect(insight.text, `${v.id}: ${insight.text}`).toMatch(/more than/);
        }
      }
    }
  });
});

describe("scoring reads the stated end, and the catalogue check keeps it that way", () => {
  it("scores the bound itself, which is the end that cannot flatter", () => {
    // "Over 142" scores as 142. The real figure is higher, so the product is
    // ranked no better than the maker's own floor. The reverse, a floor on a
    // lower-is-better figure, would rank a product on the best case of a range
    // whose worst case nobody stated, and the catalogue check refuses it.
    const inputs = panels().map(toScoringInput);
    const scored = scoreProducts(inputs, redLight).find((r) => r.id === "bon-charge-max")!;
    expect(bonCharge().attributes.irradiance_mw_cm2).toBe(142);
    expect(scored.criteria.find((c) => c.key === "irradiance_mw_cm2")!.raw).toBe(142);
    expect(scored.demoCriteria).not.toContain("irradiance_mw_cm2");
    expect(scored.disputedCriteria).not.toContain("irradiance_mw_cm2");
  });

  it("refuses a bound pointing the flattering way", () => {
    const c = catalog();
    const product = structuredClone(c.products.find((p) => p.id === "ag1-pouch-30")!);
    // Sugar is lower_better. "More than 1 g" would score as 1 g, the best case
    // of a range with no stated top.
    product.attributes.sugar_g!.bound = "greater_than";
    const issues = validateCatalog({ ...c, products: [...c.products.filter((p) => p.id !== "ag1-pouch-30"), product] });
    expect(issues.map((i) => i.message).join(" ")).toMatch(/flattering end/);
  });

  it("refuses a bound on a value that is not a fact, not a number, or has no note", () => {
    const c = catalog();
    const olipop = structuredClone(c.products.find((p) => p.id === "olipop-root-beer-12")!);
    olipop.attributes.caffeine_mg!.bound = "less_than";
    const demoIssues = validateCatalog({ ...c, products: [...c.products.filter((p) => p.id !== "olipop-root-beer-12"), olipop] });
    expect(demoIssues.map((i) => i.message).join(" ")).toMatch(/bound on a "demo" value/);

    const lmnt = structuredClone(c.products.find((p) => p.id === "lmnt-citrus-salt-30")!);
    lmnt.attributes.function!.bound = "less_than";
    const shapeIssues = validateCatalog({ ...c, products: [...c.products.filter((p) => p.id !== "lmnt-citrus-salt-30"), lmnt] });
    expect(shapeIssues.map((i) => i.message).join(" ")).toMatch(/value is not a number/);

    const boncharge = structuredClone(c.products.find((p) => p.id === "bon-charge-max")!);
    delete boncharge.attributes.irradiance_mw_cm2!.source.note;
    const noteIssues = validateCatalog({ ...c, products: [...c.products.filter((p) => p.id !== "bon-charge-max"), boncharge] });
    expect(noteIssues.map((i) => i.message).join(" ")).toMatch(/bound with no source note/);
  });
});

describe("a preference cannot read a bound as an amount either", () => {
  const prefer = (view: string, soft: { key: string; direction: "prefer_high" | "prefer_low" | "prefer_value"; value?: number; weight?: number }) => {
    const result = applyPreferences(drinks(), wellnessDrinks, {
      hard: [],
      soft: [{ weight: 0.5, ...soft }],
      unmapped: [],
      medicalIntent: false,
    });
    return result.explanations[view];
  };

  it("does not count a bound as meeting a named amount", () => {
    // "Ideally 1 g of sugar" against a label that says less than 1 g. The
    // shopper named an amount; the source did not.
    const e = prefer("ag1-pouch-30", { key: "sugar_g", direction: "prefer_value", value: 1 });
    expect(e.misses.join(" ")).toContain("less than 1 g");
    expect(e.fits).toEqual([]);
    expect(e.softScore).toBe(0);
  });

  it("counts a bound as meeting an amount the bound settles", () => {
    // "Ideally under 5 g" is settled by "less than 1 g".
    const e = prefer("ag1-pouch-30", { key: "sugar_g", direction: "prefer_low", value: 5 });
    expect(e.fits.join(" ")).toContain("less than 1 g");
    expect(e.softScore).toBeGreaterThan(0);
  });

  it("declines an amount on the side the bound leaves open", () => {
    const e = prefer("ag1-pouch-30", { key: "sugar_g", direction: "prefer_low", value: 0.5 });
    expect(e.fits).toEqual([]);
    expect(e.softScore).toBe(0);
  });

  it("ranks a bound by its endpoint only when the endpoint is the worse end", () => {
    // "Prefer less sugar", no amount. AG1's endpoint is 1, and the real figure
    // is below it, so ranking by 1 can only understate the product.
    const low = prefer("ag1-pouch-30", { key: "sugar_g", direction: "prefer_low" });
    expect(low.softScore).toBeGreaterThan(0);

    // "Prefer more sugar", no amount. The endpoint is the best case of a range
    // whose bottom nobody stated, so nothing is credited.
    const high = prefer("ag1-pouch-30", { key: "sugar_g", direction: "prefer_high" });
    expect(high.softScore).toBe(0);
    expect(high.fits).toEqual([]);
  });

  it("leaves an exact value ranked as before", () => {
    const lmnt = prefer("lmnt-citrus-salt-30", { key: "sugar_g", direction: "prefer_value", value: 0 });
    expect(lmnt.fits.join(" ")).toContain("Total sugar");
    expect(lmnt.softScore).toBeGreaterThan(0);
  });
});
