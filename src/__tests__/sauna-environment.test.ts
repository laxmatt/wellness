import { describe, expect, it } from "vitest";
import { extractSaunaEnvironment } from "@/domain/ingestion/sauna-environment";
import { readCatalogRecords } from "@/providers/catalog/LocalCatalogProvider";
import { buildFilterGroups } from "@/domain/filters";
import { toProductView } from "@/domain/view";
import { saunas } from "@/domain/categories/saunas";

describe("sauna temperature and enclosure evidence", () => {
  it("takes the highest explicit maximum and never treats outdoor as weather-ready", () => {
    expect(extractSaunaEnvironment("Heats to 170°F in 25 minutes. Maximum operating temperature: 220°F.")).toContainEqual(expect.objectContaining({ key: "max_temperature_f", value: 220 }));
    expect(extractSaunaEnvironment("An outdoor sauna made from cedar.").some((fact) => fact.key === "enclosure_protection")).toBe(false);
    expect(extractSaunaEnvironment("Fully insulated and built for rain, sun, and snow.")).toContainEqual(expect.objectContaining({ key: "enclosure_protection", value: "insulated_weather_ready" }));
  });

  it("offers explicit not-stated choices with truthful counts", () => {
    const catalog = readCatalogRecords(`${process.cwd()}/catalog`);
    const products = catalog.products.filter((product) => product.categoryId === "saunas");
    const views = products.map((product) => toProductView(product, { category: saunas, brands: catalog.brands, merchants: catalog.merchants }));
    const groups = buildFilterGroups(views, saunas);
    for (const key of ["placement", "enclosure_protection", "max_temperature_f"]) {
      const group = groups.find((item) => item.key === key)!;
      const unknown = group.options.find((option) => option.label === "Not stated")!;
      expect(unknown.matchIds.length).toBe(views.filter((view) => view.attributes[key] === undefined).length);
      expect(unknown.matchIds.length).toBeGreaterThan(0);
    }
  });
});
