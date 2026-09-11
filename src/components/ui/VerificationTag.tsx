import { attributionTag, type Attributed, type Verification } from "@/domain/provenance";
import { cn } from "@/lib/cn";

const className: Record<Verification, string> = {
  manufacturer_reported: "text-fg-soft border-edge-strong",
  independently_verified: "text-positive border-positive",
  demo: "text-accent-strong border-accent",
  // The source was read and says nothing about this. Not a value at all, so it
  // is never matched on and never scored.
  not_stated: "text-fg-muted border-edge",
  unknown: "text-fg-muted border-edge",
};

/**
 * The tag beside a value.
 *
 * `source` is optional and only changes the wording: a maker's figure that
 * reached this site through a retailer's listing says so, instead of reading as
 * though the maker's own page had been opened. Everything else, including which
 * values are usable and how anything ranks, is decided by `verification` alone
 * and is untouched by this.
 */
export function VerificationTag({
  verification,
  source,
  className: extra,
}: {
  verification: Verification;
  source?: Attributed["source"];
  className?: string;
}) {
  const label = attributionTag({ verification, source: source ?? { kind: "manufacturer", method: "direct" } });
  return (
    <span className={cn("inline-flex items-center rounded-pill border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em]", className[verification], extra)}>
      {label}
    </span>
  );
}
