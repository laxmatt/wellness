import { expect, it } from "vitest";
import { categories } from "@/domain/categories";
import { getCategoryPage } from "@/lib/queries";
import { getCatalog } from "@/providers";

// Reconciliation must see the full published category, not a ranking subset.
// Otherwise a valid selection could be removed merely for ranking lower.
it.each(categories)("keeps complete comparison authority for $id", async (cat) => {
  const page = await getCategoryPage(cat.slug);
  const published = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
  expect(page?.products.map(p => p.view.id).sort()).toEqual(published.map(p => p.id).sort());
});
