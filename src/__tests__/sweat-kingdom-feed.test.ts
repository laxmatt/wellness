import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv } from "@/domain/import/csv";
import { readCatalogRecords, validateCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { categories } from "@/domain/categories";
import { toProductView } from "@/domain/view";
import { recommendCategory } from "@/domain/recommend";
import { buildCompareModel } from "@/domain/compare";

describe("the Sweat Kingdom private feed preview", () => {
  const preview = readCatalogRecords(join(process.cwd(), "catalog-preview"));
  const sweat = preview.products.filter((p) => p.brandId === "preview-sweat-kingdom");
  const families = sweat.filter((p) => p.status === "published");
  const drafts = sweat.filter((p) => p.status === "draft");

  it("keeps every one of the 225 source rows traceable", () => {
    const path = join(process.cwd(), "../outputs/partner-inventory/sweat-kingdom/2026-09-13.csv");
    const text = readFileSync(path, "utf8");
    const table = readCsv(text, Buffer.byteLength(text));
    expect(table.ok && table.rows).toHaveLength(225);
    expect(families.flatMap((p) => p.variants)).toHaveLength(126);
    expect(drafts).toHaveLength(99);
    expect(new Set([...families.flatMap((p) => p.variants.map((v) => v.source.ref)), ...drafts.map((p) => p.source.ref)]).size).toBe(225);
  });

  it("groups the 126 core variants into the 15 reviewed, non-overlapping families", () => {
    expect(families).toHaveLength(15);
    expect(families.map((p) => p.name).sort()).toEqual([
      "REGEN The Sweat Cabin (4 Person)", "REGEN The Sweat Cabin Deluxe (6 Person)", "REGEN The Sweat Pod (2-4 Person)",
      "SK 110", "SK 210", "SK 310", "SK Mobile", "The Ascent (6 Person)", "The Ridge (2 Person)", "The Summit (2-6 Person)",
      "The Sweat Barrel (2-6 Person)", "The Sweat Box (1 Person)", "The Sweat Cabin (4 Person)", "The Sweat Cabin Deluxe (6 Person)", "The Sweat Pod (2-4 Person)",
    ]);
    expect(new Set(families.flatMap((p) => p.variants.map((v) => v.supplierVariantId))).size).toBe(126);
    expect(drafts).toHaveLength(99);
  });

  it("uses partner-feed media and claims no independent verification", () => {
    expect(families.every((p) => p.images.some((image) => image.role === "primary" && image.kind === "affiliate_feed"))).toBe(true);
    expect(families.every((p) => Object.values(p.attributes).every((attribute) => attribute.verification !== "independently_verified"))).toBe(true);
    expect(families.every((p) => p.offers.every((offer) => offer.source.kind === "merchant_feed"))).toBe(true);
  });

  it("derives each From price from an underlying active variant and links to the family page", () => {
    for (const family of families) {
      const active = family.variants.map((v) => v.offer).filter((o) => o.availability !== "discontinued" && !o.disputed);
      expect(family.offers[0].priceMinor).toBe(Math.min(...active.map((o) => o.priceMinor)));
      expect(family.offers[0].url).not.toContain("variant=");
      expect(family.offers[0].shippingNote).toContain("final price depends on configuration");
    }
  });

  it("keeps purchase configuration choices out of browse and comparison dimensions", () => {
    const sauna = categories.find((c) => c.id === "saunas")!;
    const keys = sauna.compareGroups.flatMap((g) => g.keys);
    expect(keys).not.toEqual(expect.arrayContaining(["roof", "finish", "door_orientation", "window_orientation"]));
    expect(families.every((p) => !/\s\/\s/.test(p.name))).toBe(true);
    const views = families.map((product) => toProductView(product, { category: sauna, brands: preview.brands, merchants: preview.merchants }));
    const recommended = recommendCategory(views, sauna).products.slice(0, 2);
    const comparison = buildCompareModel(recommended, sauna);
    expect(comparison.columns).toHaveLength(2);
    expect(comparison.columns.every((column) => column.price.startsWith("From "))).toBe(true);
    expect(comparison.columns.every((column) => column.merchants.length === 1 && !column.merchants[0].url.includes("variant="))).toBe(true);
  });

  it("forms a valid merged catalog for category, detail and compare views", () => {
    const base = readCatalogRecords(join(process.cwd(), "catalog"));
    expect(validateCatalog({ categories, products: [...base.products, ...preview.products], brands: [...base.brands, ...preview.brands], merchants: [...base.merchants, ...preview.merchants] })).toEqual([]);
  });
});
