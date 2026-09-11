import { describe, expect, it } from "vitest";
import { coldPlunge } from "@/domain/categories";
import { buildCompareModel } from "@/domain/compare";
import { attributionSentence, attributionTag, isUsable } from "@/domain/provenance";
import { recommendCategory } from "@/domain/recommend";
import { viewsFor } from "./fixtures";

// `verification` says whose claim a figure is. It does not say who was read,
// and both came out of one word: four Cold Pod specifications relayed by an
// Amazon listing rendered "Maker reported", which is true about the claim and
// reads as a promise that this site opened the maker's page.

const pod = () => viewsFor("cold-plunge").find((v) => v.id === "the-cold-pod-88")!;
const RELAYED = ["chiller_included", "water_capacity_gal", "fits_height_in", "insulated"];

describe("a maker's figure relayed by a retailer says so", () => {
  it("names the retailer in the tag and in the sentence", () => {
    const p = { verification: "manufacturer_reported" as const, source: { kind: "retailer" as const, method: "secondhand" as const } };
    expect(attributionTag(p)).toBe("Via retailer");
    expect(attributionSentence(p)).toBe("the maker's figure, relayed by a retailer listing");
  });

  it("leaves a figure read from the maker alone", () => {
    const p = { verification: "manufacturer_reported" as const, source: { kind: "manufacturer" as const, method: "direct" as const } };
    expect(attributionTag(p)).toBe("Maker reported");
    expect(attributionSentence(p)).toBe("reported by the maker");
  });

  it("applies to the real records that carry it", () => {
    for (const key of RELAYED) {
      const prov = pod().provenance[`attributes.${key}`];
      expect(prov.source.kind, key).toBe("retailer");
      expect(attributionTag(prov), key).toBe("Via retailer");
      expect(attributionSentence(prov), key).toMatch(/relayed by a retailer/);
    }
  });

  it("reaches the comparison, which carries the source beside the verification", () => {
    const items = recommendCategory(viewsFor("cold-plunge"), coldPlunge).products;
    const model = buildCompareModel(items, coldPlunge);
    const column = model.columns.findIndex((c) => c.id === "the-cold-pod-88");
    expect(column).toBeGreaterThanOrEqual(0);
    const tagged = model.groups
      .flatMap((g) => g.rows)
      .map((r) => r.cells[column])
      .filter((c) => c.verification !== undefined);
    for (const cell of tagged) {
      if (cell.source?.kind === "retailer") {
        expect(attributionTag({ verification: cell.verification!, source: cell.source })).toBe("Via retailer");
      }
    }
    expect(tagged.length, "the column should show at least one tag").toBeGreaterThan(0);
  });
});

describe("the wording change touches nothing that decides anything", () => {
  it("leaves every relayed value exactly as usable as it was", () => {
    for (const key of RELAYED) {
      const prov = pod().provenance[`attributes.${key}`];
      expect(prov.verification, key).toBe("manufacturer_reported");
      expect(isUsable(prov.verification), key).toBe(true);
    }
    // Three of the four still reach the view. The fourth is withheld because
    // its figure is disputed, which it was before any of this.
    expect(pod().attributes.chiller_included).toBe(false);
    expect(pod().attributes.fits_height_in).toBe(79);
    expect(pod().attributes.insulated).toBe(true);
    expect(pod().attributes.water_capacity_gal).toBeUndefined();
  });

  it("leaves the ranking where it was", () => {
    const { products } = recommendCategory(viewsFor("cold-plunge"), coldPlunge);
    const entry = products.find((p) => p.view.id === "the-cold-pod-88")!;
    expect(entry.score).toBe(18.5);
    expect(entry.badges).toEqual(["best_value"]);
  });
});
