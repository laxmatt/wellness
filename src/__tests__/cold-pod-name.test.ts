import { describe, expect, it } from "vitest";
import { coldPlunge } from "@/domain/categories";
import { buildCompareModel } from "@/domain/compare";
import { recommendCategory } from "@/domain/recommend";
import { catalog, viewsFor } from "./fixtures";

// The capacity is disputed and withheld everywhere a figure appears. The name
// repeated it unqualified, in the page title, the breadcrumb, the heading and
// the category card, where no capacity row exists to qualify it.
//
// Removing it establishes nothing. The 88 and its evidence stay exactly where
// they were, and the maker's 85 is not adopted.

const view = () => viewsFor("cold-plunge").find((v) => v.id === "the-cold-pod-88")!;

describe("the Cold Pod name states no capacity", () => {
  it("names the product without a figure, and keeps the brand", () => {
    expect(view().name).toBe("Ice Bath Tub");
    expect(view().brand.name).toBe("The Cold Pod");
  });

  it("asserts no capacity anywhere a name is rendered from", () => {
    const v = view();
    // The page title and the card heading are both `brand.name + name`.
    expect(`${v.brand.name} ${v.name}`).not.toMatch(/\d+\s*(gal|gallon)/i);
    expect(v.name).not.toMatch(/88/);
    expect(v.description).not.toMatch(/\d+\s*gallon/i);
  });

  it("leaves the id and the slug alone, so no URL moves", () => {
    expect(view().id).toBe("the-cold-pod-88");
    expect(view().slug).toBe("the-cold-pod-88-gallon");
  });

  it("keeps the capacity disputed, withheld, and on the record", () => {
    const v = view();
    // Still disputed, so still unusable for matching and scoring.
    expect(v.provenance["attributes.water_capacity_gal"].disputed).toBe(true);
    expect(v.attributes.water_capacity_gal).toBeUndefined();
    // Still 88 on the record, and still marked where it is shown.
    const raw = catalog().products.find((p) => p.id === "the-cold-pod-88")!.attributes.water_capacity_gal;
    expect(raw!.value).toBe(88);
    expect(v.specs.find((s) => s.key === "water_capacity_gal")!.formatted).toMatch(/88 gal, disputed/);
  });

  it("does not adopt the maker's 85, and keeps the evidence for both", () => {
    const note = catalog().products.find((p) => p.id === "the-cold-pod-88")!.source.note ?? "";
    expect(note).toMatch(/85 gallons against this record's 88/);
    expect(note).toMatch(/Ice Bath Tub, 88 Gallon/);
    expect(view().attributes.water_capacity_gal).not.toBe(85);
  });

  it("changes nothing else: price, offers and every other attribute stand", () => {
    const v = view();
    expect(v.price.money?.amountMinor).toBe(13999);
    expect(v.offers).toHaveLength(1);
    expect(v.attributes.fits_height_in).toBe(79);
    expect(v.attributes.insulated).toBe(true);
    expect(v.attributes.chiller_included).toBe(false);
    const { products } = recommendCategory(viewsFor("cold-plunge"), coldPlunge);
    const entry = products.find((p) => p.view.id === "the-cold-pod-88")!;
    expect(entry.score).toBe(18.5);
    expect(entry.badges).toEqual(["best_value"]);
  });

  it("still shows the disputed figure in the comparison, marked", () => {
    const items = recommendCategory(viewsFor("cold-plunge"), coldPlunge).products;
    const model = buildCompareModel(items, coldPlunge);
    const col = model.columns.findIndex((c) => c.id === "the-cold-pod-88");
    expect(model.columns[col].name).toBe("Ice Bath Tub");
    const row = model.groups.flatMap((g) => g.rows).find((r) => r.key === "water_capacity_gal")!;
    expect(row.cells[col].text).toMatch(/88 gal, disputed/);
  });
});
