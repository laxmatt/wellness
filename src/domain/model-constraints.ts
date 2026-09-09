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
