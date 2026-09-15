import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv } from "@/domain/import/csv";
import { buildDrafts } from "@/domain/import/draft";
import { suggestMapping, type ColumnMapping } from "@/domain/import/mapping";
import { previewFileName, previewProductId, slugify } from "@/domain/inventory/identity";
import { stageDrafts, type StageResult } from "@/domain/inventory/stage";
import { transition } from "@/domain/inventory/status";

const SAMPLES = join(process.cwd(), "docs/import-demo/samples");

function stage(file: string, supplier: string, tweak: (m: ColumnMapping) => ColumnMapping = (m) => m): StageResult {
  const text = readFileSync(join(SAMPLES, file), "utf8");
  const table = readCsv(text, Buffer.byteLength(text, "utf8"));
  if (!table.ok) throw new Error(table.reason);
  const mapping = tweak(suggestMapping(table.headers).mapping);
  return stageDrafts(buildDrafts(table.headers, table.rows, mapping), {
    supplierName: supplier,
    sourceFile: file,
    pricedOn: "2026-09-12",
    stagedOn: "2026-09-12",
  });
}

const a = () => stage("supplier-a-northwind-SYNTHETIC.csv", "Northwind Hydration");

describe("staging a supplier file into catalogue records", () => {
  it("builds a draft product per readable row", () => {
    const r = a();
    expect(r.fatal).toEqual([]);
    expect(r.refusals).toEqual([]);
    expect(r.staged).toHaveLength(5);
    expect(r.staged.every((s) => s.product.status === "draft")).toBe(true);
    expect(r.brands.map((b) => b.id)).toEqual(["preview-brand-northwind-hydration"]);
    expect(r.merchant?.id).toBe("preview-supplier-northwind-hydration");
  });

  it("keeps the supplier's code as a code and never as our id", () => {
    const p = a().staged[0].product;
    expect(p.id).toBe("preview-northwind-hydration-citrus-salt-sticks-30-pack");
    expect(p.id).not.toContain("NW-1001");
    expect(p.identifiers.merchantSkus).toEqual({ "preview-supplier-northwind-hydration": "NW-1001" });
    expect(p.offers[0].merchantSku).toBe("NW-1001");
  });

  it("makes the price an offer at a named merchant on a stated date, not the product's own price", () => {
    const p = a().staged[0].product;
    expect(p.referencePrice).toBeUndefined();
    expect(p.offers).toHaveLength(1);
    expect(p.offers[0]).toMatchObject({
      merchantId: "preview-supplier-northwind-hydration",
      currency: "USD",
      priceMinor: 4500,
      lastChecked: "2026-09-12",
      url: "https://example.invalid/northwind/citrus-salt",
    });
  });

  it("records every figure it read as what it is, and an empty cell as not stated", () => {
    const withGap = a().staged.find((s) => s.product.id.includes("lemon-hydration"))!.product;
    expect(withGap.attributes.sugar_g).toMatchObject({ value: 11, unit: "g", verification: "demo" });
    expect(withGap.attributes.sugar_g.source.kind).toBe("demo");
    expect(withGap.attributes.sugar_g.source.ref).toBe("supplier-a-northwind-SYNTHETIC.csv, row 5");
    // The column exists and the cell is empty. Not stated is a reading. Zero is not.
    expect(withGap.attributes.caffeine_mg.value).toBeUndefined();
    expect(withGap.attributes.caffeine_mg.verification).toBe("not_stated");
    // Nothing the mapping does not fill is written at all.
    expect(withGap.attributes.sodium_mg).toBeUndefined();
    expect(withGap.attributes.format).toBeUndefined();
    expect(withGap.flags.demo).toBe(true);
  });

  it("assumes no image rights", () => {
    const p = a().staged[0].product;
    expect(p.images).toHaveLength(1);
    expect(p.images[0].kind).toBe("demo_placeholder");
    expect(p.images[0].src).toBe(`demo:${p.id}-primary`);
    expect(p.images[0].license).toBeUndefined();
  });
});

