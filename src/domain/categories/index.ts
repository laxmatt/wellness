import type { CategoryDefinition } from "../category";
import { coldPlunge } from "./cold-plunge";
import { redLight } from "./red-light";
import { wellnessDrinks } from "./wellness-drinks";

export const categories: CategoryDefinition[] = [redLight, coldPlunge, wellnessDrinks];

export function categoryById(id: string): CategoryDefinition | undefined {
  return categories.find((c) => c.id === id);
}

export function categoryBySlug(slug: string): CategoryDefinition | undefined {
  return categories.find((c) => c.slug === slug);
}

export { coldPlunge, redLight, wellnessDrinks };
