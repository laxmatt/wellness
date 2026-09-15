import type { CategoryDefinition } from "../category";
import { saunas } from "./saunas";
import { coldPlunge } from "./cold-plunge";
import { redLight } from "./red-light";
import { wellnessDrinks } from "./wellness-drinks";

export const categories: CategoryDefinition[] = [redLight, coldPlunge, saunas, wellnessDrinks];
export const unpublishedCategories: CategoryDefinition[] = [];
export const allCategories: CategoryDefinition[] = [...categories, ...unpublishedCategories];

export function categoryById(id: string): CategoryDefinition | undefined {
  return allCategories.find((c) => c.id === id);
}

export const isPublishedCategory = (id: string): boolean => categories.some((c) => c.id === id);

export function categoryBySlug(slug: string): CategoryDefinition | undefined {
  return categories.find((c) => c.slug === slug);
}

export { coldPlunge, redLight, saunas, wellnessDrinks };
