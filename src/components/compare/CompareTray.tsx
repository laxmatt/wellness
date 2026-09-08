"use client";

import Link from "next/link";
import { useCompare } from "./CompareProvider";

// Bottom bar, not a bubble. Appears only when something is selected. Sits in
// the flow's reserved bottom padding so no content is hidden behind it.
export function CompareTray({ categoryId }: { categoryId?: string }) {
  const { items, forCategory, remove, clear, ready } = useCompare();
  if (!ready) return null;
  const scoped = categoryId ? forCategory(categoryId) : items;
  if (scoped.length === 0) return null;
  const cats = new Set(scoped.map((i) => i.categoryId));
  const catId = categoryId ?? scoped[0].categoryId;
  const ids = scoped.filter((i) => i.categoryId === catId).map((i) => i.id);
  const href = `/compare?ids=${ids.join(",")}`;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl items-center gap-3 rounded-card border border-line-strong bg-paper/95 p-3 shadow-float backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {scoped
            .filter((i) => i.categoryId === catId)
            .map((i) => (
              <span key={i.id} className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-ivory-deep px-3 py-1.5 text-xs font-semibold">
                {i.name}
                <button type="button" aria-label={`Remove ${i.name}`} onClick={() => remove(i.id)} className="tap -mr-2 flex items-center justify-center text-ink-mute hover:text-ink">
                  ×
                </button>
              </span>
            ))}
          {cats.size > 1 && !categoryId ? <span className="shrink-0 text-xs text-ink-mute">Showing one category</span> : null}
        </div>
        <button type="button" onClick={() => clear(catId)} className="tap hidden text-sm font-semibold text-ink-mute hover:text-ink sm:inline-flex">
          Clear
        </button>
        <Link href={href} className="tap inline-flex items-center justify-center rounded-pill bg-ink px-5 text-sm font-semibold text-paper hover:bg-ember-deep">
          Compare {ids.length}
        </Link>
      </div>
    </div>
  );
}
