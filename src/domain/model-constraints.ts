import { attributeDef, type CategoryDefinition, type Condition } from "./category";
import type { ModelHardConstraint, ModelSoftPreference } from "./assistant";
import { isMoneyKey, moneyValueToMinorUnits } from "./money-contract";
import type { HardConstraint, SoftPreference } from "./personalization";

// The one place a model's constraint becomes an engine constraint.
//
// Nothing here interprets, repairs or drops. A constraint either converts
// exactly or the whole conversion fails with a reason naming the constraint, so
// the failure is visible to the shopper and to diagnostics rather than becoming
// a silently narrower search.

export type ConstraintProblem = { where: "hard" | "soft"; index: number; key: string; reason: string };

export type ConversionResult =
  | { ok: true; hard: HardConstraint[]; soft: SoftPreference[] }
  | { ok: false; problems: ConstraintProblem[] };

// The two operators that assert nothing about a value. Every other operator
// compares against one, and a comparison with no target is not a weak
// constraint: `evaluateCondition` reads the missing target as undefined and
// returns false for every product, so the shopper is told nothing matched a
// request that was never actually made. Strict structured outputs make this
// reachable, because they cannot omit a property and send `value: null`
// instead, which `normalize` turns into an absence.
const OPS_WITHOUT_VALUE = new Set<string>(["exists", "missing"]);

/**
 * Why an `includes` constraint cannot be searched for, or null when it can.
 *
 * `includes` holds one meaning: does this product's list contain the named
 * value. So it needs a list attribute and a value that names one or more
 * members of such a list. Anything else evaluates to false for every product,
 * which is not a narrow search but a silent empty one, and the shopper is told
 * nothing matched a question that was never asked.
 */
function includesProblem(cat: CategoryDefinition, key: string, value: unknown): string | null {
  const def = attributeDef(cat, key);
  if (def?.type !== "list") {
    return `"${key}" is not a list, so "includes" says nothing about it. Use "eq" for a single value.`;
  }
  if (typeof value === "string") return value.length > 0 ? null : `"${key}" was given an empty value to look for.`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `"${key}" was given an empty list to look for, which no product can contain.`;
    if (value.every((v) => typeof v === "string" && v.length > 0)) return null;
    return `"${key}" accepts a value or a list of values, each a string.`;
  }
  return `"${key}" is a list. "includes" takes the value to look for, or a list of values, as strings.`;
}

/**
 * Whether a key can be ranked along, and by what.
 *
 * Price and any number can be ordered. An enum can be ordered only when its
 * options carry ranks: cold plunge's `plumbing` runs none, plug-in, dedicated
 * circuit, so "less plumbing" means something. `tub_type` runs barrel, tub,
 * inflatable with no ranks at all, so "lower tub type" means nothing.
 */
function ordinalBasis(cat: CategoryDefinition, key: string): "price" | "number" | "ranked_enum" | null {
  if (key === "price") return "price";
  const def = attributeDef(cat, key);
  if (!def) return null;
  if (def.type === "number" || def.type === "integer" || def.type === "boolean") return "number";
  if (def.type === "enum") {
    const options = def.enumOptions ?? [];
    return options.length > 0 && options.every((o) => typeof o.rank === "number") ? "ranked_enum" : null;
  }
  return null;
}

/**
 * Why a preference cannot be ranked with, or null when it can.
 *
 * A direction has to mean something on the key it points at. "Rank for lower
 * tub type" does not: the options are barrel, tub and inflatable, and none is
 * lower than another. The reply of 05:37 asked for exactly that, and the site
 * printed "Ranking for lower tub_type" while quietly scoring an equality match
 * instead. Guessing what a meaningless direction meant is how a shopper gets a
 * ranking nobody asked for, so it fails here and is visible.
 */
function softProblem(cat: CategoryDefinition, p: ModelSoftPreference): string | null {
  const def = attributeDef(cat, p.key);
  const basis = ordinalBasis(cat, p.key);

  if (p.direction === "prefer_low" || p.direction === "prefer_high") {
    if (basis === null) {
      const named = def?.type === "list" ? "a list of values" : def?.type === "enum" ? "an unordered set of options" : "not something with an order";
      return `"${p.key}" is ${named}, so "${p.direction}" says nothing about it. Use "prefer_value" with the value to rank towards, or send it as a constraint.`;
    }
    return null;
  }

  // prefer_value has to name the value it prefers.
  if (p.value === undefined) return `"${p.key}" was given "prefer_value" with no value to prefer.`;
  if (def?.type === "enum") {
    const options = (def.enumOptions ?? []).map((o) => o.value);
    const wanted = Array.isArray(p.value) ? p.value : [p.value];
    const unknown = wanted.filter((v) => !options.includes(v as string));
    if (unknown.length > 0) return `"${p.key}" has no option ${unknown.map((v) => JSON.stringify(v)).join(", ")}. Its options are ${options.join("|")}.`;
  }
  return null;
}

export function toEngineConstraints(
  cat: CategoryDefinition,
  modelHard: ModelHardConstraint[],
  modelSoft: ModelSoftPreference[],
): ConversionResult {
  const problems: ConstraintProblem[] = [];
  const hard: HardConstraint[] = [];
  const soft: SoftPreference[] = [];

  modelHard.forEach((c, index) => {
    if (!OPS_WITHOUT_VALUE.has(c.op) && c.value === undefined) {
      problems.push({
        where: "hard",
        index,
        key: c.key,
        reason: `"${c.key}" with op "${c.op}" carries no value. A comparison with no target matches nothing, so it is refused rather than searched for.`,
      });
      return;
    }
    if (c.op === "includes") {
      const problem = includesProblem(cat, c.key, c.value);
      if (problem) {
        problems.push({ where: "hard", index, key: c.key, reason: problem });
        return;
      }
      hard.push(c as Condition);
      return;
    }
    if (!isMoneyKey(cat, c.key)) {
      hard.push(c as Condition);
      return;
    }
    // exists and missing say nothing about an amount, so they carry no value
    // to convert.
    if (c.op === "exists" || c.op === "missing") {
      hard.push({ key: c.key, op: c.op } as Condition);
      return;
    }
    const converted = moneyValueToMinorUnits(c.value, c.key);
    if (!converted.ok) {
      problems.push({ where: "hard", index, key: c.key, reason: converted.reason });
      return;
    }
    hard.push({ key: c.key, op: c.op, value: converted.minorUnits });
  });

  modelSoft.forEach((p, index) => {
    const problem = softProblem(cat, p);
    if (problem) {
      problems.push({ where: "soft", index, key: p.key, reason: problem });
      return;
    }
    if (!isMoneyKey(cat, p.key) || p.value === undefined) {
      soft.push(p as SoftPreference);
      return;
    }
    const converted = moneyValueToMinorUnits(p.value, p.key);
    if (!converted.ok) {
      problems.push({ where: "soft", index, key: p.key, reason: converted.reason });
      return;
    }
    soft.push({ key: p.key, direction: p.direction, weight: p.weight, value: converted.minorUnits });
  });

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, hard, soft };
}
