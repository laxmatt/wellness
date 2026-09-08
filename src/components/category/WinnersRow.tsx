"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import type { CategoryDefinition } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import { BADGES, BADGE_LABELS, primaryStrength, type RecommendationSet, type RecommendedProduct } from "@/domain/recommend";
import { cn } from "@/lib/cn";
import { useCategoryFilters } from "./FilterContext";

// Picks are decided across the whole category, never within the shopper's
// current filters: a badge that changed every time a chip moved would not mean
// anything. When a pick falls outside the active filters the card says so
// rather than sitting there contradicting the grid below it.
export function WinnersRow({ products, cat, set }: { products: RecommendedProduct[]; cat: CategoryDefinition; set: RecommendationSet }) {
  const f = useCategoryFilters();
  const winners = BADGES.map((b) => products.find((p) => p.badges[0] === b)).filter((p): p is RecommendedProduct => p !== undefined);
  if (winners.length === 0) return null;
  const cols = winners.length >= 4 ? "lg:grid-cols-4" : winners.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  const outside = f?.active ? winners.filter((w) => !f.visible.has(w.view.id)).length : 0;

  return (
    <section className="bg-surface-raised/70 py-10 sm:py-14">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Our picks</p>
            <h2 className="font-display mt-1 text-4xl sm:text-5xl">Where to start.</h2>
          </div>
          <Link href="/how-we-choose" className="tap hidden items-center text-sm font-semibold text-accent-strong hover:underline sm:inline-flex">
            How badges are decided
          </Link>
        </div>

        <p className="mt-2 max-w-3xl text-sm text-fg-soft">
          Chosen across all {products.length} {cat.name.toLowerCase()} we track, so they do not change as you filter.
          {outside > 0 ? ` ${outside} of these ${outside === 1 ? "sits" : "sit"} outside your current filters and ${outside === 1 ? "is" : "are"} marked below.` : ""}
        </p>

        <div className={`mt-7 grid gap-5 sm:grid-cols-2 ${cols}`}>
          {winners.map((w, i) => {
            const alsoValue = w.badges.includes("best_overall") && w.badges.includes("best_value");
            const why = primaryStrength(w.view, cat);
            const isOutside = f?.active === true && !f.visible.has(w.view.id);
            return (
              <Link
                key={w.view.id}
                href={`/products/${w.view.slug}`}
                className={cn(
                  "lift group flex flex-col overflow-hidden rounded-card bg-surface-raised shadow-float ring-1 ring-edge hover:-translate-y-0.5",
                  isOutside && "opacity-60 ring-dashed",
                )}
              >
                <div className="relative">
                  <ImageFrame image={primaryImage(w.view.images)} ratio="4/3" priority={i < 2} />
                  <div className="absolute left-3 top-3">
                    <Badge kind={w.badges[0]} className="px-3 py-1.5 text-xs" />
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  {isOutside ? <p className="text-xs font-semibold text-accent-strong">Outside your current filters</p> : null}
                  <p className="eyebrow">{w.view.brand.name}</p>
                  <p className="font-display text-2xl leading-tight group-hover:underline">{w.view.name}</p>
                  <p className="tabular text-xl font-semibold">{formatMoney(w.view.price.money)}</p>
                  {alsoValue ? <p className="text-xs font-semibold text-positive">Also the strongest value here.</p> : null}
                  {why ? <p className="text-sm text-fg-soft">{why}</p> : null}
                  <span className="mt-auto pt-2 text-sm font-semibold text-accent-strong">See details</span>
                </div>
              </Link>
            );
          })}
        </div>

        {set.withheld.length > 0 ? (
          <div className="mt-5 rounded-card border border-dashed border-edge-strong bg-surface p-4">
            <p className="eyebrow">Not awarded</p>
            <ul className="mt-2 flex flex-col gap-1.5 text-sm text-fg-soft">
              {set.withheld.map((w) => (
                <li key={w.badge}>
                  <span className="font-semibold text-fg">{BADGE_LABELS[w.badge]}:</span> {w.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
