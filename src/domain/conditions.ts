import type { AttributePrimitive } from "./attributes";
import type { CategoryDefinition, Condition } from "./category";
import { attributeDef } from "./category";
import type { ProductView } from "./view";
import { numericValue } from "./view";

export function enumRank(cat: CategoryDefinition, key: string, value: unknown): number | undefined {
  const def = attributeDef(cat, key);
  if (!def || def.type !== "enum" || typeof value !== "string") return undefined;
  return def.enumOptions?.find((o) => o.value === value)?.rank;
}

// Comparable numeric for a key: price, numbers, booleans, or ordinal enum rank.
export function comparable(view: ProductView, cat: CategoryDefinition, key: string): number | undefined {
  const n = numericValue(view, key);
  if (n !== undefined) return n;
  return enumRank(cat, key, view.attributes[key]);
}

export function conditionTarget(cat: CategoryDefinition, key: string, value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return enumRank(cat, key, value);
}

// True when this condition asserts something about price that an unverified
// price cannot support.
export function isUnconfirmedPriceClaim(view: ProductView, cat: CategoryDefinition, c: Condition): boolean {
  if (c.op === "exists" || c.op === "missing") return false;
  if (c.key === "price") return view.price.isDemo;
  // Per-serving cost is derived from the pack price, so it inherits its doubt.
  if (attributeDef(cat, c.key)?.unit === "USD_minor") return view.price.isDemo;
  return false;
}

export function evaluateCondition(view: ProductView, cat: CategoryDefinition, c: Condition): boolean {
  if (isUnconfirmedPriceClaim(view, cat, c)) return false;
  const raw: AttributePrimitive | number | undefined = c.key === "price" ? view.price.money.amountMinor : view.attributes[c.key];
  switch (c.op) {
    case "exists":
      return raw !== undefined;
    case "missing":
      return raw === undefined;
    case "eq":
      return raw === c.value;
    case "neq":
      return raw !== c.value;
    case "in":
      return Array.isArray(c.value) && (c.value as unknown[]).includes(raw as unknown);
    case "includes":
      return Array.isArray(raw) && (raw as unknown[]).includes(c.value as unknown);
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const left = comparable(view, cat, c.key);
      const right = conditionTarget(cat, c.key, c.value);
      if (left === undefined || right === undefined) return false;
      if (c.op === "lt") return left < right;
      if (c.op === "lte") return left <= right;
      if (c.op === "gt") return left > right;
      return left >= right;
    }
  }
}

export function matchesAll(view: ProductView, cat: CategoryDefinition, conditions: Condition[]): boolean {
  return conditions.every((c) => evaluateCondition(view, cat, c));
}

// Products excluded solely because their price is unverified. They are not
// failures to hide: they may well qualify, and the UI says so separately.
export function unconfirmedByPrice(views: ProductView[], cat: CategoryDefinition, conditions: Condition[]): ProductView[] {
  const priceClaims = conditions.filter((c) => c.key === "price" || attributeDef(cat, c.key)?.unit === "USD_minor");
  if (priceClaims.length === 0) return [];
  return views.filter((v) => {
    if (matchesAll(v, cat, conditions)) return false;
    if (!priceClaims.some((c) => isUnconfirmedPriceClaim(v, cat, c))) return false;
    // Must pass everything that does not depend on the doubtful price.
    return conditions.filter((c) => !isUnconfirmedPriceClaim(v, cat, c)).every((c) => evaluateCondition(v, cat, c));
  });
}
