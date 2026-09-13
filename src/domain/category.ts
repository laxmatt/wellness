import { z } from "zod";
import { AttributeDefinition } from "./attributes";
import { Market } from "./money";
import { Id, ImageAsset, Slug } from "./product";

// A filter key is an attribute key or the reserved "price" key (minor units).
export const FilterKey = z.string();

// Named, and exported, so the model's instructions can be generated from the
// same list that validates its answer. A prompt that describes a contract the
// validator does not enforce, or omits one it does, silently discards replies.
export const CONDITION_OPS = ["lt", "lte", "gt", "gte", "eq", "neq", "in", "includes", "exists", "missing"] as const;

export const Condition = z.object({
  key: FilterKey,
  op: z.enum(CONDITION_OPS),
  value: z.union([z.number(), z.string(), z.boolean(), z.array(z.string()), z.array(z.number())]).optional(),
});
export type Condition = z.infer<typeof Condition>;

export const FilterSpec = z.object({
  key: FilterKey,
  label: z.string(),
  kind: z.enum(["range", "enum", "boolean", "list"]),
  // Range presets shown as chips, in minor units for price.
  presets: z.array(z.object({ label: z.string(), condition: Condition })).optional(),
});
export type FilterSpec = z.infer<typeof FilterSpec>;

export const ScoringCriterion = z.object({
  key: FilterKey,
  weight: z.number().positive(),
});

export const ScoringConfig = z.object({
  criteria: z.array(ScoringCriterion).min(1),
  // What the number measures, in the UI's words. Never "quality" unless the
  // criteria genuinely measure build quality: a weighted sum over capability
  // attributes ranks suitability for the category's dominant use, and a
  // smaller product is not a worse one.
  label: z.string().default("Capability score"),
  // One sentence shown wherever the number appears.
  meaning: z.string(),
  // Segments that share a scale. Products in different segments are compared
  // on the same axis, so the copy must say what the axis rewards.
  segmentKey: z.string().optional(),
  // Share of required attributes a product must have to be badge-eligible.
  completenessFloor: z.number().min(0).max(1).default(0.6),
});
export type ScoringConfig = z.infer<typeof ScoringConfig>;

// Placeholder value formula, tunable per category, not final:
//   value = qualityWeight * quality(0..100) + affordabilityWeight * affordability(0..100)
// affordability is the inverse of linearly normalized price within the category.
// minQualityShare is an optional guard, off by default.
export const ValueFormulaConfig = z.object({
  qualityWeight: z.number().min(0).default(0.65),
  affordabilityWeight: z.number().min(0).default(0.35),
  // "price" uses the product's current price. "attribute:<key>" uses a
  // numeric attribute such as price_per_serving_minor.
  priceBasis: z.string().default("price"),
  minQualityShare: z.number().min(0).max(1).default(0),
});
export type ValueFormulaConfig = z.infer<typeof ValueFormulaConfig>;

export const BadgeRules = z.object({
  // "price" or "attribute:<key>" (e.g. per-serving cost for drinks).
  priceBasis: z.string().default("price"),
  budgetMaxMinor: z.number().int().positive(),
  premiumMinMinor: z.number().int().positive(),
  minQualifying: z.number().int().min(1).default(2),
  // Attribute keys used to break exact score ties, in order.
  tieBreak: z.array(FilterKey).default([]),
});
export type BadgeRules = z.infer<typeof BadgeRules>;

export const InsightRule = z.object({
  id: Id,
  when: z.array(Condition).min(1),
  // Placeholders like {irradiance} are replaced with formatted attribute values.
  text: z.string(),
  tone: z.enum(["strength", "tradeoff", "neutral"]),
});
export type InsightRule = z.infer<typeof InsightRule>;

export const PriceTier = z.object({
  id: Id,
  label: z.string(),
  maxMinor: z.number().int().positive().optional(),
});

export const FacetPage = z.object({
  slug: Slug,
  // Short chip label ("Full body"). title is the page heading.
  label: z.string().min(1).max(24),
  title: z.string(),
  description: z.string(),
  conditions: z.array(Condition).min(1),
});
export type FacetPage = z.infer<typeof FacetPage>;

export const Subcategory = z.object({ id: Id, label: z.string() });

export const CategoryDefinition = z.object({
  id: Id,
  slug: Slug,
  name: z.string(),
  navLabel: z.string(),
  tagline: z.string(),
  intro: z.string().max(400),
  market: Market.default("US"),
  images: z.array(ImageAsset).default([]),
  subcategories: z.array(Subcategory).default([]),
  attributeDefinitions: z.array(AttributeDefinition).min(1),
  cardSpecKeys: z.array(FilterKey).min(1).max(4),
  compareGroups: z.array(z.object({ label: z.string(), keys: z.array(FilterKey).min(1) })),
  filters: z.array(FilterSpec),
  scoring: ScoringConfig,
  value: ValueFormulaConfig,
  badges: BadgeRules,
  insightRules: z.array(InsightRule),
  relaxationOrder: z.array(FilterKey),
  priceTiers: z.array(PriceTier).min(1),
  facets: z.array(FacetPage),
  // Synonyms the matcher maps to enum values. Deterministic, hand-maintained.
  matcherVocabulary: z.record(FilterKey, z.record(z.string(), z.array(z.string()))).default({}),
  // Other names for the category itself, as a shopper would type them.
  // Hand-maintained, like matcherVocabulary, and used for one thing: deciding
  // that a message is about a different section of this site. It is a written
  // list, not a model of language, and a phrase nobody wrote down here is not
  // recognised. See src/domain/subject-scope.ts.
  aliases: z.array(z.string()).default([]),
}).superRefine((cat, ctx) => {
  const keys = new Set(cat.attributeDefinitions.map((a) => a.key));
  keys.add("price");
  const check = (k: string, where: string) => {
    if (!keys.has(k)) ctx.addIssue({ code: "custom", message: `${where} references unknown key "${k}"` });
  };
  cat.cardSpecKeys.forEach((k) => check(k, "cardSpecKeys"));
  cat.compareGroups.forEach((g) => g.keys.forEach((k) => check(k, `compareGroups.${g.label}`)));
  cat.filters.forEach((f) => check(f.key, "filters"));
  cat.scoring.criteria.forEach((c) => check(c.key, "scoring.criteria"));
  cat.badges.tieBreak.forEach((k) => check(k, "badges.tieBreak"));
  cat.relaxationOrder.forEach((k) => check(k, "relaxationOrder"));
  cat.insightRules.forEach((r) => r.when.forEach((c) => check(c.key, `insightRules.${r.id}`)));
  cat.facets.forEach((f) => f.conditions.forEach((c) => check(c.key, `facets.${f.slug}`)));
  for (const basis of [cat.value.priceBasis, cat.badges.priceBasis]) {
    if (basis !== "price") {
      if (!basis.startsWith("attribute:")) {
        ctx.addIssue({ code: "custom", message: `priceBasis "${basis}" must be "price" or "attribute:<key>"` });
      } else {
        check(basis.slice("attribute:".length), "priceBasis");
      }
    }
  }
  if (cat.badges.budgetMaxMinor >= cat.badges.premiumMinMinor) {
    ctx.addIssue({ code: "custom", message: "budgetMaxMinor must be below premiumMinMinor" });
  }
});
export type CategoryDefinition = z.infer<typeof CategoryDefinition>;

export function attributeDef(cat: CategoryDefinition, key: string): AttributeDefinition | undefined {
  return cat.attributeDefinitions.find((a) => a.key === key);
}
