"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { applyFilters, type FilterGroup } from "@/domain/filters";

type FilterState = {
  groups: FilterGroup[];
  ids: string[];
  selected: string[];
  visible: Set<string>;
  active: boolean;
  toggle: (optionId: string) => void;
  clear: () => void;
  // Narrowing accepted from the assistant, applied on top of the chips.
  fromAssistant: { labels: string[]; count: number } | null;
  // The order the engine ranked those products in. The grid rendered `ids` in
  // the page's own order and used the assistant's answer only for membership,
  // so a reply saying "Ranking for lower price" changed which products were
  // shown and never the order they were shown in.
  assistantOrder: string[] | null;
  clearAssistant: () => void;
  dropLast: () => void;
  countFor: (group: FilterGroup, optionId: string) => number;
};

const Ctx = createContext<FilterState | null>(null);

// One source of truth for the category page's filter state. The grid, the chip
// bar and the picks band all read it, so nothing on the page can disagree
// about what the shopper has narrowed to.
export function CategoryFilterProvider({ groups, ids, children }: { groups: FilterGroup[]; ids: string[]; children: ReactNode }) {
  const [selected, setSelected] = useState<string[]>([]);
  const assistant = useAssistant();
  const applied = assistant?.applied ?? null;
  const lastNonce = useRef<number | null>(null);
  const [assistantIds, setAssistantIds] = useState<string[] | null>(null);
  const [assistantLabels, setAssistantLabels] = useState<string[]>([]);

  // A preference accepted in chat narrows the grid by the recommendation
  // engine's own answer, not by guessing which chip means the same thing.
  // Mapping a budget onto a "$500" chip would either hide qualifying products
  // or show ones that miss the constraint; both are wrong. Chips still work
  // exactly as before and combine with this. Nothing happens until Apply.
  useEffect(() => {
    if (!applied || lastNonce.current === applied.nonce) return;
    lastNonce.current = applied.nonce;
    setAssistantIds(applied.matchingIds);
    setAssistantLabels(applied.labels);
  }, [applied]);

  const visible = useMemo(() => {
    const byChips = applyFilters(ids, groups, selected);
    return new Set(assistantIds ? byChips.filter((id) => assistantIds.includes(id)) : byChips);
  }, [ids, groups, selected, assistantIds]);

  const value = useMemo<FilterState>(
    () => ({
      groups,
      ids,
      selected,
      visible,
      active: selected.length > 0 || assistantIds !== null,
      fromAssistant: assistantIds ? { labels: assistantLabels, count: assistantIds.length } : null,
      assistantOrder: assistantIds,
      clearAssistant: () => {
        setAssistantIds(null);
        setAssistantLabels([]);
      },
      toggle: (optionId) => setSelected((prev) => (prev.includes(optionId) ? prev.filter((x) => x !== optionId) : [...prev, optionId])),
      clear: () => {
        setSelected([]);
        setAssistantIds(null);
        setAssistantLabels([]);
      },
      dropLast: () => setSelected((prev) => prev.slice(0, -1)),
      countFor: (group, optionId) => {
        const others = selected.filter((s) => !group.options.some((o) => o.id === s));
        return applyFilters(ids, groups, [...others, optionId]).length;
      },
    }),
    [groups, ids, selected, visible, assistantIds, assistantLabels],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCategoryFilters(): FilterState | null {
  return useContext(Ctx);
}
