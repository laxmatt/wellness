import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { wellnessDrinks } from "@/domain/categories";
import { evaluateCondition } from "@/domain/conditions";
import { classifyCondition } from "@/domain/needs";
import { isUsable } from "@/domain/provenance";
import type { Product } from "@/domain/product";
import { CATALOG_DIR } from "@/providers";
import { viewsFor } from "./fixtures";

// Caffeine is the weakest field on this site: four of six drinks hold no usable
// figure. These are rules, not a snapshot of which four. Every assertion below
// derives its expectation from the records themselves, so closing a gap makes
// the suite stronger rather than making it fail.

const drinks = (): Product[] =>
  readdirSync(join(CATALOG_DIR, "products"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CATALOG_DIR, "products", f), "utf8")) as Product)
    .filter((p) => p.categoryId === "wellness-drinks");

const usable = (p: Product) => {
  const c = p.attributes.caffeine_mg;
  return Boolean(c && c.value !== undefined && isUsable(c.verification) && c.disputed !== true);
};

const FREE = { key: "caffeine_mg", op: "eq" as const, value: 0 };
const CAFFEINATED = { key: "caffeine_mg", op: "gt" as const, value: 0 };

describe("what a caffeine record is allowed to say", () => {
  it("never carries a number it also says nobody stated", () => {
    for (const p of drinks()) {
      const c = p.attributes.caffeine_mg;
      if (c?.verification === "not_stated") expect(c.value, p.id).toBeUndefined();
    }
  });

  it("says why, on every record it cannot use", () => {
    for (const p of drinks().filter((x) => !usable(x))) {
      const note = p.attributes.caffeine_mg?.source.note;
      expect(note, p.id).toBeTruthy();
      // The gap is written as a gap. None of these may read as a finding of
      // zero, which is the inference this field exists to refuse.
      expect(note, p.id).toMatch(/does not state|no figure|no amount|not sourced|no caffeine figure/i);
    }
  });

  // A figure on one flavour's page belongs to that flavour. LMNT's page carries
  // a 50 mg FAQ figure for Lemonade Iced Tea, and the reading of 2026-09-09
  // deliberately left Citrus Salt's record alone rather than take it. Two
  // products citing one page for caffeine is how that rule breaks quietly.
  it("does not cite one page for two products' caffeine", () => {
    const byUrl = new Map<string, string[]>();
    for (const p of drinks()) {
      const url = p.attributes.caffeine_mg?.source.url;
      if (url) byUrl.set(url, [...(byUrl.get(url) ?? []), p.id]);
    }
    for (const [url, ids] of byUrl) expect(ids, url).toHaveLength(1);
  });
});

describe("an unconfirmed figure stays unconfirmed, in both directions", () => {
  const views = () => viewsFor("wellness-drinks");
  const view = (id: string) => views().find((v) => v.id === id)!;

  it("admits exactly the drinks whose own record states a usable zero", () => {
    const stated = drinks().filter((p) => usable(p) && p.attributes.caffeine_mg!.value === 0).map((p) => p.id).sort();
    const admitted = views().filter((v) => evaluateCondition(v, wellnessDrinks, FREE)).map((v) => v.id).sort();
    expect(admitted).toEqual(stated);
  });

  it("can neither clear nor convict a drink it holds no figure for", () => {
    const unplaceable = drinks().filter((p) => !usable(p));
    expect(unplaceable.length, "this test is about the gaps; there should be some").toBeGreaterThan(0);
    for (const p of unplaceable) {
      const v = view(p.id);
      expect(classifyCondition(v, wellnessDrinks, FREE), `${p.id} caffeine-free`).toBe("unknown");
      expect(classifyCondition(v, wellnessDrinks, CAFFEINATED), `${p.id} caffeinated`).toBe("unknown");
    }
  });

  it("keeps the withheld figure off the product page as well as out of the filter", () => {
    for (const p of drinks().filter((x) => !usable(x))) {
      const v = view(p.id);
      expect(v.attributes.caffeine_mg, p.id).toBeUndefined();
      expect(v.specs.find((s) => s.key === "caffeine_mg")?.raw, p.id).toBeUndefined();
    }
  });

  it("never classifies a drink the engine admits as anything but a match", () => {
    for (const v of views()) {
      for (const c of [FREE, CAFFEINATED]) {
        if (evaluateCondition(v, wellnessDrinks, c)) expect(classifyCondition(v, wellnessDrinks, c), v.id).toBe("match");
      }
    }
  });
});
