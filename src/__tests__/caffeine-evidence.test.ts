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

  // There was a rule here forbidding two products from citing one page. It was
  // the wrong test for the right worry. What must not happen is a figure moving
  // between flavours, and a shared URL is not that: a maker's page about
  // caffeine can state a figure for its whole range, and OLIPOP's does. A
  // uniqueness check would have refused the best evidence this field has.
  //
  // The worry itself stays, in the note. A record citing a page that covers
  // several products has to say how that page reaches this one.
  it("says how a shared page reaches this product", () => {
    const byUrl = new Map<string, string[]>();
    for (const p of drinks()) {
      const url = p.attributes.caffeine_mg?.source.url;
      if (url) byUrl.set(url, [...(byUrl.get(url) ?? []), p.id]);
    }
    for (const [url, ids] of byUrl) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        const note = drinks().find((p) => p.id === id)!.attributes.caffeine_mg!.source.note ?? "";
        expect(note, `${id} cites ${url}, shared with ${ids.filter((x) => x !== id).join(", ")}`).toMatch(
          /flavour|flavor|variant|range|rest of|every remaining|this product/i,
        );
      }
    }
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

describe("a record may not claim the maker while citing a retailer", () => {
  const RETAILER = /\b(amazon|walmart|target|ebay)\./i;

  // Open defect, named rather than hidden. The Cold Pod's record cites one
  // Amazon listing as the manufacturer for four specifications. It is the same
  // fault CELSIUS carried until its maker's page was read on 2026-09-11, and it
  // needs the same fix: a reading, not a relabel. Removing an entry from this
  // list is how that fix announces itself.
  const KNOWN_OPEN: Record<string, string[]> = {
    "the-cold-pod-88": ["chiller_included", "water_capacity_gal", "fits_height_in", "insulated"],
  };

  it("holds for every attribute in the catalogue, except the ones still open", () => {
    const found: string[] = [];
    for (const file of readdirSync(join(CATALOG_DIR, "products")).filter((f) => f.endsWith(".json"))) {
      const p = JSON.parse(readFileSync(join(CATALOG_DIR, "products", file), "utf8")) as Product;
      for (const [key, attr] of Object.entries(p.attributes ?? {})) {
        const s = attr?.source;
        if (s?.kind !== "manufacturer" || !s.url || !RETAILER.test(s.url)) continue;
        if (KNOWN_OPEN[p.id]?.includes(key)) continue;
        found.push(`${p.id}.${key} -> ${s.url}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("still finds every entry the open list claims, so a fixed one cannot sit here forever", () => {
    for (const [id, keys] of Object.entries(KNOWN_OPEN)) {
      const p = JSON.parse(readFileSync(join(CATALOG_DIR, "products", `${id}.json`), "utf8")) as Product;
      for (const key of keys) {
        const s = p.attributes[key]?.source;
        expect(s?.kind, `${id}.${key} is fixed; take it out of KNOWN_OPEN`).toBe("manufacturer");
        expect(s?.url, `${id}.${key} is fixed; take it out of KNOWN_OPEN`).toMatch(RETAILER);
      }
    }
  });

  it("has no such claim left on any wellness drink", () => {
    for (const p of drinks()) {
      for (const [key, attr] of Object.entries(p.attributes ?? {})) {
        const s = attr?.source;
        if (s?.kind === "manufacturer" && s.url) expect(s.url, `${p.id}.${key}`).not.toMatch(RETAILER);
      }
    }
  });
});
