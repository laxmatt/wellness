import { humanize } from "./attributes";
import { attributeDef, type CategoryDefinition } from "./category";
import type { HardConstraint, SoftPreference } from "./personalization";
import type { ProductView } from "./view";

// The values this category publishes for its own filterable keys, and whether
// the shopper named one that nothing was extracted for.
//
// The run of 2026-09-09T01:50 asked for "zero sugar electrolytes under $2 a
// serving". Two of the three requirements became constraints. "Electrolytes" is
// a value of the `function` filter, listed in the model's instructions and
// shown on the site's own filter chips, and it produced nothing: no constraint,
// no preference, no question. The shopper was told what the site had applied
// and never told what it had not.
//
// Nothing here extracts a constraint. Naming a value is not the same as asking
// for it, and "no caffeine" names caffeine while asking for the opposite. So
// this only reports that a key the shopper touched is unaddressed, and the
// caller asks about it in the site's own words.

export type NamedValue = { value: string; label: string };

/**
 * Every value a filterable key actually takes across these products, derived
 * the same way `buildFilterGroups` derives the filter chips: from the products,
 * not from a list written next to them.
 */
export function namedValues(cat: CategoryDefinition, views: ProductView[]): Map<string, NamedValue[]> {
  const byKey = new Map<string, NamedValue[]>();

  for (const f of cat.filters) {
    const def = attributeDef(cat, f.key);
    if (def?.type === "enum") {
      const present = (def.enumOptions ?? []).filter((o) => views.some((v) => v.attributes[f.key] === o.value));
      if (present.length > 0) byKey.set(f.key, present.map((o) => ({ value: o.value, label: o.label })));
      continue;
    }
    if (def?.type === "list") {
      const values = new Set<string>();
      for (const v of views) {
        const raw = v.attributes[f.key];
        if (Array.isArray(raw)) for (const x of raw as string[]) values.add(String(x));
      }
      if (values.size > 0) byKey.set(f.key, [...values].sort().map((value) => ({ value, label: humanize(value) })));
    }
  }

  return byKey;
}

// Whole words only. "energy" must not match inside "energy-free", and a value
// that happens to be a substring of an unrelated word is not a mention.
function mentions(text: string, term: string): boolean {
  const cleaned = term.replace(/[_-]+/g, " ").trim();
  if (cleaned.length < 3) return false;
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

/**
 * Filterable keys the shopper named a value of, and which no extracted
 * constraint or preference covers.
 *
 * Returned in the category's own filter order, so the question a shopper is
 * asked is the one the site would have put first anyway.
 */
export function namedButUnconstrained(
  cat: CategoryDefinition,
  views: ProductView[],
  text: string,
  hard: HardConstraint[],
  soft: SoftPreference[],
): string[] {
  const covered = new Set<string>([...hard.map((c) => c.key), ...soft.map((p) => p.key)]);
  const unaddressed: string[] = [];

  for (const [key, values] of namedValues(cat, views)) {
    if (covered.has(key)) continue;
    if (values.some((v) => mentions(text, v.value) || mentions(text, v.label))) unaddressed.push(key);
  }

  return unaddressed;
}
