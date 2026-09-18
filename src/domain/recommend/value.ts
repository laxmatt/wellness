import type { CategoryDefinition, ValueFormulaConfig } from "../category";
import { numericFor, type ScoreResult, type ScoringInput } from "./score";

export type ValueResult = {
  id: string;
  value: number;
  quality: number;
  affordability: number;
  priceBasisValue: number | undefined;
  eligible: boolean;
  reason?: string;
};

// Phase 1 placeholder. Explainable, tunable per category, not final.
//   quality       = product score, already 0..100
//   affordability = 100 * (maxPrice - price) / (maxPrice - minPrice)
//                   across eligible products, so cheapest = 100, priciest = 0
//   value         = qualityWeight * quality + affordabilityWeight * affordability
// priceBasis is "price" or "attribute:<key>" (drinks use per-serving cost).
// minQualityShare is an optional guard, default 0 (off): products below that
// fraction of the best score are excluded from the value ranking.
export function computeValue(
  inputs: ScoringInput[],
  scores: ScoreResult[],
  cat: CategoryDefinition,
  override?: Partial<ValueFormulaConfig>,
): ValueResult[] {
  const cfg: ValueFormulaConfig = { ...cat.value, ...override };
  const scoreById = new Map(scores.map((s) => [s.id, s]));

  // A placeholder price is not a price. It earns no value number, and it does
  // not stretch the range every other product's affordability is measured
  // against: six of the eight red-light panels carry one, and their invented
  // figures were setting both ends of that range.
  const candidates = inputs
    .filter((i) => !i.priceIsDemo)
    .map((i) => ({ input: i, score: scoreById.get(i.id), price: numericFor(i, cat, cfg.priceBasis) }))
    .filter((c) => c.score !== undefined && c.score.eligible && c.price !== undefined && c.price > 0) as {
    input: ScoringInput;
    score: ScoreResult;
    price: number;
  }[];

  const bestScore = Math.max(0, ...candidates.map((c) => c.score.score));
  const admitted = candidates.filter((c) => c.score.score >= cfg.minQualityShare * bestScore);
  const admittedIds = new Set(admitted.map((c) => c.input.id));

  const prices = admitted.map((c) => c.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);

  return inputs.map((i) => {
    const c = candidates.find((x) => x.input.id === i.id);
    if (!c) {
      return {
        id: i.id,
        value: -Infinity,
        quality: 0,
        affordability: 0,
        priceBasisValue: undefined,
        eligible: false,
        reason: i.priceIsDemo
          ? "price is placeholder data, so there is nothing to weigh it against"
          : i.priceMinor === undefined && cfg.priceBasis === "price"
            ? "no amount on record, so there is nothing to weigh against the score"
            : "ineligible or no price basis",
      };
    }
    if (!admittedIds.has(i.id)) {
      return { id: i.id, value: -Infinity, quality: c.score.score, affordability: 0, priceBasisValue: c.price, eligible: false, reason: `score below ${Math.round(cfg.minQualityShare * 100)}% of best` };
    }
    const quality = c.score.score;
    const affordability = maxP === minP ? 100 : (100 * (maxP - c.price)) / (maxP - minP);
    const value = cfg.qualityWeight * quality + cfg.affordabilityWeight * affordability;
    return {
      id: i.id,
      value: Math.round(value * 10) / 10,
      quality,
      affordability: Math.round(affordability * 10) / 10,
      priceBasisValue: c.price,
      eligible: true,
    };
  });
}
