import { formatMoney } from "@/domain/money";
import type { PriceView } from "@/domain/view";
import { cn } from "@/lib/cn";
import { VerificationTag } from "./VerificationTag";

function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function PriceDisplay({ price, size = "md", compact = false, className }: { price: PriceView; size?: "md" | "lg"; compact?: boolean; className?: string }) {
  const basis = price.basis === "reference" ? "Reference" : price.offerCount > 1 ? (compact ? `${price.offerCount} retailers` : `Lowest of ${price.offerCount} retailers`) : "1 retailer";
  return (
    <div className={cn("flex flex-col", compact ? "items-end text-right" : "", className)}>
      <span className={cn("tabular font-semibold", size === "lg" ? "text-3xl" : "text-lg")}>{formatMoney(price.money)}</span>
      {/* A placeholder price was excluded from badges, from price claims and
          from the assistant, and shown to the shopper as a price like any
          other. Every placeholder spec on the page carries a tag; the number
          people actually decide on carried nothing. */}
      {price.isDemo ? (
        <span className={cn("mt-0.5 flex items-center gap-1", compact ? "justify-end" : "")}>
          <VerificationTag verification="demo" />
        </span>
      ) : null}
      <span className="whitespace-nowrap text-[11px] text-fg-muted">
        {basis} · {shortDate(price.checkedAt)}
      </span>
    </div>
  );
}
