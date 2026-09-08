import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { SpecRow } from "@/components/ui/SpecRow";
import type { RecommendedProduct } from "@/domain/recommend";

// Phase 1 card: static. Compare toggle and retailer CTA become live in Phase 2.
export function ProductCard({ item, strength, tradeoff }: { item: RecommendedProduct; strength?: string; tradeoff?: string }) {
  const { view } = item;
  // One badge per card. When Overall and Value coincide, Overall shows and the
  // value win becomes a note instead of a second competing badge.
  const primaryBadge = item.badges[0];
  const alsoStrongestValue = item.badges.includes("best_overall") && item.badges.includes("best_value");
  return (
    <article className="lift flex flex-col overflow-hidden rounded-card bg-paper shadow-card hover:-translate-y-0.5 hover:shadow-float">
      <div className="relative">
        <ImageFrame image={primaryImage(view.images)} ratio="4/5" />
        {primaryBadge ? (
          <div className="absolute left-3 top-3">
            <Badge kind={primaryBadge} />
          </div>
        ) : null}
        {view.flags.demo ? (
          <span className="absolute right-3 top-3 rounded-pill bg-paper/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-ember-deep">Demo</span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">{view.brand.name}</p>
            <h3 className="font-display text-xl leading-tight">{view.name}</h3>
          </div>
          <PriceDisplay price={view.price} />
        </div>
        <div className="divide-y divide-line border-y border-line">
          {view.cardSpecs.map((s) => (
            <SpecRow key={s.key} spec={s} compact />
          ))}
        </div>
        <div className="flex flex-col gap-1 text-sm">
          {alsoStrongestValue ? <p className="text-xs font-semibold text-moss">Also the strongest value in this category.</p> : null}
          {strength ? <p className="text-ink"><span className="font-semibold text-moss">Why: </span>{strength}</p> : null}
          {tradeoff ? <p className="text-ink-soft"><span className="font-semibold text-ember-deep">Tradeoff: </span>{tradeoff}</p> : null}
        </div>
        <div className="mt-auto flex gap-2 pt-1">
          <Button variant="secondary" className="flex-1" type="button">
            Compare
          </Button>
          <Button className="flex-1" type="button">
            {view.offers.length > 1 ? `${view.offers.length} retailers` : "Shop"}
          </Button>
        </div>
      </div>
    </article>
  );
}
