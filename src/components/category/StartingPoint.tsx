"use client";

import { useCategoryFilters } from "./FilterContext";

/**
 * What a facet URL opened with, said while it is still true.
 *
 * A shopper arriving at /wellness-drinks/sugar-free sees fewer products than
 * the category holds and deserves one line saying why. The moment they take
 * that chip off, the line goes: the page must not keep naming a choice the
 * shopper has undone.
 */
export function StartingPoint({ ids, label }: { ids: string[]; label: string }) {
  const f = useCategoryFilters();
  if (!f || ids.length === 0) return null;
  if (!ids.every((id) => f.selected.includes(id))) return null;
  return (
    <p data-testid="starting-point" className="mt-2 max-w-2xl text-sm text-fg-soft">
      {label} is selected to start. Change it below.
    </p>
  );
}
