import type { CategoryDefinition, Condition } from "./category";
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
