import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSaunaDescription } from "@/domain/ingestion/sauna-description";
import { Product } from "@/domain/product";
import { saunas } from "@/domain/categories/saunas";
import { toProductView } from "@/domain/view";
import { recommendCategory } from "@/domain/recommend";
import { buildCompareModel } from "@/domain/compare";

const records = [
  "select-saunas-golden-designs-loviisa-3-person-hybrid-puretech-e2-84-a2-ful.json",
  "select-saunas-golden-designs-savonlinna-3-person-outdoor-tradition-1klg7pl.json",
  "select-saunas-golden-designs-savonlinna-3-person-outdoor-tradition-1b1u5kg.json",
].map((file) => Product.parse(JSON.parse(readFileSync(join(process.cwd(), "catalog/products", file), "utf8"))));

describe("Select Saunas structured description specifications", () => {
  it("reads both W×D×H and L×W×H labels without swapping the footprint", () => {
    expect(Object.fromEntries(extractSaunaDescription('Assembled Dimensions Exterior (W x D x H): 69" x 68" x 89"').map((x) => [x.key, x.value]))).toMatchObject({ width_in: 69, depth_in: 68, height_in: 89 });
    expect(Object.fromEntries(extractSaunaDescription("Exterior dimensions (LWH): 79.2” x 70.5” x 87.8”").map((x) => [x.key, x.value]))).toMatchObject({ width_in: 70.5, depth_in: 79.2, height_in: 87.8 });
    expect(extractSaunaDescription('Exterior dimensions (LWH): 36″+ 2" x 39″ x 77″').filter((x) => x.key.endsWith("_in"))).toEqual([]);
  });

  it("reads only label-anchored electrical and heater specifications", () => {
    const facts = Object.fromEntries(extractSaunaDescription("Harvia Stove 8KW Traditional Sauna Stove. Electrical service: 240V / 40AMP (Stove) and 120V / 15AMP lights.").map((x) => [x.key, x.value]));
    expect(facts).toMatchObject({ voltage: "240v", amperage_a: 40, heater_kw: 8, heater_model: "Harvia Stove 8KW Traditional Sauna Stove" });
    expect(extractSaunaDescription("Optional 240V heater available; ask an electrician.")).toEqual([]);
  });

  it("populates Loviisa and both Savonlinna source records with approved derivations", () => {
    const expected = [
      { width_in: 69, depth_in: 68, height_in: 89, voltage: "240v", amperage_a: 40, heater_kw: 8 },
      { width_in: 69, depth_in: 68, height_in: 89, voltage: "240v", amperage_a: 40, heater_kw: 8 },
      { width_in: 70.5, depth_in: 79.2, height_in: 87.8, voltage: "240v", amperage_a: 30, heater_kw: 6 },
    ];
    records.forEach((product, index) => {
      expect(Object.fromEntries(Object.entries(product.attributes).map(([key, entry]) => [key, entry.value]))).toMatchObject(expected[index]);
      for (const key of Object.keys(expected[index])) {
        expect(product.attributes[key].derivation?.reviewState).toBe("approved");
        expect(product.attributes[key].source.method).toBe("secondhand");
      }
    });
  });

  it("backfills every supported fact across the full preserved Select Saunas feed", () => {
    const products = readdirSync(join(process.cwd(), "catalog/products"))
      .filter((file) => file.startsWith("select-saunas-") && file.endsWith(".json"))
      .map((file) => Product.parse(JSON.parse(readFileSync(join(process.cwd(), "catalog/products", file), "utf8"))));
    expect(products).toHaveLength(201);
    const counts = Object.fromEntries(["width_in", "depth_in", "height_in", "voltage", "amperage_a", "heater_kw", "heater_model"].map((key) => [key, products.filter((product) => product.attributes[key]?.derivation?.field === "body_text").length]));
    expect(counts).toEqual({ width_in: 137, depth_in: 137, height_in: 137, voltage: 95, amperage_a: 91, heater_kw: 27, heater_model: 53 });
  });

  it("renders sourced sauna key facts and installation planning instead of editorial placeholders", () => {
    const brands = [{ id: records[0].brandId, slug: records[0].brandId, name: "Golden Designs", market: "US" as const, images: [] }];
    const merchant = { id: "select-saunas", slug: "select-saunas", name: "Select Saunas", markets: ["US" as const] };
    const views = records.slice(0, 2).map((product) => toProductView(product, { category: saunas, brands, merchants: [merchant] }));
    const model = buildCompareModel(recommendCategory(views, saunas).products, saunas);
    const overview = model.groups.find((group) => group.label === "Overview")!;
    expect(overview.rows.find((row) => row.label === "Key facts")?.cells.every((cell) => !cell.text.includes("Nothing flagged"))).toBe(true);
    expect(overview.rows.find((row) => row.label === "Plan for")?.cells.every((cell) => /footprint|electrical/.test(cell.text))).toBe(true);
  });
});
