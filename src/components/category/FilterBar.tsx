"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCategoryFilters } from "./FilterContext";

// Filters run in the browser over id sets built on the server. Every product
// card is server-rendered and stays in the HTML; filtering hides children.
// Works without the assistant and without a round trip.
export function FilterChips() {
  const f = useCategoryFilters();
  if (!f || f.groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {f.groups.map((g) => (
        <div key={g.key} className="flex flex-wrap items-center gap-2">
          <span className="eyebrow w-full sm:w-28 sm:shrink-0">{g.label}</span>
          {g.options.map((o) => {
            const on = f.selected.includes(o.id);
            const count = f.countFor(g, o.id);
            const dead = count === 0 && !on;
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={on}
                disabled={dead}
                onClick={() => f.toggle(o.id)}
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
  );
}

export function FilterableGrid({ children, emptyHref, emptyLabel }: { children: ReactNode[]; emptyHref?: string; emptyLabel?: string }) {
  const f = useCategoryFilters();
  const indexOf = useMemo(() => new Map((f?.ids ?? []).map((id, i) => [id, i])), [f?.ids]);
  if (!f) return <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;

  return (
    <div>
      {f.fromAssistant ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-card border border-edge bg-surface-raised px-4 py-2 text-sm">
          <span className="eyebrow">From your answers</span>
          <span className="text-fg">{f.fromAssistant.labels.join("; ") || "Your stated preferences"}</span>
          <button type="button" onClick={f.clearAssistant} className="tap ml-auto font-semibold text-fg-soft underline-offset-2 hover:text-fg hover:underline">
            Remove
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex items-center gap-3 text-sm text-fg-muted">
        <span aria-live="polite">
          {f.visible.size} of {f.ids.length} shown
        </span>
        {f.active ? (
          <button type="button" onClick={f.clear} className="font-semibold text-fg-soft underline-offset-2 hover:text-fg hover:underline">
            Clear filters
          </button>
        ) : null}
      </div>

      {f.visible.size === 0 ? (
        <div className="rounded-card border border-edge bg-surface-raised p-8 text-center">
          <p className="font-display text-2xl">No product matches everything.</p>
          <p className="mt-2 text-fg-soft">
            {f.fromAssistant ? "Your answers and the filters together rule everything out. Remove one of them to see the closest options." : "Drop one filter to see the closest options."}
          </p>
          <button type="button" onClick={f.dropLast} className="tap mt-4 inline-flex items-center rounded-pill bg-control px-5 text-sm font-semibold text-control-fg hover:bg-control-hover">
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
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {/* The assistant's order when it has one, the page's otherwise. A
              preference that reorders nothing is not a preference. */}
          {(f.assistantOrder ?? f.ids).map((id) => (f.visible.has(id) ? children[indexOf.get(id)!] : null))}
        </div>
      )}
    </div>
  );
}
