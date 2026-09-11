import { formatAttribute, humanize } from "./attributes";
import type { CategoryDefinition, Condition } from "./category";
import { attributeDef } from "./category";
import { evaluateCondition } from "./conditions";
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
export type FilterOptionSpec = { id: string; label: string; groupKey: string; groupLabel: string; condition: Condition };

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
    out.push({ id: `${spec.key}:${id}`, label, groupKey: spec.key, groupLabel: spec.label, condition });

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

  return out;
}

export function buildFilterGroups(views: ProductView[], cat: CategoryDefinition): FilterGroup[] {
  const groups = new Map<string, FilterGroup>();

  for (const spec of filterOptionSpecs(views, cat)) {
    const matchIds = views.filter((v) => evaluateCondition(v, cat, spec.condition)).map((v) => v.id);
    // A chip that admits nothing is a dead end, and one that admits everything
    // changes nothing.
    if (matchIds.length === 0 || matchIds.length === views.length) continue;
    const group = groups.get(spec.groupKey) ?? { key: spec.groupKey, label: spec.groupLabel, options: [] };
    group.options.push({ id: spec.id, label: spec.label, matchIds });
    groups.set(spec.groupKey, group);
  }

  // Category order, not discovery order.
  return cat.filters.map((f) => groups.get(f.key)).filter((g): g is FilterGroup => g !== undefined);
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
