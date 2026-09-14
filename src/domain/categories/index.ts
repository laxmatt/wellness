import type { CategoryDefinition } from "../category";
import { coldPlunge } from "./cold-plunge";
import { redLight } from "./red-light";
import { saunas } from "./saunas";
import { wellnessDrinks } from "./wellness-drinks";

/**
 * The categories this site publishes.
 *
 * Everything a visitor can reach is built from this list: the navigation, the
 * home page, `/explore`, the sitemap, `getAllCategoryPages`, and the route
 * lookup below. Adding a category here publishes it.
 */
export const categories: CategoryDefinition[] = [redLight, coldPlunge, wellnessDrinks];

/**
 * Categories that exist for records and review, and are not published.
 *
 * A record needs its category to resolve before it can validate or render: the
 * catalogue check reads the attribute definitions, and `toProductView` needs
 * them to build a view. A category nobody has finished is still a category its
 * drafts have to be readable against.
 *
 * Keeping saunas here rather than in `categories` is the whole of the public
 * separation, and it is separation by construction rather than by a flag every
 * surface has to remember to check. Nothing links to it, `/saunas` does not
 * resolve, no sitemap holds it, and `getProductPage` refuses a product whose
 * category is not in the published list even if the product itself were
 * published.
 *
 * Moving saunas from this list to the one above is the act of launching the
 * category. It is one line, and it is deliberately one line somebody has to
 * write on purpose.
 */
export const unpublishedCategories: CategoryDefinition[] = [saunas];

/** Every category, published or not. For validation and review only. */
export const allCategories: CategoryDefinition[] = [...categories, ...unpublishedCategories];

/**
 * By id, across every category.
 *
 * Records resolve here, so a draft in an unpublished category validates and
 * renders in the operator tools. Visibility is decided by `categoryBySlug`,
 * which is what routing uses.
 */
export function categoryById(id: string): CategoryDefinition | undefined {
  return allCategories.find((c) => c.id === id);
}

/**
 * By slug, across published categories only.
 *
 * This is what `/[category]`, `/[category]/[facet]` and `getCategoryPage` ask,
 * so an unpublished category has no page to reach. It is the narrower lookup on
 * purpose: an id comes from a record we already hold, a slug comes from a URL a
 * stranger typed.
 */
export function categoryBySlug(slug: string): CategoryDefinition | undefined {
  return categories.find((c) => c.slug === slug);
}

export const isPublishedCategory = (id: string): boolean => categories.some((c) => c.id === id);

export { coldPlunge, redLight, saunas, wellnessDrinks };
