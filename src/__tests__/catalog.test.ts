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
          expect(sv.source.kind, `${p.id}.${k}`).toBe("manufacturer");
          expect(sv.source.url, `${p.id}.${k}`).toBeTruthy();
          expect(sv.source.retrievedAt, `${p.id}.${k}`).toBeTruthy();
        }
      }
    }
  });

  it("keeps every product badge-eligible on completeness", () => {
    for (const cat of categories) {
      for (const v of viewsFor(cat.id)) {
        expect(v.flags.completeness, v.id).toBeGreaterThanOrEqual(cat.scoring.completenessFloor);
      }
    }
  });

  it("produces a normalized view with plain values and a provenance map", () => {
    const v = viewsFor("red-light").find((x) => x.id === "hooga-hg300")!;
    expect(v.attributes.wavelengths_nm).toEqual([660, 850]);
    expect(v.provenance["attributes.wavelengths_nm"].verification).toBe("manufacturer_reported");
    expect(v.price.money.amountMinor).toBe(13900);
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
