import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import { formatMoney } from "@/domain/money";
import type { RecommendedProduct } from "@/domain/recommend";

// Compact card for rails and winners rows. Image, badge, brand, name, price.
export function MiniCard({ item, note }: { item: RecommendedProduct; note?: string }) {
  const { view } = item;
  const badge = item.badges[0];
  return (
    <Link href={`/products/${view.slug}`} className="lift group flex flex-col overflow-hidden rounded-card bg-paper shadow-card hover:-translate-y-0.5 hover:shadow-float">
      <div className="relative">
        <ImageFrame image={primaryImage(view.images)} ratio="1/1" />
        {badge ? (
          <div className="absolute left-3 top-3">
            <Badge kind={badge} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <p className="eyebrow">{view.brand.name}</p>
        <p className="font-display text-lg leading-tight group-hover:underline">{view.name}</p>
        <p className="tabular text-sm font-semibold">{formatMoney(view.price.money)}</p>
        {note ? <p className="mt-1 text-xs text-ink-soft">{note}</p> : null}
      </div>
    </Link>
  );
}
