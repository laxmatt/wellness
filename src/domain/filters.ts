import { formatAttribute, humanize } from "./attributes";
import type { CategoryDefinition, Condition } from "./category";
import { attributeDef } from "./category";
import { matchesAll } from "./conditions";
import type { ProductView } from "./view";

// Filter options are resolved on the server: each option carries the product
// ids it matches. The client only intersects id sets, so no domain code and
// no product data beyond ids reaches the bundle.

export type FilterOption = { id: string; label: string; matchIds: string[] };
export type FilterGroup = { key: string; label: string; options: FilterOption[] };

/**
 * One filter chip, with the condition that defines it.
 *
 * The condition is what the chip means, and it was never written down: the
 * option carried the ids it happened to match and nothing that said why. Two
 * screens now need the why, so it is stated once here and every count on the
 * site is still the engine's answer to it.
 *
 * Every branch below states a condition that admits exactly the set the branch
 * used to compute directly. The range branch is the one worth naming: it
 * excluded bounded values by hand, and `eq` already refuses them, because a
 * source that said "under 1 g" did not say 1 g.
 */
export type FilterOptionSpec = {
  id: string;
  label: string;
  groupKey: string;
  groupLabel: string;
  /** All of them must hold. One condition for a chip; a facet may state several. */
  conditions: Condition[];
  /**
   * Facet URLs this option is the control for.
   *
   * A facet page is not a different filter engine and not a different product
   * set. It is this site's own chip, already pressed. Recording that here is
   * what lets `/wellness-drinks/energy` open the whole category with the Energy
   * chip on, which the shopper can then turn off, instead of a page whose
   * product list cannot be widened.
   */
  facetSlugs?: string[];
  /**
   * Where the option came from. "filter" is a chip the category defines;
   * "facet" is one that exists only because a facet URL states it and no chip
   * did. A facet pointing at an existing chip does not change that chip's
   * source: it is still the category's own filter.
   */
  source: "filter" | "facet";
};

