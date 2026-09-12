"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { buttonStyles } from "@/components/ui/Button";
import { CompareToggle } from "@/components/compare/CompareToggle";
import { NeedsFit } from "@/components/needs/NeedsFit";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import type { CategoryDefinition } from "@/domain/category";
import { outboundLinkProps } from "@/domain/outbound";
import { buyableOffers, displayPrice } from "@/domain/view";
import { BADGES, BADGE_LABELS, primaryStrength, type RecommendationSet, type RecommendedProduct } from "@/domain/recommend";
import { formatMoney } from "@/domain/money";
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
            const merchants = buyableOffers(w.view);
            return (
              // An article, not a link. The whole card used to be one anchor,
              // which left no way to add a retailer link or a compare control
              // without nesting interactive elements inside it. The image and
              // the title are their own links now, so every way in still
              // works and each action is its own control.
              <article
                key={w.view.id}
                className={cn(
                  "lift group flex flex-col overflow-hidden rounded-card bg-surface-raised shadow-float ring-1 ring-edge hover:-translate-y-0.5",
                  isOutside && "opacity-60 ring-dashed",
                )}
              >
                <Link href={`/products/${w.view.slug}`} className="relative block" aria-label={`${w.view.brand.name} ${w.view.name}`}>
                  <ImageFrame image={primaryImage(w.view.images)} ratio="4/3" priority={i < 2} />
                  <div className="absolute left-3 top-3">
                    <Badge kind={w.badges[0]} className="px-3 py-1.5 text-xs" />
                  </div>
                </Link>
                <div className="flex flex-1 flex-col gap-2 p-5">
                  {isOutside ? <p className="text-xs font-semibold text-accent-strong">Outside your current filters</p> : null}
                  <p className="eyebrow">{w.view.brand.name}</p>
                  <p className="font-display text-2xl leading-tight">
                    <Link href={`/products/${w.view.slug}`} className="hover:underline">
                      {w.view.name}
                    </Link>
                  </p>
                  <p className="tabular text-xl font-semibold">{displayPrice(w.view.price)}</p>
                  {alsoValue ? <p className="text-xs font-semibold text-positive">Also the strongest value here.</p> : null}
                  {why ? <p className="text-sm text-fg-soft">{why}</p> : null}

                  {/* The same three things the comparison offers, in the same
                      words: every retailer on the record by name, a way to add
                      the product to a comparison, and a separate link to the
                      details. A product with nothing to link to shows no
                      outbound action rather than a fabricated one, and a
                      product whose amount is a placeholder keeps its retailer.
                      Nothing here claims stock. */}
                  {/* A badge is decided across the whole category and says
                      nothing about what this shopper asked for. Without this,
                      a pick could sit above a grid of cards all reading "does
                      not match" and be the only card on the page that never
                      said whether it fits. */}
                  <NeedsFit productId={w.view.id} categoryId={w.view.categoryId} limit={3} />
                  <div className="mt-auto flex flex-col gap-2 pt-3">
                    {merchants.map((o) => (
                      <a
                        key={o.id}
                        href={o.url}
                        {...outboundLinkProps(o.affiliateStatus)}
                        className={cn(buttonStyles("primary", "md"), "w-full justify-between gap-2 px-4")}
                      >
                        <span className="truncate">Visit {o.merchant.name}</span>
                        {o.priceIsDemo ? null : <span className="tabular shrink-0 opacity-80">{formatMoney(o.price)}</span>}
                      </a>
                    ))}
                    <div className="grid grid-cols-2 gap-2">
                      <CompareToggle item={{ id: w.view.id, slug: w.view.slug, name: w.view.name, categoryId: w.view.categoryId }} />
                      <Link href={`/products/${w.view.slug}`} className={buttonStyles("secondary", "md")}>
                        Details
                      </Link>
                    </div>
                    {merchants.length === 0 ? (
                      <p className="text-xs leading-snug text-fg-muted">
                        No retailer we can link to for this one. Details says what we hold.
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
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
