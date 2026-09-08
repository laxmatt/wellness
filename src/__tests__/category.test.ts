import { describe, expect, it } from "vitest";
import { categories } from "@/domain/categories";
import { CategoryDefinition } from "@/domain/category";
import { miniCategory } from "./fixtures";

describe("category definitions", () => {
  it("all three launch categories parse", () => {
    expect(categories.map((c) => c.id)).toEqual(["red-light", "cold-plunge", "wellness-drinks"]);
  });

  it("rejects references to unknown attribute keys", () => {
    const bad = { ...miniCategory, cardSpecKeys: ["nope"] };
    const r = CategoryDefinition.safeParse(bad);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join("\n")).toContain('unknown key "nope"');
  });

  it("rejects a budget line above the premium line", () => {
    const bad = { ...miniCategory, badges: { ...miniCategory.badges, budgetMaxMinor: 90000 } };
    expect(CategoryDefinition.safeParse(bad).success).toBe(false);
  });

  it("rejects a malformed priceBasis", () => {
    const bad = { ...miniCategory, value: { ...miniCategory.value, priceBasis: "power" } };
    expect(CategoryDefinition.safeParse(bad).success).toBe(false);
    const ok = { ...miniCategory, value: { ...miniCategory.value, priceBasis: "attribute:power" } };
    expect(CategoryDefinition.safeParse(ok).success).toBe(true);
  });

  it("facet slugs are unique within a category", () => {
    for (const c of categories) {
      const slugs = c.facets.map((f) => f.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });
});
