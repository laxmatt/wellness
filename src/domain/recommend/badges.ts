import type { CategoryDefinition } from "../category";
import { attributeDef } from "../category";
import { numericFor, scoreProducts, type ScoreResult, type ScoringInput } from "./score";
import { computeValue, type ValueResult } from "./value";

export const BADGES = ["best_overall", "best_value", "best_budget", "best_premium"] as const;
export type Badge = (typeof BADGES)[number];

export const BADGE_LABELS: Record<Badge, string> = {
  best_overall: "Best Overall",
  best_value: "Best Value",
  best_budget: "Best Budget",
  best_premium: "Best Premium",
};

export type BadgeAssignment = {
  badge: Badge;
  productId: string;
  reason: string;
};

export type RecommendationSet = {
  scores: Record<string, ScoreResult>;
  values: Record<string, ValueResult>;
  badges: BadgeAssignment[];
  badgesByProduct: Record<string, Badge[]>;
  // Eligible products sorted by score desc, tie-broken deterministically.
  ranking: string[];
};

function tieBreakCompare(a: ScoringInput, b: ScoringInput, cat: CategoryDefinition): number {
  for (const key of cat.badges.tieBreak) {
    const dir = attributeDef(cat, key)?.preferenceDirection ?? "higher_better";
    const av = numericFor(a, cat, key) ?? -Infinity;
    const bv = numericFor(b, cat, key) ?? -Infinity;
    if (av !== bv) return dir === "lower_better" ? av - bv : bv - av;
  }
  return a.id.localeCompare(b.id);
}

export function rankByScore(inputs: ScoringInput[], scores: Map<string, ScoreResult>, cat: CategoryDefinition): ScoringInput[] {
  return [...inputs].sort((a, b) => {
    const sa = scores.get(a.id)!.score;
    const sb = scores.get(b.id)!.score;
    if (sa !== sb) return sb - sa;
    return tieBreakCompare(a, b, cat);
  });
}

// Rules, in order:
//   Best Overall: highest score among eligible products.
//   Best Value:   highest value-formula result among eligible products. May be
//                 the same product as Best Overall; both are recorded, and the
//                 UI shows Overall with a value note rather than two badges.
//   Best Budget:  highest score among products at or under budgetMaxMinor,
//                 awarded only when at least minQualifying products sit in the
//                 tier, and never to a product already holding a badge.
//   Best Premium: same rule at or above premiumMinMinor.
// Offers and affiliate data are not inputs to any step.
export function assignBadges(inputs: ScoringInput[], cat: CategoryDefinition): RecommendationSet {
  const scoreList = scoreProducts(inputs, cat);
  const scores = new Map(scoreList.map((s) => [s.id, s]));
  const valueList = computeValue(inputs, scoreList, cat);
  const values = new Map(valueList.map((v) => [v.id, v]));

  const eligible = inputs.filter((i) => scores.get(i.id)!.eligible);
  const ranked = rankByScore(eligible, scores, cat);
  const taken = new Set<string>();
  const badges: BadgeAssignment[] = [];

  const overall = ranked[0];
  if (overall) {
    taken.add(overall.id);
    badges.push({
      badge: "best_overall",
      productId: overall.id,
      reason: `Highest weighted score (${scores.get(overall.id)!.score}) across ${cat.scoring.criteria.length} criteria.`,
    });
  }

  const valueRanked = eligible
    .filter((i) => values.get(i.id)!.eligible)
    .sort((a, b) => {
      const d = values.get(b.id)!.value - values.get(a.id)!.value;
      return d !== 0 ? d : tieBreakCompare(a, b, cat);
    });
  const value = valueRanked[0];
  if (value) {
    taken.add(value.id);
    badges.push({
      badge: "best_value",
      productId: value.id,
      reason: `Best score-to-price balance under the category value formula (value ${values.get(value.id)!.value}).`,
    });
  }

  const basis = cat.badges.priceBasis;
  const inTier = (pred: (p: number) => boolean) =>
    ranked.filter((i) => {
      const p = numericFor(i, cat, basis);
      return p !== undefined && pred(p);
    });

  const budgetTier = inTier((p) => p <= cat.badges.budgetMaxMinor);
  if (budgetTier.length >= cat.badges.minQualifying) {
    const winner = budgetTier.find((i) => !taken.has(i.id));
    if (winner) {
      taken.add(winner.id);
      badges.push({
        badge: "best_budget",
        productId: winner.id,
        reason: `Highest score among ${budgetTier.length} products at or under the budget line.`,
      });
    }
  }

  const premiumTier = inTier((p) => p >= cat.badges.premiumMinMinor);
  if (premiumTier.length >= cat.badges.minQualifying) {
    const winner = premiumTier.find((i) => !taken.has(i.id));
    if (winner) {
      taken.add(winner.id);
      badges.push({
        badge: "best_premium",
        productId: winner.id,
        reason: `Highest score among ${premiumTier.length} products at or above the premium line.`,
      });
    }
  }

  const badgesByProduct: Record<string, Badge[]> = {};
  for (const b of badges) (badgesByProduct[b.productId] ??= []).push(b.badge);

  return {
    scores: Object.fromEntries(scores),
    values: Object.fromEntries(values),
    badges,
    badgesByProduct,
    ranking: ranked.map((i) => i.id),
  };
}
