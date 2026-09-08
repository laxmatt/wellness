import Link from "next/link";
import { CompareToggle } from "@/components/compare/CompareToggle";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { SpecRow } from "@/components/ui/SpecRow";
import type { CategoryDefinition } from "@/domain/category";
import { primaryStrength, primaryTradeoff, type RecommendedProduct } from "@/domain/recommend";

export function ProductCard({ item, cat, priority = false }: { item: RecommendedProduct; cat: CategoryDefinition; priority?: boolean }) {
  const { view } = item;
  const href = `/products/${view.slug}`;
  // One badge per card. When Overall and Value coincide, Overall shows and the
  // value win becomes a note instead of a second competing badge.
  const primaryBadge = item.badges[0];
  const alsoStrongestValue = item.badges.includes("best_overall") && item.badges.includes("best_value");
  const strength = primaryStrength(view, cat);
  const tradeoff = primaryTradeoff(view, cat);
  const shopHref = view.offers.length === 1 ? view.offers[0].url : `${href}#retailers`;
  const external = view.offers.length === 1;

  return (
    <article className="lift flex flex-col overflow-hidden rounded-card bg-paper shadow-card hover:-translate-y-0.5 hover:shadow-float">
      <Link href={href} className="relative block" aria-label={`${view.brand.name} ${view.name}`}>
        <ImageFrame image={primaryImage(view.images)} ratio="4/5" priority={priority} />
        {primaryBadge ? (
          <div className="absolute left-3 top-3">
            <Badge kind={primaryBadge} />
          </div>
        ) : null}
        {view.flags.demo ? (
          <span className="absolute right-3 top-3 rounded-pill bg-paper/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ember-deep">Demo</span>
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">{view.brand.name}</p>
            <h3 className="font-display text-xl leading-tight">
              <Link href={href} className="hover:underline">
                {view.name}
              </Link>
            </h3>
          </div>
          <PriceDisplay price={view.price} compact />
        </div>
        <div className="divide-y divide-line border-y border-line">
          {view.cardSpecs.map((s) => (
            <SpecRow key={s.key} spec={s} compact />
          ))}
        </div>
        <div className="flex flex-col gap-1 text-sm">
          {alsoStrongestValue ? <p className="text-xs font-semibold text-moss">Also the strongest value in this category.</p> : null}
          {strength ? (
            <p className="text-ink">
              <span className="font-semibold text-moss">Why: </span>
              {strength}
            </p>
          ) : null}
          {tradeoff ? (
            <p className="text-ink-soft">
              <span className="font-semibold text-ember-deep">Tradeoff: </span>
              {tradeoff}
            </p>
          ) : null}
        </div>
        <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
          <CompareToggle item={{ id: view.id, slug: view.slug, name: view.name, categoryId: view.categoryId }} />
          <a
            href={shopHref}
            target={external ? "_blank" : undefined}
            rel={external ? "sponsored nofollow noopener" : undefined}
            className="tap inline-flex items-center justify-center rounded-pill bg-ink px-4 text-sm font-semibold text-paper hover:bg-ember-deep"
          >
            {view.offers.length > 1 ? `${view.offers.length} retailers` : "Shop"}
          </a>
        </div>
      </div>
    </article>
  );
}
