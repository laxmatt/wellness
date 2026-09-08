import type { CategoryDefinition, Condition } from "../category";
import { attributeDef } from "../category";
import { comparable, evaluateCondition, matchesAll } from "../conditions";
import type { MatchResult, PreferenceSet, ProductExplanation, Relaxation, SoftPreference } from "../personalization";
import { toScoringInput, scoreProducts } from "../recommend/score";
import type { ProductView } from "../view";
import { describeConstraint, describeFit, describeGap, labelFor } from "./describe";

export const MEDICAL_REDIRECT =
  "I can compare these products by size, coverage, price, setup and the other specifications on this page, but I can't determine which will treat a medical condition.";

// Deterministic. The AI never reaches this function; it only produces the
// PreferenceSet that comes in as an argument.

function softScore(view: ProductView, cat: CategoryDefinition, soft: SoftPreference[]): { score: number; met: SoftPreference[]; unmet: SoftPreference[] } {
  let score = 0;
  let total = 0;
  const met: SoftPreference[] = [];
  const unmet: SoftPreference[] = [];
  for (const p of soft) {
    total += p.weight;
    const raw = p.key === "price" ? view.price.money.amountMinor : view.attributes[p.key];
    let hit = false;
    if (p.value !== undefined) {
      if (Array.isArray(p.value)) {
        hit = Array.isArray(raw) ? p.value.some((v) => (raw as string[]).includes(v)) : p.value.includes(raw as string);
      } else {
        const def = attributeDef(cat, p.key);
        if (def?.type === "enum") {
          // Ordinal enums count as met at or above the asked rank.
          const want = def.enumOptions?.find((o) => o.value === p.value)?.rank;
          const have = comparable(view, cat, p.key);
          hit = want !== undefined && have !== undefined ? (p.direction === "prefer_low" ? have <= want : have >= want) : raw === p.value;
        } else {
          hit = raw === p.value;
        }
      }
    } else {
      const n = comparable(view, cat, p.key);
      hit = n !== undefined;
    }
    if (hit) {
      score += p.weight;
      met.push(p);
    } else {
      unmet.push(p);
    }
  }
  return { score: total === 0 ? 0 : (100 * score) / total, met, unmet };
}

function describeSoft(view: ProductView, cat: CategoryDefinition, p: SoftPreference, met: boolean): string {
  const label = labelFor(cat, p.key);
  const raw = p.key === "price" ? view.price.money.amountMinor : view.attributes[p.key];
  if (met) return describeFit(view, cat, { key: p.key, op: "eq", value: p.value });
  if (raw === undefined) return `${label} not stated`;
  return describeGap(view, cat, { key: p.key, op: "eq", value: p.value }).text;
}

// No-match handling. For every hard constraint we produce one route that
// honours that constraint and names what it costs against the others. When
// nothing in the catalogue satisfies a constraint, the route falls back to the
// product closest to it. A user never sees an empty result.
export function relaxationSearch(views: ProductView[], cat: CategoryDefinition, hard: Condition[]): Relaxation[] {
  if (views.length === 0 || hard.length === 0) return [];

  const order = [...hard].sort((a, b) => {
    const ia = cat.relaxationOrder.indexOf(a.key);
    const ib = cat.relaxationOrder.indexOf(b.key);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // Gaps are normalized per constraint so a dollar miss and a coverage miss
  // can be added together without one drowning the other.
  const spans = new Map<string, number>();
  for (const c of hard) {
    const gaps = views.map((v) => describeGap(v, cat, c).magnitude).filter((m) => Number.isFinite(m));
    const max = Math.max(1, ...gaps);
    spans.set(c.key, max);
  }
  const norm = (v: ProductView, c: Condition) =>
    evaluateCondition(v, cat, c) ? 0 : Math.min(1, describeGap(v, cat, c).magnitude / (spans.get(c.key) ?? 1));

  const out: Relaxation[] = [];
  const used = new Set<string>();

  for (const kept of order) {
    const others = hard.filter((c) => c !== kept);
    const satisfying = views.filter((v) => evaluateCondition(v, cat, kept));
    const pool = satisfying.length > 0 ? satisfying : views;

    // The kept constraint decides this route, so it sorts first. The other
    // constraints only break ties. Weighting them equally would let a route
    // meant to protect the budget return the most expensive product.
    const ranked = [...pool].sort((a, b) => {
      const ka = norm(a, kept);
      const kb = norm(b, kept);
      if (ka !== kb) return ka - kb;
      const oa = others.reduce((n, c) => n + norm(a, c), 0);
      const ob = others.reduce((n, c) => n + norm(b, c), 0);
      if (oa !== ob) return oa - ob;
      return a.price.money.amountMinor - b.price.money.amountMinor;
    });

    // Prefer a product this route has not already recommended.
    const pick = ranked.find((v) => !used.has(v.id)) ?? ranked[0];
    if (!pick) continue;
    used.add(pick.id);

    const failing = hard.filter((c) => !evaluateCondition(pick, cat, c));
    const misses = failing
      .map((c) => ({ c, g: describeGap(pick, cat, c) }))
      .sort((a, b) => norm(pick, a.c) - norm(pick, b.c))
      .map((x) => x.g.text);

    out.push({
      keptKey: kept.key,
      keptLabel: describeConstraint(cat, kept),
      productId: pick.id,
      keptSatisfied: satisfying.length > 0,
      misses,
    });
  }
  return out;
}

export function applyPreferences(views: ProductView[], cat: CategoryDefinition, prefs: PreferenceSet): MatchResult {
  const published = views.filter((v) => v.status === "published");
  const base = new Map(scoreProducts(published.map(toScoringInput), cat).map((s) => [s.id, s.score]));

  const explanations: Record<string, ProductExplanation> = {};
  for (const v of published) {
    const fits: string[] = [];
    const misses: string[] = [];
    for (const c of prefs.hard) {
      if (evaluateCondition(v, cat, c)) fits.push(describeFit(v, cat, c));
      else misses.push(describeGap(v, cat, c).text);
    }
    const soft = softScore(v, cat, prefs.soft);
    for (const p of soft.met) fits.push(describeSoft(v, cat, p, true));
    for (const p of soft.unmet) misses.push(describeSoft(v, cat, p, false));
    explanations[v.id] = { productId: v.id, fits, misses, softScore: Math.round(soft.score * 10) / 10 };
  }

  const qualifying = published.filter((v) => matchesAll(v, cat, prefs.hard));

  // Personalized order: soft fit first, then the category quality score.
  const ranked = [...qualifying].sort((a, b) => {
    const sa = explanations[a.id].softScore;
    const sb = explanations[b.id].softScore;
    if (sa !== sb) return sb - sa;
    return (base.get(b.id) ?? 0) - (base.get(a.id) ?? 0);
  });

  return {
    bestMatchId: ranked[0]?.id ?? null,
    alternativeIds: ranked.slice(1, 4).map((v) => v.id),
    explanations,
    relaxations: qualifying.length === 0 ? relaxationSearch(published, cat, prefs.hard) : [],
    medicalRedirect: prefs.medicalIntent,
    constraintLabels: prefs.hard.map((c) => ({ key: c.key, label: describeConstraint(cat, c) })),
  };
}
