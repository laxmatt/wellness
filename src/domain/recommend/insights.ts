import { formatAttribute } from "../attributes";
import type { CategoryDefinition } from "../category";
import { attributeDef } from "../category";
import { matchesAll } from "../conditions";
import { formatMoney } from "../money";
import type { ProductView } from "../view";

export type Insight = { id: string; text: string; tone: "strength" | "tradeoff" | "neutral" };

function fill(template: string, view: ProductView, cat: CategoryDefinition): string {
  return template.replace(/\{([a-z0-9_]+)\}/g, (_, key: string) => {
    if (key === "price") return formatMoney(view.price.money);
    const def = attributeDef(cat, key);
    if (!def) return `{${key}}`;
    const raw = view.attributes[key];
    if (raw === undefined) return "not stated";
    if (def.type === "list" && Array.isArray(raw)) return (raw as string[]).map((v) => v.replace(/_/g, " ")).join(", ");
    if (def.unit === "yr" && typeof raw === "number") return `${raw}-year`;
    if (def.unit === "%" && typeof raw === "number") return `${raw}%`;
    return formatAttribute(def, raw);
  });
}

// Deterministic editorial layer. Regenerated on every read from product truth.
export function deriveInsights(view: ProductView, cat: CategoryDefinition): Insight[] {
  return cat.insightRules
    .filter((rule) => matchesAll(view, cat, rule.when))
    .map((rule) => ({ id: rule.id, text: fill(rule.text, view, cat), tone: rule.tone }));
}

export function primaryStrength(view: ProductView, cat: CategoryDefinition): string | undefined {
  return view.editorial.strengths[0] ?? deriveInsights(view, cat).find((i) => i.tone === "strength")?.text;
}

export function primaryTradeoff(view: ProductView, cat: CategoryDefinition): string | undefined {
  return view.editorial.tradeoffs[0] ?? deriveInsights(view, cat).find((i) => i.tone === "tradeoff")?.text;
}
