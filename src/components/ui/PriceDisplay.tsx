import { formatMoney } from "@/domain/money";
import type { PriceView } from "@/domain/view";
import { cn } from "@/lib/cn";

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PriceDisplay({ price, size = "md", compact = false, className }: { price: PriceView; size?: "md" | "lg"; compact?: boolean; className?: string }) {
  const basis = price.basis === "reference" ? "Reference" : price.offerCount > 1 ? (compact ? `${price.offerCount} retailers` : `Lowest of ${price.offerCount} retailers`) : "1 retailer";
  return (
    <div className={cn("flex flex-col", compact ? "items-end text-right" : "", className)}>
      <span className={cn("tabular font-semibold", size === "lg" ? "text-3xl" : "text-lg")}>{formatMoney(price.money)}</span>
      <span className="whitespace-nowrap text-[11px] text-fg-muted">
        {basis} · {shortDate(price.checkedAt)}
      </span>
    </div>
  );
}
