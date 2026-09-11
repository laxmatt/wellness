import { describe, expect, it } from "vitest";
import { categories } from "@/domain/categories";
import { validateCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { catalog, viewsFor } from "./fixtures";

describe("local catalog", () => {
  it("loads with zero validation issues", () => {
    const c = catalog();
    expect(validateCatalog(c)).toEqual([]);
  });

  it("has the agreed product counts per category", () => {
    const c = catalog();
    const count = (id: string) => c.products.filter((p) => p.categoryId === id).length;
    expect(count("red-light")).toBe(8);
    expect(count("cold-plunge")).toBe(6);
    expect(count("wellness-drinks")).toBe(6);
  });

  it("marks every prototype product as demo", () => {
    for (const p of catalog().products) expect(p.flags.demo).toBe(true);
  });

  it("never claims independent verification in the prototype", () => {
    for (const p of catalog().products) {
      for (const [k, sv] of Object.entries(p.attributes)) {
        expect(sv.verification, `${p.id}.${k}`).not.toBe("independently_verified");
      }
    }
  });

  it("gives every manufacturer-reported value a source URL and retrieval date", () => {
    for (const p of catalog().products) {
      for (const [k, sv] of Object.entries(p.attributes)) {
        if (sv.verification === "manufacturer_reported") {
          expect(sv.source.url, `${p.id}.${k}`).toBeTruthy();
          expect(sv.source.retrievedAt, `${p.id}.${k}`).toBeTruthy();
        }
      }
    }
  });

  // `manufacturer_reported` says whose claim it is, not who was read. A
  // retailer's listing usually relays the maker's own specification, and such a
  // record is still the maker's claim at one remove.
  //
  // This used to require kind "manufacturer" outright, which is what let four
  // Cold Pod attributes and five CELSIUS ones point at Amazon while saying the
  // maker had spoken: the only way to satisfy the rule was to mislabel the
  // source. The rule now allows the honest label and demands the remove be
  // admitted instead.
  it("never says a maker's claim was read direct from anywhere but the maker", () => {
    for (const p of catalog().products) {
      for (const [k, sv] of Object.entries(p.attributes)) {
        if (sv.verification !== "manufacturer_reported") continue;
        if (sv.source.kind === "manufacturer") continue;
        expect(sv.source.method, `${p.id}.${k} cites a ${sv.source.kind}, so it cannot be a direct reading of the maker`).toBe("secondhand");
      }
    }
  });

  it("only falls below the completeness floor where required specs are missing or placeholders", () => {
    // Placeholder values count as absent, and so do values the source does not
    // state, and so does a money figure computed from a placeholder price.
    // AG1 and Cure carried a caffeine figure of 0 that no source stated;
    // Liquid I.V.'s price per serving was its demo pack price divided by 16.
    // Removing an invented number is what a completeness score is for. Real
    // data replaces them; a number chosen to fill the gap does not.
    const short: string[] = [];
    for (const cat of categories) {
      for (const v of viewsFor(cat.id)) {
        if (v.flags.completeness < cat.scoring.completenessFloor) short.push(v.id);
      }
    }
    // Four products have left this list by being read rather than by being
    // filled in: Liquid I.V. when its per-serving cost stopped resting on a
    // prototype price, Cure when its placeholder serving size became a stated
    // 7.3 g packet, OLIPOP when its placeholder price, sugar and calories
    // became stated figures, and AG1 when its placeholder scoop became a
    // stated 13 g one. Caffeine is unstated on three of them and still counts
    // against each.
    //
    // Infraredi Flex Max is the last one here, and it is the last unread
    // product in Red Light Therapy.
    expect(short.sort()).toEqual(["infraredi-flex-max"]);
  });

  it("produces a normalized view with plain values and a provenance map", () => {
    const v = viewsFor("red-light").find((x) => x.id === "hooga-hg300")!;
    expect(v.attributes.wavelengths_nm).toEqual([660, 850]);
    expect(v.provenance["attributes.wavelengths_nm"].verification).toBe("manufacturer_reported");
    // The shown price is the lowest offer whose amount is real: the maker's
    // own $199, read on 2026-09-09. Amazon's prototype $149 is lower and is
    // not a price. See docs/source-checks/2026-09-09-hooga-hg300.md.
    expect(v.price.money!.amountMinor).toBe(19900);
    expect(v.price.isDemo).toBe(false);
    expect(v.price.offerCount).toBe(1);
    expect(v.price.basis).toBe("lowest_offer");
    expect(v.offers.length).toBe(2);
    expect(v.cardSpecs.map((s) => s.key)).toEqual(["coverage", "wavelengths_nm", "warranty_years"]);
    expect(v.cardSpecs[1].formatted).toBe("660nm, 850nm");
  });

  it("exposes multiple offers with discount codes as first-class data", () => {
    const v = viewsFor("wellness-drinks").find((x) => x.id === "lmnt-citrus-salt-30")!;
    expect(v.offers.length).toBe(2);
    expect(v.offers.some((o) => o.discountCodes.length > 0)).toBe(true);
    expect(v.offers[0].price.amountMinor).toBeLessThanOrEqual(v.offers[1].price.amountMinor);
  });
});
