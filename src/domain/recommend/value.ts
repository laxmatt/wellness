import type { CategoryDefinition, ValueFormulaConfig } from "../category";
import { numericFor, type ScoreResult, type ScoringInput } from "./score";

export type ValueResult = {
  id: string;
  value: number;
  scoreRatio: number;
  relPrice: number;
  priceBasisValue: number | undefined;
  eligible: boolean;
  reason?: string;
};

// value = qualityWeight * scoreRatio - priceWeight * relPrice
//   scoreRatio = score / best score in category            (0..1, best = 1)
//   relPrice   = log(price / cheapest admitted) / log(most expensive / cheapest)
//                or the linear equivalent                  (0..1, cheapest = 0)
// The cheapest admitted product keeps its full scoreRatio as value. The best
// product pays for its price. Products below minScoreShare of the best score
// are excluded so cheapness alone cannot win.
export function computeValue(
  inputs: ScoringInput[],
  scores: ScoreResult[],
  cat: CategoryDefinition,
  override?: Partial<ValueFormulaConfig>,
): ValueResult[] {
  const cfg: ValueFormulaConfig = { ...cat.value, ...override };
  const scoreById = new Map(scores.map((s) => [s.id, s]));

  const candidates = inputs
    .map((i) => ({ input: i, score: scoreById.get(i.id), price: numericFor(i, cat, cfg.priceBasis) }))
    .filter((c) => c.score !== undefined && c.score.eligible && c.price !== undefined && c.price > 0) as {
    input: ScoringInput;
    score: ScoreResult;
    price: number;
  }[];

  const bestScore = Math.max(0, ...candidates.map((c) => c.score.score));
  const admitted = candidates.filter((c) => c.score.score >= cfg.minScoreShare * bestScore);
  const admittedIds = new Set(admitted.map((c) => c.input.id));

  const scale = (p: number) => (cfg.priceScale === "log" ? Math.log(p) : p);
  const prices = admitted.map((c) => scale(c.price));
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);

  return inputs.map((i) => {
    const c = candidates.find((x) => x.input.id === i.id);
    if (!c) {
      return { id: i.id, value: -Infinity, scoreRatio: 0, relPrice: 0, priceBasisValue: undefined, eligible: false, reason: "ineligible or no price basis" };
    }
    if (!admittedIds.has(i.id)) {
      return { id: i.id, value: -Infinity, scoreRatio: 0, relPrice: 0, priceBasisValue: c.price, eligible: false, reason: `score below ${Math.round(cfg.minScoreShare * 100)}% of best` };
    }
    const scoreRatio = bestScore === 0 ? 0 : c.score.score / bestScore;
    const relPrice = maxP === minP ? 0 : (scale(c.price) - minP) / (maxP - minP);
    const value = cfg.qualityWeight * scoreRatio - cfg.priceWeight * relPrice;
    return { id: i.id, value: Math.round(value * 1000) / 1000, scoreRatio, relPrice, priceBasisValue: c.price, eligible: true };
  });
}
