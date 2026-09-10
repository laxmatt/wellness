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
  // Badges deliberately not awarded, and why. The UI states these rather than
  // silently showing fewer picks.
  withheld: { badge: Badge; reason: string }[];
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
// Best Value, Best Budget and Best Premium are claims about price, so a product
// whose price is a placeholder cannot win them. Best Overall is not a price
// claim, so it stands. Demo attribute values never reach the score at all;
// toScoringInput drops them.
//   Best Budget:  highest score among products at or under budgetMaxMinor,
//                 awarded only when at least minQualifying products sit in the
//                 tier, never to a product already holding a badge, and never
//                 to one scoring zero.
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
  const withheld: { badge: Badge; reason: string }[] = [];

  // Price-based badges only consider products with an observed price. Two
  // different reasons keep a product out: its amount is a placeholder, or it
  // has no amount at all because every offer on its record was withheld. The
  // copy names the first, because that is the one a reader can act on.
  const priced = eligible.filter((i) => !i.priceIsDemo && i.priceMinor !== undefined);
  const demoPricedCount = eligible.filter((i) => i.priceIsDemo).length;
  const demoPriceNote =
    demoPricedCount === 0
      ? ""
      : ` ${demoPricedCount} of ${eligible.length} products carry placeholder prices and were left out of price-based picks.`;

  const overall = ranked[0];
  if (overall) {
    taken.add(overall.id);
    badges.push({
      badge: "best_overall",
      productId: overall.id,
      reason: `Highest ${cat.scoring.label.toLowerCase()} (${scores.get(overall.id)!.score}) across ${cat.scoring.criteria.length} weighted criteria.`,
    });
  }

  const valueRanked = priced
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
      reason: `Best balance of ${cat.scoring.label.toLowerCase()} and price under the category value formula (value ${values.get(value.id)!.value}).${demoPriceNote}`,
    });
  } else {
    withheld.push({
      badge: "best_value",
      reason: demoPricedCount > 0 ? `No product has an observed price yet. ${demoPricedCount} of ${eligible.length} prices are placeholders.` : "No product qualified under the value formula.",
    });
  }

  // A tier badge is a recommendation, and a product that scores zero on every
  // weighted criterion is not the best of anything. Eligibility does not cover
  // this: it only says the record is complete enough to score, and a complete
  // record can still normalize to zero everywhere. Without this, Cold Plunges
  // handed Best Budget to a tub scoring 0, because the one better budget
  // candidate had already taken Best Value.
  const recommendable = (i: ScoringInput) => scores.get(i.id)!.score > 0;

  const basis = cat.badges.priceBasis;
  const rankedPriced = ranked.filter((i) => !i.priceIsDemo);
  const inTier = (pred: (p: number) => boolean) =>
    rankedPriced.filter((i) => {
      const p = numericFor(i, cat, basis);
      return p !== undefined && pred(p);
    });

  const budgetTier = inTier((p) => p <= cat.badges.budgetMaxMinor);
  if (budgetTier.length >= cat.badges.minQualifying) {
    const free = budgetTier.filter((i) => !taken.has(i.id));
    const winner = free.find(recommendable);
    if (winner) {
      taken.add(winner.id);
      badges.push({
        badge: "best_budget",
        productId: winner.id,
        reason: `Highest ${cat.scoring.label.toLowerCase()} among ${budgetTier.length} priced products at or under the budget line.${demoPriceNote}`,
      });
    } else {
      withheld.push({
        badge: "best_budget",
        reason:
          free.length === 0
            ? `Every priced product at or under the budget line already holds another badge.${demoPriceNote}`
            : `No remaining priced product at or under the budget line scores above zero across the weighted criteria.${demoPriceNote}`,
      });
    }
  } else {
    withheld.push({
      badge: "best_budget",
      reason: `Fewer than ${cat.badges.minQualifying} products with an observed price sit under the budget line.${demoPriceNote}`,
    });
  }

  const premiumTier = inTier((p) => p >= cat.badges.premiumMinMinor);
  if (premiumTier.length >= cat.badges.minQualifying) {
    const free = premiumTier.filter((i) => !taken.has(i.id));
    const winner = free.find(recommendable);
    if (winner) {
      taken.add(winner.id);
      badges.push({
        badge: "best_premium",
        productId: winner.id,
        reason: `Highest ${cat.scoring.label.toLowerCase()} among ${premiumTier.length} priced products at or above the premium line.${demoPriceNote}`,
      });
    } else {
      withheld.push({
        badge: "best_premium",
        reason:
          free.length === 0
            ? `Every priced product at or above the premium line already holds another badge.${demoPriceNote}`
            : `No remaining priced product at or above the premium line scores above zero across the weighted criteria.${demoPriceNote}`,
      });
    }
  } else {
    withheld.push({
      badge: "best_premium",
      reason: `Fewer than ${cat.badges.minQualifying} products with an observed price sit at or above the premium line.${demoPriceNote}`,
    });
  }

  const badgesByProduct: Record<string, Badge[]> = {};
  for (const b of badges) (badgesByProduct[b.productId] ??= []).push(b.badge);

  return {
    scores: Object.fromEntries(scores),
    values: Object.fromEntries(values),
    badges,
    badgesByProduct,
    ranking: ranked.map((i) => i.id),
    withheld,
  };
}
