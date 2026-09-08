import { formatMoney } from "@/domain/money";
import type { PriceView } from "@/domain/view";
import { cn } from "@/lib/cn";

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PriceDisplay({ price, size = "md", className }: { price: PriceView; size?: "md" | "lg"; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className={cn("tabular font-semibold", size === "lg" ? "text-3xl" : "text-lg")}>{formatMoney(price.money)}</span>
      <span className="text-[11px] text-ink-mute">
        {price.basis === "reference" ? "Reference price" : price.offerCount > 1 ? `Lowest of ${price.offerCount} retailers` : "1 retailer"} · checked {shortDate(price.checkedAt)}
      </span>
    </div>
  );
}
