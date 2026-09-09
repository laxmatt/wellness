import { formatAttribute, humanize } from "./attributes";
import type { CategoryDefinition } from "./category";
import { attributeDef } from "./category";
import { evaluateCondition } from "./conditions";
import type { ProductView } from "./view";

// Filter options are resolved on the server: each option carries the product
// ids it matches. The client only intersects id sets, so no domain code and
// no product data beyond ids reaches the bundle.

export type FilterOption = { id: string; label: string; matchIds: string[] };
export type FilterGroup = { key: string; label: string; options: FilterOption[] };

export function buildFilterGroups(views: ProductView[], cat: CategoryDefinition): FilterGroup[] {
  const groups: FilterGroup[] = [];

  for (const spec of cat.filters) {
    const def = attributeDef(cat, spec.key);
    const options: FilterOption[] = [];

    if (spec.presets && spec.presets.length > 0) {
      for (const p of spec.presets) {
        const matchIds = views.filter((v) => evaluateCondition(v, cat, p.condition)).map((v) => v.id);
        if (matchIds.length > 0 && matchIds.length < views.length) options.push({ id: `${spec.key}:${p.label}`, label: p.label, matchIds });
      }
    } else if (spec.kind === "enum" && def?.enumOptions) {
      for (const o of def.enumOptions) {
        const matchIds = views.filter((v) => v.attributes[spec.key] === o.value).map((v) => v.id);
        if (matchIds.length > 0 && matchIds.length < views.length) options.push({ id: `${spec.key}:${o.value}`, label: o.label, matchIds });
      }
    } else if (spec.kind === "boolean") {
      const matchIds = views.filter((v) => v.attributes[spec.key] === true).map((v) => v.id);
      if (matchIds.length > 0 && matchIds.length < views.length) {
        options.push({ id: `${spec.key}:true`, label: def?.shortLabel ?? def?.label ?? spec.label, matchIds });
      }
    } else if (spec.kind === "list") {
      const values = new Set<string>();
      for (const v of views) {
        const raw = v.attributes[spec.key];
        if (Array.isArray(raw)) for (const x of raw as string[]) values.add(x);
      }
      for (const value of [...values].sort()) {
        const matchIds = views.filter((v) => Array.isArray(v.attributes[spec.key]) && (v.attributes[spec.key] as string[]).includes(value)).map((v) => v.id);
        if (matchIds.length > 0 && matchIds.length < views.length) options.push({ id: `${spec.key}:${value}`, label: humanize(value), matchIds });
      }
    } else if (spec.kind === "range" && def) {
      // No presets: offer the distinct stated values, useful for small sets.
      // A bounded value is not an exact figure, so it is neither offered as a
      // chip nor matched by one: `=== value` would assert the amount the
      // source declined to state.
      const values = [...new Set(views.filter((v) => v.bounds[spec.key] === undefined).map((v) => v.attributes[spec.key]).filter((x) => x !== undefined))];
      for (const value of values.slice(0, 4)) {
        const matchIds = views.filter((v) => v.bounds[spec.key] === undefined && v.attributes[spec.key] === value).map((v) => v.id);
        if (matchIds.length > 0 && matchIds.length < views.length) options.push({ id: `${spec.key}:${String(value)}`, label: formatAttribute(def, value as never), matchIds });
      }
    }

    if (options.length > 0) groups.push({ key: spec.key, label: spec.label, options });
  }

  return groups;
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
