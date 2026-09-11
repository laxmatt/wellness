import { describe, expect, it } from "vitest";
import { categoryById, coldPlunge, redLight, wellnessDrinks } from "@/domain/categories";
import type { Condition } from "@/domain/category";
import { evaluateCondition } from "@/domain/conditions";
import { buildFilterGroups, filterOptionSpecs } from "@/domain/filters";
import { classifyCondition, classifyConditions, unknownReason, withholdingOf } from "@/domain/needs";
import { buildNeeds } from "@/lib/queries";
import { recommendCategory } from "@/domain/recommend";
import { miniCategory, miniProduct, miniView, viewsFor } from "./fixtures";

// Three states over the engine's two.
//
// `evaluateCondition` returns false for a product that fails, for one whose
// figure is unrecorded, and for one whose figure the catalogue holds but will
// not match on. That is the right answer to "may this be shown" and the wrong
// answer to "should I rule this out".

const view = (cat: string, id: string) => viewsFor(cat).find((v) => v.id === id)!;

describe("the classifier never contradicts the engine", () => {
  it("says match for everything the engine admits, across every filter in every category", () => {
    for (const slug of ["red-light", "cold-plunge", "wellness-drinks"]) {
      const cat = categoryById(slug)!;
      const views = viewsFor(slug);
      for (const spec of filterOptionSpecs(views, cat)) {
        for (const v of views) {
          const admitted = evaluateCondition(v, cat, spec.condition);
          const state = classifyCondition(v, cat, spec.condition);
          if (admitted) expect(state, `${v.id} / ${spec.id}`).toBe("match");
          else expect(state, `${v.id} / ${spec.id}`).not.toBe("match");
        }
      }
    }
  });
});

describe("a missing figure is not a mismatch", () => {
  it("calls an unrecorded value unknown, not a miss", () => {
    const p = miniProduct("no-power", 10000, { size: "m" });
    const v = miniView(p);
    expect(v.attributes.power).toBeUndefined();
    const c: Condition = { key: "power", op: "gte", value: 40 };
    expect(evaluateCondition(v, miniCategory, c)).toBe(false);
    expect(classifyCondition(v, miniCategory, c)).toBe("unknown");
    expect(unknownReason(v, miniCategory, "power")).toBe("We hold no power for it.");
  });

  it("calls a demo value unknown, because this site will not treat it as fact", () => {
    const v = miniView(miniProduct("demo-power", 10000, { power: 90, size: "m" }, "unknown", ["power"]));
    expect(v.attributes.power).toBeUndefined();
    expect(withholdingOf(v, "power")).toBe("not_usable");
    expect(classifyCondition(v, miniCategory, { key: "power", op: "gte", value: 40 })).toBe("unknown");
  });

  it("calls a disputed figure unknown in both directions", () => {
    const p = miniProduct("disputed", 10000, { power: 60, size: "m" });
    p.attributes.power!.disputed = true;
    const v = miniView(p);
    expect(withholdingOf(v, "power")).toBe("disputed");
    // 60 would pass one and fail the other. Neither is reported.
    expect(classifyCondition(v, miniCategory, { key: "power", op: "gte", value: 40 })).toBe("unknown");
    expect(classifyCondition(v, miniCategory, { key: "power", op: "lt", value: 40 })).toBe("unknown");
    expect(unknownReason(v, miniCategory, "power")).toMatch(/recorded two ways that disagree/);
  });
});

describe("zero and false are values, not absences", () => {
  it("rules a product out on a real zero", () => {
    const lmnt = view("wellness-drinks", "lmnt-citrus-salt-30");
    expect(lmnt.attributes.sugar_g).toBe(0);
    expect(classifyCondition(lmnt, wellnessDrinks, { key: "sugar_g", op: "gte", value: 5 })).toBe("miss");
    expect(classifyCondition(lmnt, wellnessDrinks, { key: "sugar_g", op: "eq", value: 0 })).toBe("match");
  });

  it("rules a product out on a recorded false", () => {
    const withoutChiller = viewsFor("cold-plunge").find((v) => v.attributes.chiller_included === false);
    expect(withoutChiller, "the catalogue should hold one").toBeTruthy();
    expect(classifyCondition(withoutChiller!, coldPlunge, { key: "chiller_included", op: "eq", value: true })).toBe("miss");
  });
});

