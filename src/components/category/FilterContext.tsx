"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { applyFilters, type FilterGroup } from "@/domain/filters";

type FilterState = {
  groups: FilterGroup[];
  ids: string[];
  selected: string[];
  visible: Set<string>;
  active: boolean;
  toggle: (optionId: string) => void;
  clear: () => void;
  dropLast: () => void;
  countFor: (group: FilterGroup, optionId: string) => number;
};

const Ctx = createContext<FilterState | null>(null);

// One source of truth for the category page's filter state. The grid, the chip
// bar and the picks band all read it, so nothing on the page can disagree
// about what the shopper has narrowed to.
export function CategoryFilterProvider({ groups, ids, children }: { groups: FilterGroup[]; ids: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const visible = useMemo(() => new Set(applyFilters(ids, groups, selected)), [ids, groups, selected]);

  const value = useMemo<FilterState>(
    () => ({
      groups,
      ids,
      selected,
      visible,
      active: selected.length > 0,
      toggle: (optionId) => setSelected((prev) => (prev.includes(optionId) ? prev.filter((x) => x !== optionId) : [...prev, optionId])),
      clear: () => setSelected([]),
      dropLast: () => setSelected((prev) => prev.slice(0, -1)),
      countFor: (group, optionId) => {
        const others = selected.filter((s) => !group.options.some((o) => o.id === s));
        return applyFilters(ids, groups, [...others, optionId]).length;
      },
    }),
    [groups, ids, selected, visible],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCategoryFilters(): FilterState | null {
  return useContext(Ctx);
}
