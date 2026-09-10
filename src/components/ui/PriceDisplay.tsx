import { formatMoney } from "@/domain/money";
import { PRICE_UNCONFIRMED, type PriceView } from "@/domain/view";
import { cn } from "@/lib/cn";


function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PriceDisplay({ price, size = "md", compact = false, className }: { price: PriceView; size?: "md" | "lg"; compact?: boolean; className?: string }) {
  const basis = price.basis === "reference" ? "Reference" : price.offerCount > 1 ? (compact ? `${price.offerCount} retailers` : `Lowest of ${price.offerCount} retailers`) : "1 retailer";

  // No amount at all: nothing on the record can price this product. Neither
  // the retailer count nor the date belongs here. The count would be "1
  // retailer" from a fallback with zero retailers behind it, and the date is
  // the record's last edit, which would read as the day somebody checked a
  // price that does not exist.
  if (price.money === undefined) {
    return (
      <div className={cn("flex flex-col", compact ? "items-end text-right" : "", className)}>
        <span className={cn("font-semibold", size === "lg" ? "text-2xl" : "text-base")}>{PRICE_UNCONFIRMED}</span>
        <span className="whitespace-nowrap text-[11px] text-fg-muted">Current price unavailable</span>
      </div>
    );
  }

  // A placeholder amount is not shown at all. It was excluded from badges,
  // from price claims and from the assistant, and still printed on the card as
  // though somebody had quoted it. The shopper is sent to the merchant, which
  // is where the real number is.
  if (price.isDemo) {
    return (
      <div className={cn("flex flex-col", compact ? "items-end text-right" : "", className)}>
        <span className={cn("font-semibold", size === "lg" ? "text-2xl" : "text-base")}>{PRICE_UNCONFIRMED}</span>
        <span className="whitespace-nowrap text-[11px] text-fg-muted">No price confirmed yet</span>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col", compact ? "items-end text-right" : "", className)}>
      <span className={cn("tabular font-semibold", size === "lg" ? "text-3xl" : "text-lg")}>{formatMoney(price.money)}</span>
      <span className="whitespace-nowrap text-[11px] text-fg-muted">
        {basis} · {shortDate(price.checkedAt)}
      </span>
    </div>
  );
}
