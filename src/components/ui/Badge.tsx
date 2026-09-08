import type { Badge as BadgeKind } from "@/domain/recommend/badges";
import { BADGE_LABELS } from "@/domain/recommend/badges";
import { cn } from "@/lib/cn";

const styles: Record<BadgeKind | "best_match", string> = {
  best_overall: "bg-badge-overall text-fg-inverse",
  best_value: "bg-badge-value text-fg-inverse",
  best_budget: "bg-badge-budget text-fg",
  best_premium: "bg-badge-premium text-fg-inverse",
  best_match: "bg-badge-match text-fg-inverse",
};

export function Badge({ kind, className }: { kind: BadgeKind | "best_match"; className?: string }) {
  const label = kind === "best_match" ? "Best Match for You" : BADGE_LABELS[kind];
  return (
    <span className={cn("inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]", styles[kind], className)}>
      {label}
    </span>
  );
}
