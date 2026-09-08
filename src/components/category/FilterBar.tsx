"use client";

import { useMemo, useState, type ReactNode } from "react";
import { applyFilters, type FilterGroup } from "@/domain/filters";
import { cn } from "@/lib/cn";

// Filters run in the browser over id sets built on the server. Every product
// card is server-rendered and stays in the HTML; filtering hides children.
// Works without the matcher and without a round trip.
export function FilterableGrid({
  groups,
  ids,
  children,
  emptyHref,
  emptyLabel,
}: {
  groups: FilterGroup[];
  ids: string[];
  children: ReactNode[];
  emptyHref?: string;
  emptyLabel?: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const visible = useMemo(() => new Set(applyFilters(ids, groups, selected)), [ids, groups, selected]);
  const indexOf = useMemo(() => new Map(ids.map((id, i) => [id, i])), [ids]);

  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Count for each option given the other groups' selections.
  const countFor = (group: FilterGroup, optionId: string) => {
    const others = selected.filter((s) => !group.options.some((o) => o.id === s));
    const withOption = applyFilters(ids, groups, [...others, optionId]);
    return withOption.length;
  };

  if (groups.length === 0) return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;

  return (
    <div>
      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-wrap items-center gap-2">
            <span className="eyebrow w-full sm:w-28 sm:shrink-0">{g.label}</span>
            {g.options.map((o) => {
              const on = selected.includes(o.id);
              const count = countFor(g, o.id);
              const dead = count === 0 && !on;
              return (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={on}
                  disabled={dead}
                  onClick={() => toggle(o.id)}
                  className={cn(
                    "tap inline-flex items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium transition-colors",
                    on ? "border-fg bg-fg text-fg-inverse" : "border-edge-strong bg-surface-raised text-fg hover:border-fg",
                    dead && "opacity-40",
                  )}
                >
                  {o.label}
                  <span className={cn("tabular text-xs", on ? "text-fg-inverse/70" : "text-fg-muted")}>{count}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm text-fg-muted">
        <span aria-live="polite">
          {visible.size} of {ids.length} shown
        </span>
        {selected.length > 0 ? (
          <button type="button" onClick={() => setSelected([])} className="font-semibold text-fg-soft underline-offset-2 hover:text-fg hover:underline">
            Clear filters
          </button>
        ) : null}
      </div>

      {visible.size === 0 ? (
        <div className="mt-6 rounded-card border border-edge bg-surface-raised p-8 text-center">
          <p className="font-display text-2xl">No product matches every filter.</p>
          <p className="mt-2 text-fg-soft">Drop one filter to see the closest options.</p>
          <button type="button" onClick={() => setSelected(selected.slice(0, -1))} className="tap mt-4 inline-flex items-center rounded-pill bg-control px-5 text-sm font-semibold text-control-fg hover:bg-control-hover">
            Remove the last filter
          </button>
          {emptyHref ? (
            <p className="mt-3 text-sm">
              <a href={emptyHref} className="font-semibold text-accent-strong hover:underline">
                {emptyLabel ?? "See everything"}
              </a>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {ids.map((id) => (visible.has(id) ? children[indexOf.get(id)!] : null))}
        </div>
      )}
    </div>
  );
}
