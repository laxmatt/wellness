import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import type { CategoryDefinition } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import { BADGES, primaryStrength, type RecommendedProduct } from "@/domain/recommend";

// Full-bleed band so the picks read as the category's headline, above the
// full grid. One card per awarded badge; Value folds into Overall when shared.
export function WinnersRow({ products, cat }: { products: RecommendedProduct[]; cat: CategoryDefinition }) {
  const winners = BADGES.map((b) => products.find((p) => p.badges[0] === b)).filter((p): p is RecommendedProduct => p !== undefined);
  if (winners.length === 0) return null;
  const cols = winners.length >= 4 ? "lg:grid-cols-4" : winners.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
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
        <div className={`mt-7 grid gap-5 sm:grid-cols-2 ${cols}`}>
          {winners.map((w, i) => {
            const alsoValue = w.badges.includes("best_overall") && w.badges.includes("best_value");
            const why = primaryStrength(w.view, cat);
            return (
              <Link
                key={w.view.id}
                href={`/products/${w.view.slug}`}
                className="lift group flex flex-col overflow-hidden rounded-card bg-surface-raised shadow-float ring-1 ring-edge hover:-translate-y-0.5"
              >
                <div className="relative">
                  <ImageFrame image={primaryImage(w.view.images)} ratio="4/3" priority={i < 2} />
                  <div className="absolute left-3 top-3">
                    <Badge kind={w.badges[0]} className="px-3 py-1.5 text-xs" />
                  </div>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-5">
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
      </div>
    </section>
  );
}
