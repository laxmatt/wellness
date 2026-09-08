import type { Verification } from "@/domain/provenance";
import { cn } from "@/lib/cn";

const copy: Record<Verification, { label: string; className: string }> = {
  manufacturer_reported: { label: "Maker reported", className: "text-ink-soft border-line-strong" },
  independently_verified: { label: "Verified", className: "text-moss border-moss" },
  demo: { label: "Demo data", className: "text-ember-deep border-ember" },
  unknown: { label: "Unverified", className: "text-ink-mute border-line" },
};

export function VerificationTag({ verification, className }: { verification: Verification; className?: string }) {
  const c = copy[verification];
  return (
    <span className={cn("inline-flex items-center rounded-pill border px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em]", c.className, className)}>
      {c.label}
    </span>
  );
}
