import type { CategoryDefinition } from "../category";
import { buyableOffers, type ProductView } from "../view";
import { assignBadges, type Badge, type RecommendationSet } from "./badges";
import { deriveInsights, type Insight } from "./insights";
import { toScoringInput, type ScoreResult } from "./score";

export * from "./badges";
export * from "./insights";
export * from "./score";
export * from "./value";

export type RecommendedProduct = {
  view: ProductView;
  score: number;
  scoreResult: ScoreResult;
  eligible: boolean;
  badges: Badge[];
  badgeReasons: string[];
  insights: Insight[];
};

export function recommendCategory(views: ProductView[], cat: CategoryDefinition): { set: RecommendationSet; products: RecommendedProduct[] } {
  const published = views.filter((v) => v.status === "published");
  // Which products a badge may point at. Computed here, from the views, so
  // ScoringInput stays free of offer data and ranking stays unable to see it.
  const sellable = new Set(published.filter((v) => buyableOffers(v).length > 0).map((v) => v.id));
  const set = assignBadges(published.map(toScoringInput), cat, sellable);
  const order = new Map(set.ranking.map((id, i) => [id, i]));
  const products = published
    .map((view) => ({
      view,
      score: set.scores[view.id]?.score ?? 0,
      scoreResult: set.scores[view.id],
      eligible: set.scores[view.id]?.eligible ?? false,
      badges: set.badgesByProduct[view.id] ?? [],
      badgeReasons: set.badges.filter((b) => b.productId === view.id).map((b) => b.reason),
      insights: deriveInsights(view, cat),
    }))
    .sort((a, b) => (order.get(a.view.id) ?? 999) - (order.get(b.view.id) ?? 999));
  return { set, products };
}