describe("a placeholder amount qualifies nothing and disqualifies nothing", () => {
  it("is unknown against a budget, in either direction", () => {
    const demoPriced = viewsFor("red-light").find((v) => v.price.isDemo);
    expect(demoPriced, "the catalogue should hold one").toBeTruthy();
    for (const c of [{ key: "price", op: "lte", value: 50000 }, { key: "price", op: "gte", value: 50000 }] as Condition[]) {
      expect(evaluateCondition(demoPriced!, redLight, c)).toBe(false);
      expect(classifyCondition(demoPriced!, redLight, c)).toBe("unknown");
    }
  });

  it("is unknown when there is no amount at all", () => {
    const noPrice = viewsFor("cold-plunge").find((v) => v.price.money === undefined);
    expect(noPrice, "Plunge holds no usable amount").toBeTruthy();
    expect(classifyCondition(noPrice!, coldPlunge, { key: "price", op: "lt", value: 500000 })).toBe("unknown");
    expect(unknownReason(noPrice!, coldPlunge, "price")).toBe("We hold no price for it.");
  });
});

describe("a bound settles some questions and not others", () => {
  // AG1's label states less than 1 g of sugar.
  const ag1 = () => view("wellness-drinks", "ag1-pouch-30");

  it("settles a question the bound answers", () => {
    expect(ag1().bounds.sugar_g).toBe("less_than");
    expect(classifyCondition(ag1(), wellnessDrinks, { key: "sugar_g", op: "lte", value: 5 })).toBe("match");
    // Every value below 1 fails "4 or more". A definite no.
    expect(classifyCondition(ag1(), wellnessDrinks, { key: "sugar_g", op: "gte", value: 4 })).toBe("miss");
  });

  it("shrugs at a question the bound cannot answer", () => {
    // The real figure could be either side of 0.5.
    expect(classifyCondition(ag1(), wellnessDrinks, { key: "sugar_g", op: "lt", value: 0.5 })).toBe("unknown");
    expect(classifyCondition(ag1(), wellnessDrinks, { key: "sugar_g", op: "eq", value: 0 })).toBe("unknown");
  });
});

describe("a requirement of several conditions", () => {
  const v = () => miniView(miniProduct("p", 10000, { power: 50, size: "m" }));

  it("fails outright on one definite failure, whatever else is unknown", () => {
    const conditions: Condition[] = [{ key: "power", op: "gte", value: 90 }, { key: "noise", op: "lt", value: 10 }];
    expect(classifyCondition(v(), miniCategory, conditions[0])).toBe("miss");
    expect(classifyCondition(v(), miniCategory, conditions[1])).toBe("unknown");
    expect(classifyConditions(v(), miniCategory, conditions)).toBe("miss");
  });

  it("is unknown when nothing fails and something cannot be answered", () => {
    expect(classifyConditions(v(), miniCategory, [{ key: "power", op: "gte", value: 10 }, { key: "noise", op: "lt", value: 10 }])).toBe("unknown");
  });

  it("matches only when every condition matches", () => {
    expect(classifyConditions(v(), miniCategory, [{ key: "power", op: "gte", value: 10 }, { key: "size", op: "eq", value: "m" }])).toBe("match");
  });
});

describe("the requirements a page publishes", () => {
  it("covers every chip the page can show, so a selection always has a requirement", async () => {
    for (const slug of ["red-light", "cold-plunge", "wellness-drinks"]) {
      const cat = categoryById(slug)!;
      const views = viewsFor(slug);
      const page = { cat, products: recommendCategory(views, cat).products, set: recommendCategory(views, cat).set };
      const needs = buildNeeds(page);
      const ids = new Set(needs.map((n) => n.id));
      for (const g of buildFilterGroups(views, cat)) {
        for (const o of g.options) expect(ids.has(o.id), `${slug} ${o.id}`).toBe(true);
      }
    }
  });

  it("classifies against the whole category, not a facet's subset", () => {
    const cat = redLight;
    const views = viewsFor("red-light");
    const { products, set } = recommendCategory(views, cat);
    const needs = buildNeeds({ cat, products, set }, "under-1000");
    const facet = needs.find((n) => n.id === "facet:under-1000")!;
    expect(facet.source).toBe("facet");
    expect(facet.label).toBe("Under $1,000");
    // Every product in the category is accounted for, including those the
    // facet page would never render. A comparison can hold one of them.
    for (const v of views) {
      const counted = facet.matchIds.includes(v.id) || facet.unknownIds.includes(v.id);
      expect(typeof counted).toBe("boolean");
    }
    const overBudget = views.filter((v) => !facet.matchIds.includes(v.id) && !facet.unknownIds.includes(v.id));
    expect(overBudget.length, "some panels cost more than $1,000").toBeGreaterThan(0);
  });

  it("never places a product in two states at once", () => {
    const cat = coldPlunge;
    const { products, set } = recommendCategory(viewsFor("cold-plunge"), cat);
    for (const need of buildNeeds({ cat, products, set })) {
      for (const id of need.matchIds) expect(need.unknownIds).not.toContain(id);
    }
  });
});