describe("rows that cannot become records", () => {
  const b = () => stage("supplier-b-contoso-SYNTHETIC.csv", "Contoso Beverages");

  it("refuses every row of a file this catalogue cannot hold, and stages nothing", () => {
    const r = b();
    expect(r.staged).toEqual([]);
    expect(r.refusals).toHaveLength(5);
  });

  it("refuses a price in a currency this catalogue does not store", () => {
    const reasons = b().refusals.flatMap((x) => x.reasons);
    expect(reasons.some((x) => x.includes("This price is in EUR") && x.includes("USD only"))).toBe(true);
  });

  it("passes the importer's own reasons through rather than restating them", () => {
    const reasons = b().refusals.flatMap((x) => x.reasons);
    expect(reasons.some((x) => x.startsWith("Category:") && x.includes('"tea" is not a category'))).toBe(true);
    expect(reasons.some((x) => x.startsWith("Caffeine:") && x.includes("spreadsheet formula"))).toBe(true);
    expect(reasons.some((x) => x.startsWith("Sugar:") && x.includes("Stated in oz"))).toBe(true);
  });

  it("refuses a row with no price at all rather than pricing it at nothing", () => {
    const row = b().refusals.find((x) => x.row === 5)!;
    expect(row.reasons.some((x) => x.includes("No price was read"))).toBe(true);
  });

  it("refuses two rows that derive one id rather than adding a number to one of them", () => {
    const table = readCsv(
      "sku,product_name,brand,category,function,sugar_g,caffeine_mg,unit_price_usd,servings_per_pack,source_url\n" +
        "S1,Same Drink,Acme,wellness-drinks,energy,0,80,10.00,12,https://example.invalid/a\n" +
        "S2,same drink,Acme,wellness-drinks,energy,0,80,11.00,12,https://example.invalid/b\n",
    );
    if (!table.ok) throw new Error(table.reason);
    const r = stageDrafts(buildDrafts(table.headers, table.rows, suggestMapping(table.headers).mapping), {
      supplierName: "Acme",
      sourceFile: "two-rows.csv",
      pricedOn: "2026-09-12",
      stagedOn: "2026-09-12",
    });
    expect(r.staged).toHaveLength(1);
    expect(r.refusals).toHaveLength(1);
    expect(r.refusals[0].reasons.some((x) => x.includes("row 2 already took"))).toBe(true);
  });

  it("refuses a source reference that is not an address, because an offer needs a link", () => {
    const table = readCsv(
      "sku,product_name,brand,category,function,sugar_g,caffeine_mg,unit_price_usd,servings_per_pack,source_url\n" +
        "S1,Some Drink,Acme,wellness-drinks,energy,0,80,10.00,12,ask the rep\n",
    );
    if (!table.ok) throw new Error(table.reason);
    const r = stageDrafts(buildDrafts(table.headers, table.rows, suggestMapping(table.headers).mapping), {
      supplierName: "Acme",
      sourceFile: "one-row.csv",
      pricedOn: "2026-09-12",
      stagedOn: "2026-09-12",
    });
    expect(r.staged).toEqual([]);
    expect(r.refusals[0].reasons.some((x) => x.includes("is not an http or https address"))).toBe(true);
  });

  it("stages nothing at all when the mapping does not fill a required field", () => {
    const r = stage("supplier-a-northwind-SYNTHETIC.csv", "Northwind Hydration", (m) => ({
      ...m,
      columns: Object.fromEntries(Object.entries(m.columns).filter(([k]) => k !== "brand")),
    }));
    expect(r.fatal).toHaveLength(1);
    expect(r.fatal[0]).toContain("Brand");
    expect(r.staged).toEqual([]);
  });
});

describe("names and filenames", () => {
  it("derives one id from the same row every time", () => {
    expect(previewProductId("Northwind Hydration", "Citrus Salt Sticks, 30 pack")).toBe("preview-northwind-hydration-citrus-salt-sticks-30-pack");
    expect(previewProductId("Acme", "  Fizz  ")).toBe("preview-acme-fizz");
  });

  it("has nothing to derive from text with no letters or digits", () => {
    expect(slugify("///")).toBeUndefined();
    expect(previewProductId("///", "Fizz")).toBeUndefined();
  });

  it("builds a filename only from a preview id", () => {
    expect(previewFileName("preview-acme-fizz")).toBe("preview-acme-fizz.json");
    for (const bad of ["../../etc/passwd", "preview-../x", "celsius-sparkling-orange-12", "preview-a/b", "preview-a.b", "PREVIEW-A", "preview-", ""]) {
      expect(() => previewFileName(bad)).toThrow(/not a preview record id/);
    }
  });
});

describe("what an operator may do to a staged record", () => {
  it("publishes a draft and a hidden record, and nothing else", () => {
    expect(transition("draft", "approve")).toEqual({ ok: true, to: "published" });
    expect(transition("hidden", "approve")).toEqual({ ok: true, to: "published" });
    expect(transition("published", "approve").ok).toBe(false);
  });

  it("hides only what is published, and unhides only what is hidden", () => {
    expect(transition("published", "hide")).toEqual({ ok: true, to: "hidden" });
    expect(transition("draft", "hide").ok).toBe(false);
    expect(transition("hidden", "unhide")).toEqual({ ok: true, to: "published" });
    expect(transition("published", "unhide").ok).toBe(false);
  });
});
