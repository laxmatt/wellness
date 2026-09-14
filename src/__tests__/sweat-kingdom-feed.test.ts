import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv } from "@/domain/import/csv";
import { readCatalogRecords, validateCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { categories } from "@/domain/categories";

describe("the Sweat Kingdom private feed preview", () => {
  const preview = readCatalogRecords(join(process.cwd(), "catalog-preview"));
  const sweat = preview.products.filter((p) => p.brandId === "preview-sweat-kingdom");

  it("keeps every one of the 225 source rows traceable", () => {
    const path = join(process.cwd(), "../outputs/partner-inventory/sweat-kingdom/2026-09-13.csv");
    const text = readFileSync(path, "utf8");
    const table = readCsv(text, Buffer.byteLength(text));
    expect(table.ok && table.rows).toHaveLength(225);
    expect(sweat).toHaveLength(225);
    expect(new Set(sweat.map((p) => p.source.ref)).size).toBe(225);
  });

  it("publishes core saunas but keeps accessories and adjacent products in review", () => {
    expect(sweat.filter((p) => p.status === "published")).toHaveLength(126);
    expect(sweat.filter((p) => p.status === "draft")).toHaveLength(99);
  });

  it("uses partner-feed media and claims no independent verification", () => {
    const published = sweat.filter((p) => p.status === "published");
    expect(published.every((p) => p.images.some((image) => image.role === "primary" && image.kind === "affiliate_feed"))).toBe(true);
    expect(published.every((p) => Object.values(p.attributes).every((attribute) => attribute.verification !== "independently_verified"))).toBe(true);
    expect(published.every((p) => p.offers.every((offer) => offer.source.kind === "merchant_feed"))).toBe(true);
  });

  it("forms a valid merged catalog for category, detail and compare views", () => {
    const base = readCatalogRecords(join(process.cwd(), "catalog"));
    expect(validateCatalog({ categories, products: [...base.products, ...preview.products], brands: [...base.brands, ...preview.brands], merchants: [...base.merchants, ...preview.merchants] })).toEqual([]);
  });
});
