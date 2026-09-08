import type { CategoryDefinition } from "../category";
import type { ProductView } from "../view";
import { assignBadges, type Badge, type RecommendationSet } from "./badges";
import { deriveInsights, type Insight } from "./insights";
import { toScoringInput } from "./score";

export * from "./badges";
export * from "./insights";
export * from "./score";
export * from "./value";

export type RecommendedProduct = {
  view: ProductView;
  score: number;
  eligible: boolean;
  badges: Badge[];
  badgeReasons: string[];
  insights: Insight[];
};

export function recommendCategory(views: ProductView[], cat: CategoryDefinition): { set: RecommendationSet; products: RecommendedProduct[] } {
  const published = views.filter((v) => v.status === "published");
  const set = assignBadges(published.map(toScoringInput), cat);
  const order = new Map(set.ranking.map((id, i) => [id, i]));
  const products = published
    .map((view) => ({
      view,
      score: set.scores[view.id]?.score ?? 0,
      eligible: set.scores[view.id]?.eligible ?? false,
      badges: set.badgesByProduct[view.id] ?? [],
      badgeReasons: set.badges.filter((b) => b.productId === view.id).map((b) => b.reason),
      insights: deriveInsights(view, cat),
    }))
    .sort((a, b) => (order.get(a.view.id) ?? 999) - (order.get(b.view.id) ?? 999));
  return { set, products };
}
