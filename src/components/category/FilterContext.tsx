"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { setNeeds } from "@/components/needs/NeedsStore";
import { applyFilters, type FilterGroup } from "@/domain/filters";
import type { NeedDefinition } from "@/domain/needs";

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
  // The category this page is showing, when it was given one. Screens read it
  // to look up what the shopper has asked for.
  categoryId?: string;
};

const Ctx = createContext<FilterState | null>(null);

// One source of truth for the category page's filter state. The grid, the chip
// bar and the picks band all read it, so nothing on the page can disagree
// about what the shopper has narrowed to.
export function CategoryFilterProvider({
  groups,
  ids,
  children,
  // Every requirement this category can express, classified by the server over
  // the whole category. The chips select from it; nothing in the browser
  // evaluates a product.
  needs = [],
  categoryId,
  // The facet this page is, when it is one. A shopper on /red-light/under-1000
  // has stated a budget as surely as one who pressed the chip, and only the
  // page knew it.
  activeFacetId,
}: {
  groups: FilterGroup[];
  ids: string[];
  children: ReactNode;
  needs?: NeedDefinition[];
  categoryId?: string;
  activeFacetId?: string;
}) {
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

  // What the shopper has asked for, written where a screen that is not this one
  // can read it. The comparison is a different page with no chips of its own,
  // and its job is products weighed against each other, some of which these
  // filters exclude.
  //
  // Accepted assistant constraints join the list and are marked as theirs. Soft
  // preferences do not: a preference orders the list and decides nothing, so it
  // is reported separately or not at all. A proposal the shopper has not
  // accepted is not here at all.
  const selectedNeeds = useMemo(() => {
    const byId = new Map(needs.map((n) => [n.id, n]));
    const chosen: NeedDefinition[] = [];
    if (activeFacetId) {
      const facet = byId.get(activeFacetId);
      if (facet) chosen.push(facet);
    }
    for (const id of selected) {
      const need = byId.get(id);
      if (need) chosen.push(need);
    }
    for (const b of applied?.breakdown ?? []) {
      chosen.push({ id: `assistant:${b.key}`, label: b.label, groupLabel: "From your answers", source: "assistant", matchIds: b.matchIds, unknownIds: b.unknownIds });
    }
    return chosen;
  }, [needs, selected, activeFacetId, applied]);

  useEffect(() => {
    if (categoryId) setNeeds(categoryId, selectedNeeds);
  }, [categoryId, selectedNeeds]);

  const value = useMemo<FilterState>(
    () => ({
      groups,
      ids,
      categoryId,
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
    [groups, ids, categoryId, selected, visible, assistantIds, assistantLabels],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCategoryFilters(): FilterState | null {
  return useContext(Ctx);
}
