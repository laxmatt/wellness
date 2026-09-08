import { formatAttribute, humanize } from "../attributes";
import type { CategoryDefinition, Condition } from "../category";
import { attributeDef } from "../category";
import { comparable, conditionTarget } from "../conditions";
import { formatMoney } from "../money";
import type { ProductView } from "../view";

// Human phrasing for constraints and for how far a product sits from one.
// Templates only. No model text reaches these strings.

export function formatValueFor(cat: CategoryDefinition, key: string, value: unknown): string {
  if (key === "price") return formatMoney({ amountMinor: Number(value), currency: "USD" });
  const def = attributeDef(cat, key);
  if (!def) return String(value);
  if (def.unit === "USD_minor") return formatMoney({ amountMinor: Number(value), currency: "USD" });
  if (Array.isArray(value)) return value.map((v) => humanize(String(v))).join(", ");
  return formatAttribute(def, value as never);
}

export function labelFor(cat: CategoryDefinition, key: string): string {
  if (key === "price") return "Price";
  return attributeDef(cat, key)?.shortLabel ?? attributeDef(cat, key)?.label ?? key;
}

// "under $700", "full body coverage", "a chiller", "zero sugar"
export function describeConstraint(cat: CategoryDefinition, c: Condition): string {
  const label = labelFor(cat, c.key).toLowerCase();
  const val = c.value === undefined ? "" : formatValueFor(cat, c.key, c.value);
  const def = attributeDef(cat, c.key);
  if (def?.type === "enum" && c.value !== undefined && ["eq", "gte", "gt", "lte", "lt"].includes(c.op)) {
    return `${val.toLowerCase()} ${label}`;
  }
  switch (c.op) {
    case "lt":
      return `${label} under ${val}`;
    case "lte":
      return `${label} of ${val} or less`;
    case "gt":
      return `${label} over ${val}`;
    case "gte":
      return `${label} of ${val} or more`;
    case "eq":
      if (def?.type === "boolean") return c.value === true ? label : `no ${label}`;
      if (typeof c.value === "number" && c.value === 0) return `zero ${label}`;
      return `${label}: ${val}`;
    case "neq":
      return `${label} other than ${val}`;
    case "in":
      return `${label}: ${val}`;
    case "includes":
      return `${label} includes ${val}`;
    case "exists":
      return `${label} stated`;
    case "missing":
      return `${label} not stated`;
  }
}

export type Gap = { text: string; magnitude: number };

// How far this product sits from a constraint it fails, in the constraint's
// own unit. magnitude is normalized-free; it only orders alternatives.
export function describeGap(view: ProductView, cat: CategoryDefinition, c: Condition): Gap {
  const label = labelFor(cat, c.key);
  const def = attributeDef(cat, c.key);
  const actualRaw = c.key === "price" ? view.price.money.amountMinor : view.attributes[c.key];

  if (actualRaw === undefined) {
    return { text: `${label} not stated`, magnitude: Number.MAX_SAFE_INTEGER / 2 };
  }

  const left = comparable(view, cat, c.key);
  const right = conditionTarget(cat, c.key, c.value);

  if (def?.type === "enum") {
    const gap = Math.abs((left ?? 0) - (right ?? 0)) || 1;
    return {
      text: `${label} is ${formatValueFor(cat, c.key, actualRaw).toLowerCase()}, you asked for ${formatValueFor(cat, c.key, c.value).toLowerCase()}`,
      magnitude: gap,
    };
  }

  if (left !== undefined && right !== undefined && (c.op === "lt" || c.op === "lte" || c.op === "gt" || c.op === "gte")) {
    const over = c.op === "lt" || c.op === "lte" ? left - right : right - left;
    const isMoney = c.key === "price" || def?.unit === "USD_minor";
    const amount = isMoney
      ? formatMoney({ amountMinor: Math.round(Math.abs(over)), currency: "USD" })
      : `${Math.round(Math.abs(over) * 10) / 10}${def?.unit ? ` ${def.unit}` : ""}`;
    const direction = c.op === "lt" || c.op === "lte" ? "over" : "under";
    return { text: `${amount} ${direction} your ${label.toLowerCase()} limit`, magnitude: Math.abs(over) };
  }

  const actual = formatValueFor(cat, c.key, actualRaw);
  if (def?.type === "boolean") {
    return { text: c.value === true ? `No ${label.toLowerCase()}` : `Has ${label.toLowerCase()}`, magnitude: 1 };
  }
  return { text: `${label} is ${actual}`, magnitude: 1 };
}

export function describeFit(view: ProductView, cat: CategoryDefinition, c: Condition): string {
  const label = labelFor(cat, c.key);
  const def = attributeDef(cat, c.key);
  const actualRaw = c.key === "price" ? view.price.money.amountMinor : view.attributes[c.key];
  const actual = actualRaw === undefined ? "" : formatValueFor(cat, c.key, actualRaw);

  if (def?.type === "enum" && actualRaw !== undefined) return `${label}: ${actual}`;

  if ((c.op === "lt" || c.op === "lte") && actualRaw !== undefined) {
    const left = comparable(view, cat, c.key);
    const right = conditionTarget(cat, c.key, c.value);
    if (left !== undefined && right !== undefined) {
      const under = right - left;
      const isMoney = c.key === "price" || def?.unit === "USD_minor";
      if (under > 0) {
        const amount = isMoney
          ? formatMoney({ amountMinor: Math.round(under), currency: "USD" })
          : `${Math.round(under * 10) / 10}${def?.unit ? ` ${def.unit}` : ""}`;
        return `${actual}, ${amount} under your limit`;
      }
      return `${actual}, exactly at your limit`;
    }
  }
  if (def?.type === "boolean") return c.value === true ? `Has ${label.toLowerCase()}` : `No ${label.toLowerCase()}`;
  return `${label}: ${actual}`;
}
