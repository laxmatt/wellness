import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Product } from "@/domain/product";
import { saunas } from "@/domain/categories/saunas";
import { toProductView } from "@/domain/view";
import { recommendCategory } from "@/domain/recommend";
import { buildCompareModel } from "@/domain/compare";

const dir = join(process.cwd(), "catalog/products");
const products = readdirSync(dir).filter((file) => file.startsWith("saunabox-")).map((file) => Product.parse(JSON.parse(readFileSync(join(dir, file), "utf8"))));

describe("SAUNABOX official Shopify inventory", () => {
  it("publishes exactly the seven currently listed complete sauna models", () => {
    expect(products.map((product) => product.id).sort()).toEqual([
      "saunabox-forge-sauna", "saunabox-pulse-pro-portable-ir-sauna-with-redlights", "saunabox-saunabox-go",
      "saunabox-saunabox-smartsteam-kit", "saunabox-saunabox-smartsteam-kit-pro-with-red-light-therapy",
      "saunabox-solara-2-person", "saunabox-solara-full-spectrum-infrared-sauna",
    ]);
    expect(products.every((product) => product.status === "published" && product.source.kind === "manufacturer")).toBe(true);
  });

  it("uses only the issued Social Snowball referral and preserves prices, availability and remote images", () => {
    for (const product of products) {
      expect(product.offers[0].url).toBe("https://www.saunabox.com/MATT41058");
      expect(product.offers[0].affiliate).toMatchObject({ status: "affiliate", network: "direct", programRef: "80182564" });
      expect(product.offers[0].priceMinor).toBeGreaterThan(0);
      expect(product.images[0].src).toMatch(/^https:\/\/cdn\.shopify\.com\//);
    }
  });

  it("keeps finish choices as variants and supports steam and portable-tent comparisons", () => {
    expect(products.find((product) => product.id === "saunabox-solara-full-spectrum-infrared-sauna")?.variants).toHaveLength(2);
    expect(saunas.attributeDefinitions.find((attribute) => attribute.key === "sauna_type")?.enumOptions?.some((option) => option.value === "steam")).toBe(true);
    expect(saunas.attributeDefinitions.find((attribute) => attribute.key === "sauna_style")?.enumOptions?.some((option) => option.value === "tent")).toBe(true);
  });

  it("does not ingest the absent Pulse CORE or any accessory, component, plunge, red-light-only device or recovery bundle", () => {
    expect(products.some((product) => /pulse-core|plunge|replacement|bundle|nova/.test(product.id))).toBe(false);
  });

  it("renders sourced key facts and practical planning content in comparison", () => {
    const selected = products.filter((product) => ["saunabox-forge-sauna", "saunabox-saunabox-smartsteam-kit"].includes(product.id));
    const brands = [{ id: "saunabox", slug: "saunabox", name: "SAUNABOX", market: "US" as const, images: [] }];
    const merchants = [{ id: "saunabox", slug: "saunabox", name: "SAUNABOX", markets: ["US" as const] }];
    const views = selected.map((product) => toProductView(product, { category: saunas, brands, merchants }));
    const model = buildCompareModel(recommendCategory(views, saunas).products, saunas);
    const overview = model.groups.find((group) => group.label === "Overview")!;
    expect(overview.rows.find((row) => row.label === "Key facts")?.cells.every((cell) => !cell.text.includes("Nothing flagged"))).toBe(true);
    expect(overview.rows.find((row) => row.label === "Plan for")?.cells.every((cell) => !cell.text.includes("Tradeoffs not assessed"))).toBe(true);
  });
});
