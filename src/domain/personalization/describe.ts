import { formatAttribute, humanize } from "../attributes";
import type { CategoryDefinition, Condition } from "../category";
import { attributeDef } from "../category";
import { comparable, conditionTarget } from "../conditions";
import { formatMoney } from "../money";
import { BOUND_WORDS, type Bound } from "../provenance";
import type { ProductView } from "../view";
import { priceMinorOf } from "../view";

// Human phrasing for constraints and for how far a product sits from one.
// Templates only. No model text reaches these strings.

// `bound` qualifies a value a product states as a bound. It is passed when
// formatting what a product holds, never when formatting what a shopper asked
// for: "under 5 g" is the shopper's limit, and it is exact.
export function formatValueFor(cat: CategoryDefinition, key: string, value: unknown, bound?: Bound): string {
  if (key === "price") return formatMoney({ amountMinor: Number(value), currency: "USD" });
  const def = attributeDef(cat, key);
  if (!def) return String(value);
  if (bound && typeof value === "number") return `${BOUND_WORDS[bound]} ${formatValueFor(cat, key, value)}`;
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
    // An option label is written for a filter chip, where it stands alone. Most
    // are short phrases and fold into a sentence: "full body" plus "coverage"
    // reads as "full body coverage". Some are whole sentences and do not.
    // Cold plunge's plumbing option is "None. Fill with a hose.", and folding
    // it produced "none. fill with a hose. power and plumbing", which is not a
    // sentence in any language. A label carrying its own sentence punctuation
    // is quoted and left as its author wrote it, capitals included.
    const option = val.replace(/\s*\.\s*$/, "");
    if (/[.!?]/.test(option)) return `${labelFor(cat, c.key)} set to "${option}"`;
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
      // Several values are alternatives, so the sentence has to say so. "sugar
      // includes A, B" reads as both; the engine matches either.
      return Array.isArray(c.value) && c.value.length > 1 ? `${label} includes any of ${val}` : `${label} includes ${val}`;
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
  const actualRaw = c.key === "price" ? priceMinorOf(view) : view.attributes[c.key];
  const bound = c.key === "price" ? undefined : view.bounds[c.key];

  if (actualRaw === undefined) {
    return { text: `${label} not stated`, magnitude: Number.MAX_SAFE_INTEGER / 2 };
  }

  // How far a bound sits from a limit is not a number anybody stated. The
  // distance still orders alternatives, but the sentence says only what the
  // source says. Magnitude uses the stated end, which is the near end.
  if (bound && typeof actualRaw === "number") {
    const left = comparable(view, cat, c.key);
    const right = conditionTarget(cat, c.key, c.value);
    const gap = left !== undefined && right !== undefined ? Math.abs(left - right) || 1 : 1;
    return { text: `${label} is ${formatValueFor(cat, c.key, actualRaw, bound).toLowerCase()}`, magnitude: gap };
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
  const actualRaw = c.key === "price" ? priceMinorOf(view) : view.attributes[c.key];
  const bound = c.key === "price" ? undefined : view.bounds[c.key];
  const actual = actualRaw === undefined ? "" : formatValueFor(cat, c.key, actualRaw, bound);

  if (def?.type === "enum" && actualRaw !== undefined) return `${label}: ${actual}`;

  // A bound met the limit or it would not be a fit, and by how much is not
  // known. The qualifier is the whole answer.
  if (bound && actualRaw !== undefined) return `${label}: ${actual}`;

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