/** Same key, same operator, same value. Nothing is inferred from labels. */
export function conditionsEqual(a: Condition[], b: Condition[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: Condition) => `${c.key}|${c.op}|${JSON.stringify(c.value ?? null)}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((x, i) => x === right[i]);
}

/**
 * Every option this category could offer, before any pruning.
 *
 * `buildFilterGroups` hides an option that matches nothing or everything,
 * because a chip that changes nothing is not worth a tap. Nothing else may
 * inherit that: a requirement dropped for being unanimous would be missing from
 * a comparison that includes a product outside it, and a facet page builds its
 * chips from that facet's products alone. So the full list lives here and the
 * chip bar prunes its own copy.
 */
export function filterOptionSpecs(views: ProductView[], cat: CategoryDefinition): FilterOptionSpec[] {
  const out: FilterOptionSpec[] = [];
  const push = (spec: { key: string; label: string }, id: string, label: string, condition: Condition) =>
    out.push({ id: `${spec.key}:${id}`, label, groupKey: spec.key, groupLabel: spec.label, conditions: [condition], source: "filter" });

  for (const spec of cat.filters) {
    const def = attributeDef(cat, spec.key);

    if (spec.presets && spec.presets.length > 0) {
      for (const p of spec.presets) push(spec, p.label, p.label, p.condition);
    } else if (spec.kind === "enum" && def?.enumOptions) {
      for (const o of def.enumOptions) push(spec, o.value, o.label, { key: spec.key, op: "eq", value: o.value });
    } else if (spec.kind === "boolean") {
      push(spec, "true", def?.shortLabel ?? def?.label ?? spec.label, { key: spec.key, op: "eq", value: true });
    } else if (spec.kind === "list") {
      const values = new Set<string>();
      for (const v of views) {
        const raw = v.attributes[spec.key];
        if (Array.isArray(raw)) for (const x of raw as string[]) values.add(x);
      }
      for (const value of [...values].sort()) push(spec, value, humanize(value), { key: spec.key, op: "includes", value });
    } else if (spec.kind === "range" && def) {
      // No presets: offer the distinct stated values, useful for small sets.
      // A bounded value is not an exact figure, so it is neither offered as a
      // chip nor matched by one: `=== value` would assert the amount the
      // source declined to state, and `eq` refuses a bound for the same reason.
      const values = [...new Set(views.filter((v) => v.bounds[spec.key] === undefined).map((v) => v.attributes[spec.key]).filter((x) => x !== undefined))];
      for (const value of values.slice(0, 4)) {
        push(spec, String(value), formatAttribute(def, value as never), { key: spec.key, op: "eq", value: value as string | number | boolean });
      }
    }
  }

  // Facets last, because a facet is a chip this site has already written down
  // somewhere else. Where the chip already exists it is annotated, never
  // duplicated: /red-light/under-1000 and the "Under $1,000" chip are one
  // control, so pressing one and arriving by the other cannot disagree.
  for (const facet of cat.facets) {
    const existing = out.find((o) => conditionsEqual(o.conditions, facet.conditions));
    if (existing) {
      existing.facetSlugs = [...(existing.facetSlugs ?? []), facet.slug];
      continue;
    }
    // No chip says this yet. The facet joins the row its condition belongs to,
    // so it stays an alternative to that row's other options rather than a new
    // requirement ANDed against them. /cold-plunge/indoor is the live case: the
    // assumed placement values were removed from the catalogue, so no product
    // states one and the list kind offers no chip for it.
    const key = facet.conditions.length === 1 ? facet.conditions[0].key : undefined;
    const owner = key ? cat.filters.find((f) => f.key === key) : undefined;
    out.push({
      id: `${owner?.key ?? "facet"}:${facet.slug}`,
      label: facet.label,
      groupKey: owner?.key ?? "facet",
      groupLabel: owner?.label ?? "Starting point",
      conditions: facet.conditions,
      facetSlugs: [facet.slug],
      source: "facet",
    });
  }

  return out;
}

/** The chip a facet URL presses, or nothing if the category does not define it. */
export function facetOptionId(views: ProductView[], cat: CategoryDefinition, facetSlug: string): string | undefined {
  return filterOptionSpecs(views, cat).find((o) => o.facetSlugs?.includes(facetSlug))?.id;
}

/**
 * @param keep option ids that must be offered even if the rule below would drop
 *   them. A chip the page has already pressed is one: an option matching nothing
 *   is normally not worth a tap, but when it is *on* it is the thing the shopper
 *   has to be able to turn off. Hiding it strands them in an empty result with
 *   no control to undo, which is the dead end a facet page used to be.
 */
export function buildFilterGroups(views: ProductView[], cat: CategoryDefinition, keep: string[] = []): FilterGroup[] {
  const groups = new Map<string, FilterGroup>();

  for (const spec of filterOptionSpecs(views, cat)) {
    const matchIds = views.filter((v) => matchesAll(v, cat, spec.conditions)).map((v) => v.id);
    // A chip that admits nothing is a dead end, and one that admits everything
    // changes nothing. Neither is true of a chip that is already on.
    if ((matchIds.length === 0 || matchIds.length === views.length) && !keep.includes(spec.id)) continue;
    const group = groups.get(spec.groupKey) ?? { key: spec.groupKey, label: spec.groupLabel, options: [] };
    group.options.push({ id: spec.id, label: spec.label, matchIds });
    groups.set(spec.groupKey, group);
  }

  // Category order, not discovery order. A facet with no filter row of its own
  // goes last, under its own heading.
  const ordered = cat.filters.map((f) => groups.get(f.key)).filter((g): g is FilterGroup => g !== undefined);
  const loose = groups.get("facet");
  return loose ? [...ordered, loose] : ordered;
}

// Options within a group are OR. Groups are AND.
export function applyFilters(allIds: string[], groups: FilterGroup[], selected: string[]): string[] {
  if (selected.length === 0) return allIds;
  let ids = new Set(allIds);
  for (const g of groups) {
    const chosen = g.options.filter((o) => selected.includes(o.id));
    if (chosen.length === 0) continue;
    const union = new Set(chosen.flatMap((o) => o.matchIds));
    ids = new Set([...ids].filter((id) => union.has(id)));
  }
  return allIds.filter((id) => ids.has(id));
}
