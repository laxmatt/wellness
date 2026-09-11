import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { CompareToggle } from "@/components/compare/CompareToggle";
import { NeedsFit } from "@/components/needs/NeedsFit";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { SpecRow } from "@/components/ui/SpecRow";
import type { CategoryDefinition } from "@/domain/category";
import { primaryStrength, primaryTradeoff, type RecommendedProduct } from "@/domain/recommend";
import { buyableOffers } from "@/domain/view";

// Card budget: image, one badge, brand, name, price, three specs, one why
// line, one tradeoff line (hidden on phones), two actions. Nothing else.
export function ProductCard({ item, cat, priority = false }: { item: RecommendedProduct; cat: CategoryDefinition; priority?: boolean }) {
  const { view } = item;
  const href = `/products/${view.slug}`;
  const primaryBadge = item.badges[0];
  const strength = primaryStrength(view, cat);
  const tradeoff = primaryTradeoff(view, cat);
  // Only offers a shopper can be sent to. A card sent people straight to a
  // withheld listing whenever a product had exactly one offer and that offer
  // was the withheld one: Plunge's card carried a Shop button to a page whose
  // configuration nobody has matched, which the product page already refuses
  // to link.
  const buyable = buyableOffers(view);
  // Destination AND label from the same list. The href already came from
  // `buyable` and the label still counted `view.offers`, which holds the
  // withheld ones too, so a product with two offers and one of them withheld
  // advertised "2 retailers" over a link to the single one a shopper can
  // actually be sent to. With none buyable it said "Shop" over an anchor that
  // goes nowhere a shopper can buy.
  const external = buyable.length === 1;
  const shopHref = external ? buyable[0].url : buyable.length > 1 ? `${href}#retailers` : href;
  // Nothing to shop is not a shop button. The product page still says what is
  // known and why no retailer is listed, so the way in stays.
  const shopLabel = buyable.length > 1 ? `${buyable.length} retailers` : buyable.length === 1 ? "Shop" : "Details";

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
        {/* Only when there is one. A card said "Tradeoff: Not assessed"
            whenever no rule fired, which is every category winner, so all four
            cards on the home page carried the same empty line. The statement
            still exists where it can be read properly: the product page says
            what "not assessed" means, and the compare table keeps its row. */}
        {tradeoff ? (
          <p className="hidden line-clamp-1 text-sm text-fg-soft sm:block">
            <span className="font-semibold text-accent-strong">Tradeoff: </span>
            {tradeoff}
          </p>
        ) : null}
        {/* Only when the shopper has asked for something. No filters means no
            fit, and nothing here guesses at one. Three rows on a card, the rest
            behind a control: conflicts first, because a shopper scanning a grid
            is looking for the reason to stop. */}
        <NeedsFit productId={view.id} categoryId={view.categoryId} limit={3} />
        <div className="mt-auto grid grid-cols-2 gap-2 pt-1">
          <CompareToggle item={{ id: view.id, slug: view.slug, name: view.name, categoryId: view.categoryId }} />
          <a
            href={shopHref}
            target={external ? "_blank" : undefined}
            rel={external ? "sponsored nofollow noopener" : undefined}
            className={buttonStyles("primary", "md")}
          >
            {shopLabel}
          </a>
        </div>
      </div>
    </article>
  );
}
