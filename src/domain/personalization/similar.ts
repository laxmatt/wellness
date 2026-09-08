import type { CategoryDefinition } from "../category";
import { comparable } from "../conditions";
import type { ProductView } from "../view";

// Attribute-distance similarity. Numeric and ordinal keys are compared after
// min-max normalization across the category; list keys use Jaccard distance.
// Price carries the same weight as the heaviest category criterion: a shopper
// looking at a $139 panel does not consider a $1,249 one an alternative, however
// close the specs read. A missing value on either side costs a full span so
// products with thin data do not appear similar to everything.
const PRICE_WEIGHT = 3;
const MISSING_PENALTY = 1;

export function similarProducts(target: ProductView, pool: ProductView[], cat: CategoryDefinition, limit = 3): ProductView[] {
  const others = pool.filter((v) => v.id !== target.id && v.status === "published");
  if (others.length === 0) return [];
  const all = [target, ...others];

  const keys = cat.scoring.criteria.map((c) => c.key);
  const ranges = new Map<string, { min: number; max: number }>();
  for (const k of [...keys, "price"]) {
    const vals = all.map((v) => comparable(v, cat, k)).filter((n): n is number => n !== undefined);
    if (vals.length > 1) ranges.set(k, { min: Math.min(...vals), max: Math.max(...vals) });
  }

  const listKeys = cat.attributeDefinitions.filter((d) => d.type === "list").map((d) => d.key);
  const weightOf = (k: string) => (k === "price" ? PRICE_WEIGHT : (cat.scoring.criteria.find((c) => c.key === k)?.weight ?? 1));

  const distance = (v: ProductView): number => {
    let sum = 0;
    let total = 0;
    for (const k of [...keys, "price"]) {
      const r = ranges.get(k);
      if (!r || r.max === r.min) continue;
      const a = comparable(target, cat, k);
      const b = comparable(v, cat, k);
      const w = weightOf(k);
      total += w;
      sum += w * (a === undefined || b === undefined ? MISSING_PENALTY : Math.abs(a - b) / (r.max - r.min));
    }
    for (const k of listKeys) {
      const a = target.attributes[k];
      const b = v.attributes[k];
      if (!Array.isArray(a) || !Array.isArray(b)) continue;
      const A = new Set(a as string[]);
      const B = new Set(b as string[]);
      const inter = [...A].filter((x) => B.has(x)).length;
      const union = new Set([...A, ...B]).size;
      if (union === 0) continue;
      const w = 0.5;
      total += w;
      sum += w * (1 - inter / union);
    }
    if (total === 0) return 1;
    // Same subcategory pulls products together slightly.
    const sameSub = target.subcategoryId && target.subcategoryId === v.subcategoryId ? 0.9 : 1;
    return (sum / total) * sameSub;
  };

  return others
    .map((v) => ({ v, d: distance(v) }))
    .sort((a, b) => a.d - b.d || a.v.name.localeCompare(b.v.name))
    .slice(0, limit)
    .map((x) => x.v);
}
