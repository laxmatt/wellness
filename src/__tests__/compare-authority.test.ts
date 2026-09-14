import { expect, it } from "vitest";
import { categories } from "@/domain/categories";
import { getCategoryPage } from "@/lib/queries";
import { getCatalog } from "@/providers";

// Reconciliation must see the full published category, not a ranking subset.
// Otherwise a valid selection could be removed merely for ranking lower.
//
// One thing is held out and it is not a ranking decision: a record that is a
// configuration of another, a finish or a size, is compared as part of the
// model it belongs to. It is never offered, so it can never be selected, and it
// is accounted for here rather than merely absent.
it.each(categories)("keeps complete comparison authority for $id", async (cat) => {
  const page = await getCategoryPage(cat.slug);
  const published = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
  const held = [...(page?.products ?? []), ...(page?.members ?? [])];
  expect(held.map((p) => p.view.id).sort()).toEqual(published.map((p) => p.id).sort());
  expect((page?.members ?? []).every((m) => m.view.family !== undefined)).toBe(true);
});
