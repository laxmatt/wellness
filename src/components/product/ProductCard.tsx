import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { CompareToggle } from "@/components/compare/CompareToggle";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { SpecRow } from "@/components/ui/SpecRow";
import type { CategoryDefinition } from "@/domain/category";
import { primaryStrength, primaryTradeoff, type RecommendedProduct } from "@/domain/recommend";

// Card budget: image, one badge, brand, name, price, three specs, one why
// line, one tradeoff line (hidden on phones), two actions. Nothing else.
export function ProductCard({ item, cat, priority = false }: { item: RecommendedProduct; cat: CategoryDefinition; priority?: boolean }) {
  const { view } = item;
  const href = `/products/${view.slug}`;
  const primaryBadge = item.badges[0];
  const strength = primaryStrength(view, cat);
  const tradeoff = primaryTradeoff(view, cat);
  const shopHref = view.offers.length === 1 ? view.offers[0].url : `${href}#retailers`;
  const external = view.offers.length === 1;

  return (
    <article className="lift flex flex-col overflow-hidden rounded-card bg-surface-raised shadow-card hover:-translate-y-0.5 hover:shadow-float">
      <Link href={href} className="relative block" aria-label={`${view.brand.name} ${view.name}`}>
        <ImageFrame image={primaryImage(view.images)} ratio="4/5" priority={priority} />
        {primaryBadge ? (
          <div className="absolute left-3 top-3">
            <Badge kind={primaryBadge} />
          </div>
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
        <div className="divide-y divide-edge border-y border-edge">
          {view.cardSpecs.slice(0, 3).map((s) => (
            <SpecRow key={s.key} spec={s} compact />
          ))}
        </div>
        {strength ? (
          <p className="line-clamp-2 text-sm text-fg">
            <span className="font-semibold text-positive">Why: </span>
            {strength}
          </p>
        ) : null}
        <p className="hidden line-clamp-1 text-sm text-fg-soft sm:block">
          <span className="font-semibold text-accent-strong">Tradeoff: </span>
          {tradeoff ?? "Not assessed"}
        </p>
        <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
          <CompareToggle item={{ id: view.id, slug: view.slug, name: view.name, categoryId: view.categoryId }} />
          <a
            href={shopHref}
            target={external ? "_blank" : undefined}
            rel={external ? "sponsored nofollow noopener" : undefined}
            className={buttonStyles("primary", "md")}
          >
            {view.offers.length > 1 ? `${view.offers.length} retailers` : "Shop"}
          </a>
        </div>
      </div>
    </article>
  );
}
