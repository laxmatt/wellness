import type { Verification } from "@/domain/provenance";
import { cn } from "@/lib/cn";

const copy: Record<Verification, { label: string; className: string }> = {
  manufacturer_reported: { label: "Maker reported", className: "text-fg-soft border-edge-strong" },
  independently_verified: { label: "Verified", className: "text-positive border-positive" },
  demo: { label: "Demo data", className: "text-accent-strong border-accent" },
  // The source was read and says nothing about this. Not a value at all, so it
  // is never matched on and never scored.
  not_stated: { label: "Not stated", className: "text-fg-muted border-edge" },
  unknown: { label: "Unverified", className: "text-fg-muted border-edge" },
};

export function VerificationTag({ verification, className }: { verification: Verification; className?: string }) {
  const c = copy[verification];
  return (
    <span className={cn("inline-flex items-center rounded-pill border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em]", c.className, className)}>
      {c.label}
    </span>
  );
}
