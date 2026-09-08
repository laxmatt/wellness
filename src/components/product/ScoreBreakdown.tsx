import type { CategoryDefinition } from "@/domain/category";
import { attributeDef } from "@/domain/category";
import type { ScoreResult } from "@/domain/recommend";

// The score is never shown as a bare number. Wherever it appears, the criteria,
// their weights and this product's standing on each are available, along with
// a plain statement of what the number does and does not measure.
export function ScoreBreakdown({ cat, result, className }: { cat: CategoryDefinition; result: ScoreResult; className?: string }) {
  return (
    <section className={className}>
      <div className="rounded-card border border-edge bg-surface-raised p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-xl">{cat.scoring.label}</h3>
          <p className="tabular text-2xl font-semibold">
            {result.score}
            <span className="text-base font-normal text-fg-muted"> / 100</span>
          </p>
        </div>
        <p className="mt-2 text-sm text-fg-soft">{cat.scoring.meaning}</p>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-left">
              <th className="pb-1.5 font-semibold text-fg-soft">Criterion</th>
              <th className="pb-1.5 text-right font-semibold text-fg-soft">Weight</th>
              <th className="pb-1.5 text-right font-semibold text-fg-soft">This product</th>
            </tr>
          </thead>
          <tbody>
            {result.criteria.map((c) => {
              const def = attributeDef(cat, c.key);
              const withheld = result.demoCriteria.includes(c.key);
              return (
                <tr key={c.key} className="border-b border-edge last:border-0">
                  <td className="py-2">
                    {def?.label ?? c.key}
                    {def?.scoreCap !== undefined ? <span className="text-fg-muted"> (capped at {def.scoreCap})</span> : null}
                  </td>
                  <td className="tabular py-2 text-right">{Math.round(c.share * 100)}%</td>
                  <td className="py-2 text-right">
                    {withheld ? (
                      <span className="text-accent-strong">Withheld, placeholder data</span>
                    ) : c.raw === undefined ? (
                      <span className="text-fg-muted">Not stated, scores 0</span>
                    ) : (
                      <span className="tabular font-semibold">{Math.round(c.normalized * 100)} / 100</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <p className="mt-3 text-xs text-fg-muted">
          Each criterion is scaled across every product in this category, so 100 means the highest figure we hold and 0 the lowest. A value we do not hold, or hold only as
          placeholder data, scores zero rather than being guessed.
        </p>
      </div>
    </section>
  );
}
