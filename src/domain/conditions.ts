import type { AttributePrimitive } from "./attributes";
import type { CategoryDefinition, Condition } from "./category";
import { attributeDef } from "./category";
import type { Bound } from "./provenance";
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

// A value the source states only as a bound answers some questions and not
// others. "Less than 1 g of sugar" settles "under 2 g" and settles "not 4 g";
// it cannot settle "exactly 1 g", "under 0.5 g", or anything asking how much
// there is. Unanswerable is answered false, the same way a missing value is,
// because a question this catalogue cannot settle must not admit a product.
//
// Capability given up, deliberately: an exact query against a bounded value
// never matches, and a range query strictly inside the bound never matches
// either. AG1 is no longer returned for "1 g of sugar" and never was for
// "zero sugar"; it is returned for "under 5 g", which its label does settle.
function evaluateBounded(bound: Bound, stated: number, op: Condition["op"], target: number): boolean {
  if (bound === "less_than") {
    // The real value is somewhere below `stated`.
    if (op === "lt" || op === "lte") return target >= stated;
    if (op === "neq") return target >= stated;
    return false;
  }
  // The real value is somewhere above `stated`.
  if (op === "gt" || op === "gte") return target <= stated;
  if (op === "neq") return target <= stated;
  return false;
}

export function evaluateCondition(view: ProductView, cat: CategoryDefinition, c: Condition): boolean {
  if (isUnconfirmedPriceClaim(view, cat, c)) return false;
  const raw: AttributePrimitive | number | undefined = c.key === "price" ? view.price.money.amountMinor : view.attributes[c.key];
  const bound = c.key === "price" ? undefined : view.bounds[c.key];
  if (bound !== undefined && typeof raw === "number") {
    // `exists` and `missing` ask whether the catalogue holds anything at all,
    // which a bound answers exactly as an exact value does.
    if (c.op === "exists") return true;
    if (c.op === "missing") return false;
    const target = conditionTarget(cat, c.key, c.value);
    if (target === undefined) return false;
    return evaluateBounded(bound, raw, c.op, target);
  }
  switch (c.op) {
    case "exists":
      return raw !== undefined;
    case "missing":
      return raw === undefined;
    case "eq":
      return raw === c.value;
    case "neq":
      // An unknown value does not establish that a product differs. "No
      // caffeine" written as caffeine_mg neq 0 must not admit a drink whose
      // caffeine is unrecorded: absence of a fact is not evidence of fitness.
      return raw !== undefined && raw !== c.value;
    case "in":
      return Array.isArray(c.value) && (c.value as unknown[]).includes(raw as unknown);
    case "includes":
      // "includes" asks whether a product's list holds a value. A scalar names
      // one value; an array names alternatives and matches a product holding
      // any of them, which is how this site's own list filter chips behave:
      // options within a group are OR.
      //
      // It used to compare the value to the array's members directly, so an
      // array value could only ever match a product whose list held that same
      // array. A live model answered `function includes ["electrolytes"]`,
      // every product failed, and the shopper was told nothing matched when an
      // electrolyte drink was sitting in the catalogue at $1.50 a serving.
      if (!Array.isArray(raw)) return false;
      return Array.isArray(c.value)
        ? (c.value as unknown[]).some((v) => (raw as unknown[]).includes(v))
        : (raw as unknown[]).includes(c.value as unknown);
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
