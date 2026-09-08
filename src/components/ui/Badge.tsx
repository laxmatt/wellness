import type { Badge as BadgeKind } from "@/domain/recommend/badges";
import { BADGE_LABELS } from "@/domain/recommend/badges";
import { cn } from "@/lib/cn";

const styles: Record<BadgeKind | "best_match", string> = {
  best_overall: "bg-ink text-paper",
  best_value: "bg-moss text-paper",
  best_budget: "bg-honey text-ink",
  best_premium: "bg-plum text-paper",
  best_match: "bg-ember text-paper",
};

export function Badge({ kind, className }: { kind: BadgeKind | "best_match"; className?: string }) {
  const label = kind === "best_match" ? "Best Match for You" : BADGE_LABELS[kind];
  return (
    <span className={cn("inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em]", styles[kind], className)}>
      {label}
    </span>
  );
}
