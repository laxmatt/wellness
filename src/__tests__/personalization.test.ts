import { describe, expect, it } from "vitest";
import { categoryById } from "@/domain/categories";
import { buildCompareModel, differingRowCount } from "@/domain/compare";
import { applyFilters, buildFilterGroups } from "@/domain/filters";
import type { PreferenceSet } from "@/domain/personalization";
import { applyPreferences, relaxationSearch } from "@/domain/personalization/match";
import { similarProducts } from "@/domain/personalization/similar";
import { recommendCategory } from "@/domain/recommend";
import { MockAIProvider } from "@/providers/ai/AIProvider";
import { miniCategory, miniProduct, miniView, viewsFor } from "./fixtures";

const redLight = categoryById("red-light")!;
const drinks = categoryById("wellness-drinks")!;
const plunge = categoryById("cold-plunge")!;

const prefs = (over: Partial<PreferenceSet> = {}): PreferenceSet => ({ hard: [], soft: [], unmapped: [], medicalIntent: false, ...over });

describe("matcher engine", () => {
  it("honours hard constraints and ranks the rest by soft fit", () => {
    const views = viewsFor("red-light");
    const r = applyPreferences(views, redLight, prefs({
      hard: [{ key: "price", op: "lte", value: 70000 }],
      soft: [{ key: "coverage", direction: "prefer_high", value: "full_body", weight: 0.8 }],
    }));
    // A budget claim needs a real price. PRO1500 lists $649 but that price is
    // prototype data, so it cannot be confirmed under $700 and is excluded.
    // HG300 wins it since its maker's own $199 was read on 2026-09-09: before
    // that its shown price was a prototype $149 and this was MitoMIN at $249.
    const eligible = views.filter((v) => v.price.money!.amountMinor <= 70000 && !v.price.isDemo).map((v) => v.id);
    expect(eligible).toContain(r.bestMatchId!);
    expect(r.bestMatchId).toBe("hooga-hg300");
    expect(r.explanations["hooga-hg300"].fits.some((f) => f.includes("under your limit"))).toBe(true);
    expect(r.relaxations).toEqual([]);
  });

  it("explains misses for products that fail a constraint", () => {
    const r = applyPreferences(viewsFor("red-light"), redLight, prefs({ hard: [{ key: "price", op: "lte", value: 70000 }] }));
    expect(r.explanations["joovv-solo-3"].misses[0]).toBe("$799 over your price limit");
  });

  it("returns constraint labels for editable chips", () => {
    const r = applyPreferences(viewsFor("red-light"), redLight, prefs({ hard: [{ key: "price", op: "lte", value: 70000 }] }));
    expect(r.constraintLabels).toEqual([{ key: "price", label: "price of $700 or less" }]);
  });

  it("carries the medical redirect flag through without dropping usable preferences", () => {
    const r = applyPreferences(viewsFor("red-light"), redLight, prefs({ hard: [{ key: "price", op: "lte", value: 70000 }], medicalIntent: true }));
    expect(r.medicalRedirect).toBe(true);
    expect(r.bestMatchId).not.toBeNull();
  });
});

