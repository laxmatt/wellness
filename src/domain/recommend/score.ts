import type { AttributePrimitive } from "../attributes";
import type { CategoryDefinition } from "../category";
import { attributeDef } from "../category";
import { enumRank } from "../conditions";
import type { ProductView } from "../view";

// ScoringInput deliberately carries no offer or affiliate data. Ranking cannot
// see who pays us. Price here is the display price, used only for value and
// tier rules, never inside the quality score.
export type ScoringInput = {
  id: string;
  priceMinor: number;
  attributes: Record<string, AttributePrimitive>;
};

export function toScoringInput(view: ProductView): ScoringInput {
  return { id: view.id, priceMinor: view.price.money.amountMinor, attributes: view.attributes };
}

export type CriterionContribution = {
  key: string;
  weight: number;
  raw: number | undefined;
  normalized: number;
  contribution: number;
};

export type ScoreResult = {
  id: string;
  score: number;
  completeness: number;
  eligible: boolean;
  criteria: CriterionContribution[];
};

export function numericFor(input: ScoringInput, cat: CategoryDefinition, key: string): number | undefined {
  if (key === "price") return input.priceMinor;
  if (key.startsWith("attribute:")) return numericFor(input, cat, key.slice("attribute:".length));
  const v = input.attributes[key];
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return enumRank(cat, key, v);
}

export function completenessOf(input: ScoringInput, cat: CategoryDefinition): number {
  const required = cat.attributeDefinitions.filter((a) => a.required);
  if (required.length === 0) return 1;
  return required.filter((a) => input.attributes[a.key] !== undefined).length / required.length;
}

export function scoreProducts(inputs: ScoringInput[], cat: CategoryDefinition): ScoreResult[] {
  const ranges = new Map<string, { min: number; max: number }>();
  for (const c of cat.scoring.criteria) {
    const values = inputs.map((i) => numericFor(i, cat, c.key)).filter((v): v is number => v !== undefined);
    if (values.length > 0) ranges.set(c.key, { min: Math.min(...values), max: Math.max(...values) });
  }
  const totalWeight = cat.scoring.criteria.reduce((s, c) => s + c.weight, 0);

  return inputs.map((input) => {
    const criteria: CriterionContribution[] = cat.scoring.criteria.map((c) => {
      const raw = numericFor(input, cat, c.key);
      const range = ranges.get(c.key);
      let normalized = 0;
      if (raw !== undefined && range) {
        normalized = range.max === range.min ? 1 : (raw - range.min) / (range.max - range.min);
        const dir = attributeDef(cat, c.key)?.preferenceDirection ?? "neutral";
        if (dir === "lower_better") normalized = 1 - normalized;
      }
      return { key: c.key, weight: c.weight, raw, normalized, contribution: (c.weight * normalized) / totalWeight };
    });
    const score = Math.round(criteria.reduce((s, c) => s + c.contribution, 0) * 1000) / 10;
    const completeness = completenessOf(input, cat);
    return { id: input.id, score, completeness, eligible: completeness >= cat.scoring.completenessFloor, criteria };
  });
}
