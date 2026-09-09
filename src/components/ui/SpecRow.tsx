import { isUsable } from "@/domain/provenance";
import type { SpecView } from "@/domain/view";
import { VerificationTag } from "./VerificationTag";

export function SpecRow({ spec, compact = false }: { spec: SpecView; compact?: boolean }) {
  const showTag = spec.provenance && (spec.alwaysShowVerification || !isUsable(spec.provenance.verification));
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className={compact ? "text-xs text-fg-muted" : "text-sm text-fg-soft"}>{compact ? spec.shortLabel : spec.label}</span>
      <span className="flex items-center gap-1.5 text-right">
        <span className={compact ? "tabular text-sm font-semibold" : "tabular text-sm font-semibold"}>{spec.formatted}</span>
        {showTag && spec.provenance ? <VerificationTag verification={spec.provenance.verification} /> : null}
      </span>
    </div>
  );
}