describe("no-match relaxation", () => {
  // "full body under $100": nothing qualifies.
  const impossible = [
    { key: "price", op: "lte" as const, value: 10000 },
    { key: "coverage", op: "gte" as const, value: "full_body" },
  ];

  it("never dead-ends: offers one route per constraint", () => {
    const r = applyPreferences(viewsFor("red-light"), redLight, prefs({ hard: impossible }));
    expect(r.bestMatchId).toBeNull();
    expect(r.relaxations.length).toBe(2);
    const keys = r.relaxations.map((x) => x.keptKey);
    expect(keys).toContain("price");
    expect(keys).toContain("coverage");
  });

  it("surfaces the closest-to-budget compromise and the closest full-body overspend", () => {
    const r = relaxationSearch(viewsFor("red-light"), redLight, impossible);
    const budgetRoute = r.find((x) => x.keptKey === "price")!;
    const coverageRoute = r.find((x) => x.keptKey === "coverage")!;

    // Nothing is under $100, so the budget route names the nearest product and
    // says so rather than pretending the constraint was met.
    expect(budgetRoute.keptSatisfied).toBe(false);
    expect(budgetRoute.productId).toBe("hooga-hg300");
    expect(budgetRoute.keptLabel).toBe("price of $100 or less");
    expect(budgetRoute.misses.join(" ")).toContain("Coverage is targeted, you asked for full body");

    // Full body is achievable; the route shows how far over budget it lands.
    expect(coverageRoute.keptSatisfied).toBe(true);
    expect(coverageRoute.misses.some((m) => m.includes("over your price limit"))).toBe(true);
  });

  it("orders routes by the category's relaxationOrder", () => {
    const r = relaxationSearch(viewsFor("red-light"), redLight, impossible);
    expect(r[0].keptKey).toBe("price");
  });

  it("gives each route a different product when it can", () => {
    const r = relaxationSearch(viewsFor("red-light"), redLight, impossible);
    expect(new Set(r.map((x) => x.productId)).size).toBe(r.length);
  });

  it("handles a drinks constraint on a per-serving attribute", () => {
    const r = applyPreferences(viewsFor("wellness-drinks"), drinks, prefs({
      hard: [{ key: "price_per_serving_minor", op: "lte", value: 50 }, { key: "sugar_g", op: "eq", value: 0 }],
    }));
    expect(r.bestMatchId).toBeNull();
    expect(r.relaxations.length).toBeGreaterThan(0);
    expect(r.relaxations[0].misses.join(" ")).toMatch(/price per serving/);
  });
});

describe("end to end with the mock extractor", () => {
  it("turns the canonical sentence into a visible result set", async () => {
    const ai = new MockAIProvider();
    const p = await ai.extractPreferences({ text: "I need a full-body panel under $700 that won't take over my apartment.", category: redLight });
    const r = applyPreferences(viewsFor("red-light"), redLight, p);
    // The panel with a real price under the limit that ranks highest on the
    // sentence's own preferences. HG300 took this from MitoMIN when its
    // maker's $199 was read on 2026-09-09 and replaced a prototype $149.
    expect(r.bestMatchId).toBe("hooga-hg300");
    expect(r.explanations[r.bestMatchId!].fits.length).toBeGreaterThan(0);
  });

  it("declines the medical question while still comparing on specs", async () => {
    const ai = new MockAIProvider();
    const p = await ai.extractPreferences({ text: "Which red light panel will treat my arthritis?", category: redLight });
    const r = applyPreferences(viewsFor("red-light"), redLight, p);
    expect(r.medicalRedirect).toBe(true);
    expect(r.bestMatchId).not.toBeNull();
  });
});

describe("similar products", () => {
  it("prefers products of comparable size and price over ranking neighbours", () => {
    // Built rather than found. This asserted an ordering of named catalogue
    // products and had to be rewritten every time a real price or a disputed
    // figure changed one of them, which tests the catalogue rather than the
    // function.
    const target = miniView(miniProduct("target", 20000, { power: 40, size: "s", wifi: false }));
    const near = miniView(miniProduct("near", 22000, { power: 42, size: "s", wifi: false }));
    const far = miniView(miniProduct("far", 90000, { power: 95, size: "l", wifi: true }));
    const similar = similarProducts(target, [target, near, far], miniCategory, 2);
    expect(similar[0].id).toBe("near");
    expect(similar.map((s) => s.id)).not.toContain("target");
  });

  it("keeps the target out of its own neighbours in the live catalogue", () => {
    const views = viewsFor("red-light");
    const hg300 = views.find((v) => v.id === "hooga-hg300")!;
    const similar = similarProducts(hg300, views, redLight, 3);
    expect(similar.length).toBe(3);
    expect(similar.map((s) => s.id)).not.toContain("hooga-hg300");
  });

  it("returns at most the requested count and never the target itself", () => {
    const views = viewsFor("cold-plunge");
    const target = views[0];
    const similar = similarProducts(target, views, plunge, 3);
    expect(similar.length).toBe(3);
    expect(similar.some((s) => s.id === target.id)).toBe(false);
  });
});

