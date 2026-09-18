import { formatAttribute } from "../attributes";
import type { CategoryDefinition } from "../category";
import { attributeDef } from "../category";
import { matchesAll } from "../conditions";
import { displayPrice, type ProductView } from "../view";

export type Insight = { id: string; text: string; tone: "strength" | "tradeoff" | "neutral" };

function fill(template: string, view: ProductView, cat: CategoryDefinition): string {
  return template.replace(/\{([a-z0-9_]+)\}/g, (_, key: string) => {
    if (key === "price") return displayPrice(view.price).toLowerCase();
    // Universal text fields take priority so "Lifetime warranty" reads as the
    // product states it, not as the capped scoring number.
    if (key === "warranty") return view.warranty ?? (typeof view.attributes.warranty_years === "number" ? `${view.attributes.warranty_years}-year warranty` : "warranty not stated");
    if (key === "return_policy") return view.returnPolicy ?? "return policy not stated";
    const def = attributeDef(cat, key);
    if (!def) return `{${key}}`;
    const raw = view.attributes[key];
    if (raw === undefined) return "not stated";
    if (def.type === "list" && Array.isArray(raw)) return (raw as string[]).map((v) => v.replace(/_/g, " ")).join(", ");
    // A bound keeps its qualifier through every shortcut below it. A rule that
    // fires on "over 189 mW/cm2" must not print "189 mW/cm2".
    const bound = view.bounds[key];
    if (bound) return formatAttribute(def, raw, bound);
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
  const authored = view.editorial.strengths[0] ?? deriveInsights(view, cat).find((i) => i.tone === "strength")?.text;
  if (authored || cat.id !== "saunas") return authored;
  const capacity = typeof view.attributes.capacity_label === "string" ? view.attributes.capacity_label : undefined;
  const type = view.attributes.sauna_type === "far_infrared" ? "far-infrared" : view.attributes.sauna_type === "traditional" ? "traditional" : undefined;
  const placement = view.attributes.placement === "outdoor" ? "outdoor use" : view.attributes.placement === "indoor" ? "indoor use" : view.attributes.placement === "indoor_outdoor" ? "indoor or outdoor use" : undefined;
  const facts = [capacity, type, placement].filter(Boolean);
  return facts.length >= 2 ? `Stated as ${facts.join(", ")}.` : undefined;
}

export function primaryTradeoff(view: ProductView, cat: CategoryDefinition): string | undefined {
  const authored = view.editorial.tradeoffs[0] ?? deriveInsights(view, cat).find((i) => i.tone === "tradeoff")?.text;
  if (authored || cat.id !== "saunas") return authored;
  const width = view.attributes.width_in;
  const depth = view.attributes.depth_in;
  const voltage = view.attributes.voltage === "120v" ? "120V" : view.attributes.voltage === "240v" ? "240V" : undefined;
  const amps = typeof view.attributes.amperage_a === "number" ? `${view.attributes.amperage_a}A` : undefined;
  const needs: string[] = [];
  if (typeof width === "number" && typeof depth === "number") needs.push(`${width} × ${depth} in exterior footprint`);
  if (voltage) needs.push(`${voltage}${amps ? ` / ${amps}` : ""} electrical service`);
  return needs.length > 0 ? `Plan for ${needs.join(" and ")}; confirm installation requirements with the retailer.` : undefined;
}