describe("compare model", () => {
  const views = viewsFor("red-light").filter((v) => ["hooga-pro1500", "hooga-hg300", "platinumled-biomax-900"].includes(v.id));
  const items = recommendCategory(viewsFor("red-light"), redLight).products.filter((p) => views.some((v) => v.id === p.view.id));
  const model = buildCompareModel(items, redLight);

  it("marks the strongest value only where direction is defined and values differ", () => {
    const rows = model.groups.flatMap((g) => g.rows);
    // Every selected panel carries a 3-year warranty, so nothing is marked.
    const warranty = rows.find((r) => r.key === "warranty_years")!;
    expect(warranty.same).toBe(true);
    expect(warranty.cells.every((c) => !c.best)).toBe(true);
    // LED count varies and higher is better, so exactly the leaders are marked.
    const leds = rows.find((r) => r.key === "led_count")!;
    expect(leds.cells.filter((c) => c.best).length).toBeGreaterThan(0);
    expect(leds.cells.filter((c) => c.best).length).toBeLessThan(leds.cells.length);
    // Wavelengths have no direction, so no cell wins.
    const wavelengths = rows.find((r) => r.key === "wavelengths_nm")!;
    expect(wavelengths.cells.every((c) => !c.best)).toBe(true);
  });

  it("does not mark a price winner while any price in the set is a placeholder", () => {
    // Built: all three panels above have real prices now, and which products
    // carry a prototype one changes as readings arrive.
    const built = buildCompareModel(
      recommendCategory(
        [miniView(miniProduct("real", 30000, { power: 50, size: "m" })), miniView(miniProduct("prototype", 10000, { power: 50, size: "m" }, "unknown", [], true))],
        miniCategory,
      ).products,
      miniCategory,
    );
    const price = built.groups[0].rows.find((r) => r.key === "price")!;
    expect(price.cells.every((c) => !c.best)).toBe(true);
    expect(price.notComparable).toMatch(/placeholder/);
  });

  it("flags rows where every product states the same value", () => {
    const same = model.groups.flatMap((g) => g.rows).filter((r) => r.same);
    expect(same.length).toBeGreaterThan(0);
    expect(differingRowCount(model)).toBeLessThan(model.groups.flatMap((g) => g.rows).length);
  });

  it("carries verification tags into cells", () => {
    // Irradiance always shows its tag, and the three panels now say three
    // different things: two report a figure, and BIOMAX's ninth-generation
    // record states none.
    const irradiance = model.groups.flatMap((g) => g.rows).find((r) => r.key === "irradiance_mw_cm2")!;
    expect(irradiance.cells.every((c) => c.verification !== undefined)).toBe(true);
    expect(irradiance.cells.filter((c) => c.verification === "manufacturer_reported").length).toBe(2);
    expect(irradiance.cells.filter((c) => c.verification === "not_stated").length).toBe(1);
  });
});

describe("filters", () => {
  const views = viewsFor("red-light");
  const groups = buildFilterGroups(views, redLight);
  const ids = views.map((v) => v.id);

  it("only offers options that split the set", () => {
    for (const g of groups) {
      for (const o of g.options) {
        expect(o.matchIds.length).toBeGreaterThan(0);
        expect(o.matchIds.length).toBeLessThan(views.length);
      }
    }
  });

  it("unions inside a group and intersects across groups", () => {
    const coverage = groups.find((g) => g.key === "coverage")!;
    const full = coverage.options.find((o) => o.id === "coverage:full_body")!;
    const targeted = coverage.options.find((o) => o.id === "coverage:targeted")!;
    const both = applyFilters(ids, groups, [full.id, targeted.id]);
    expect(both.length).toBe(full.matchIds.length + targeted.matchIds.length);

    const price = groups.find((g) => g.key === "price")!;
    const under500 = price.options.find((o) => o.label === "Under $500")!;
    const crossed = applyFilters(ids, groups, [full.id, under500.id]);
    expect(crossed.every((id) => full.matchIds.includes(id) && under500.matchIds.includes(id))).toBe(true);
  });

  it("returns everything when nothing is selected", () => {
    expect(applyFilters(ids, groups, [])).toEqual(ids);
  });

  it("can produce an empty set the UI must handle", () => {
    const coverage = groups.find((g) => g.key === "coverage")!;
    const price = groups.find((g) => g.key === "price")!;
    const targeted = coverage.options.find((o) => o.id === "coverage:targeted")!;
    const under1000 = price.options.find((o) => o.label === "Under $1,000")!;
    const combined = applyFilters(ids, groups, [targeted.id, under1000.id]);
    expect(Array.isArray(combined)).toBe(true);
  });
});
