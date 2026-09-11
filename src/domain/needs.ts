import type { CategoryDefinition, Condition } from "./category";
import { attributeDef } from "./category";
import { comparable, conditionTarget, evaluateCondition, isUnconfirmedPriceClaim } from "./conditions";
import type { Bound } from "./provenance";
import { priceMinorOf, type ProductView } from "./view";

/**
 * Whether a product meets a requirement the shopper set, in three states.
 *
 * `evaluateCondition` answers one question and answers it correctly: may this
 * product be admitted. It returns false for three different situations, and it
 * has to: a product whose weight is unrecorded must not be admitted by "under
 * 40 lb", and neither must one that is disputed or priced with a placeholder.
 *
 * A shopper reading a card is asking a different question. "Does not match" and
 * "we cannot tell" are not the same news. One rules a product out; the other is
 * a thing to go and check. So this classifies the same predicate three ways and
 * never contradicts it:
 *
 *   evaluateCondition true  => "match", always.
 *   evaluateCondition false => "miss" only when the catalogue settles it.
 *                              Otherwise "unknown".
 *
 * Nothing here evaluates anything the engine does not. It calls the engine for
 * the yes, and it decides between the two kinds of no from data the view
 * already carries.
 */
export type NeedState = "match" | "miss" | "unknown";

/** Why a value cannot settle a question. Read from the view, not inferred. */
export type Withholding =
  // The catalogue holds a usable value.
  | "none"
  // The source states the figure two ways, or it cannot be shown to belong to
  // this product.
  | "disputed"
  // A money figure resting on a placeholder price.
  | "placeholder_price"
  // Stated, but by nothing this site will treat as fact: demo data, or a page
  // that does not state it.
  | "not_usable"
  // The catalogue holds nothing at all for this key.
  | "absent";

export function withholdingOf(view: ProductView, key: string): Withholding {
  if (key === "price") return view.price.money === undefined ? "absent" : view.price.isDemo ? "placeholder_price" : "none";
  if (view.attributes[key] !== undefined) return "none";
  const spec = view.specs.find((s) => s.key === key);
  if (!spec) return "absent";
  if (spec.disputed) return "disputed";
  if (spec.moneyWithheld) return "placeholder_price";
  // `raw` survives the verification screen; `attributes` does not. A value in
  // one and not the other was stated by a source this site will not treat as
  // fact.
  return spec.raw !== undefined ? "not_usable" : "absent";
}

/**
 * What a bound settles, and what it does not.
 *
 * `evaluateBounded` in conditions.ts answers the admission question, so every
 * case it cannot settle is false there, alongside the cases it settles as no.
 * Here the two are pulled apart. "Less than 1 g" against "4 g or more" is a
 * definite no: every value the bound allows fails. Against "0.5 g or less" it
 * is a shrug: the real figure could be either side.
 */
function classifyBounded(bound: Bound, stated: number, op: Condition["op"], target: number): NeedState {
  if (bound === "less_than") {
    // The real value lies somewhere below `stated`.
    switch (op) {
      case "lt":
      case "lte":
        return target >= stated ? "match" : "unknown";
      case "gt":
      case "gte":
      case "eq":
        return target >= stated ? "miss" : "unknown";
      case "neq":
        return target >= stated ? "match" : "unknown";
      default:
        return "unknown";
    }
  }
  // The real value lies somewhere above `stated`.
  switch (op) {
    case "gt":
    case "gte":
      return target <= stated ? "match" : "unknown";
    case "lt":
    case "lte":
    case "eq":
      return target <= stated ? "miss" : "unknown";
    case "neq":
      return target <= stated ? "match" : "unknown";
    default:
      return "unknown";
  }
}

export function classifyCondition(view: ProductView, cat: CategoryDefinition, c: Condition): NeedState {
  // The engine's yes is this function's yes, without exception. Anything it
  // admits, it admitted on data it could use.
  if (evaluateCondition(view, cat, c)) return "match";

  // A placeholder amount qualifies nothing and disqualifies nothing.
  if (isUnconfirmedPriceClaim(view, cat, c)) return "unknown";

  const raw = c.key === "price" ? priceMinorOf(view) : view.attributes[c.key];
  const held = withholdingOf(view, c.key);

  // These two ask what the catalogue holds, so a withheld value is neither a
  // presence nor an absence: the record has something and this site will not
  // use it.
  if (c.op === "exists") return held === "absent" ? "miss" : "unknown";
  if (c.op === "missing") return held === "absent" ? "match" : "unknown";

  // Nothing usable to compare against. False here was never the product
  // failing; it was the catalogue declining to answer. Zero and false are
  // values, not absences, and reach this line only when they genuinely fail.
  if (raw === undefined) return "unknown";

  const bound = c.key === "price" ? undefined : view.bounds[c.key];
  if (bound !== undefined && typeof raw === "number") {
    const target = conditionTarget(cat, c.key, c.value);
    return target === undefined ? "unknown" : classifyBounded(bound, raw, c.op, target);
  }

  switch (c.op) {
    case "eq":
    case "neq":
      return "miss";
    case "in":
      return Array.isArray(c.value) ? "miss" : "unknown";
    case "includes":
      // A list this product holds and the value is not in it: a real no. A
      // value that is not a list at all cannot be asked this question.
      return Array.isArray(raw) ? "miss" : "unknown";
    case "lt":
    case "lte":
    case "gt":
    case "gte": {
      const left = comparable(view, cat, c.key);
      const right = conditionTarget(cat, c.key, c.value);
      // A value that exists but cannot be ordered, an enum with no ranks among
      // them, settles nothing either way.
      return left === undefined || right === undefined ? "unknown" : "miss";
    }
    default:
      return "unknown";
  }
}

/** The three states for one requirement, as product id lists. */
export type NeedDefinition = {
  // Matches the FilterOption id where one exists, so a selected chip maps
  // straight to its requirement without a second lookup.
  id: string;
  // What the shopper picked, in the site's own words.
  label: string;
  // The row it came from ("Price", "Coverage"), or the section for a facet.
  groupLabel: string;
  source: "filter" | "facet" | "assistant";
  matchIds: string[];
  unknownIds: string[];
};

/**
 * Why one product cannot answer one requirement, in the site's own words.
 *
 * Written from `withholdingOf`, so every sentence names something the record
 * actually says about itself. Nothing here guesses at a value or its cause.
 */
export function unknownReason(view: ProductView, cat: CategoryDefinition, key: string): string {
  const def = attributeDef(cat, key);
  const label = key === "price" ? "price" : (def?.shortLabel ?? def?.label ?? key).toLowerCase();
  switch (withholdingOf(view, key)) {
    case "disputed":
      return `Its ${label} is recorded two ways that disagree, so we cannot match on it.`;
    case "placeholder_price":
      return `Its ${label} is prototype data, not a confirmed amount.`;
    case "not_usable":
      return `Its ${label} is on the record but not from a source we treat as fact.`;
    case "absent":
      return `We hold no ${label} for it.`;
    case "none":
      // A usable value that still settles nothing: a bound too wide for the
      // question, or a value that cannot be ordered.
      return `Its stated ${label} does not settle this either way.`;
  }
}

/**
 * Requirements for one category, classified against every product in it.
 *
 * Computed on the server over the WHOLE category, never over a page's visible
 * subset. A comparison can hold a product a filter excluded, and a facet page's
 * options are built from that facet's products alone: classifying against
 * either would call a product a mismatch on the strength of not being in a list
 * it was never eligible for.
 */
export function buildNeedCatalogue(
  views: ProductView[],
  cat: CategoryDefinition,
  options: { id: string; label: string; groupLabel: string; conditions: Condition[]; source: "filter" | "facet" }[],
): NeedDefinition[] {
  return options.map((o) => {
    const matchIds: string[] = [];
    const unknownIds: string[] = [];
    for (const v of views) {
      const state = classifyConditions(v, cat, o.conditions);
      if (state === "match") matchIds.push(v.id);
      else if (state === "unknown") unknownIds.push(v.id);
    }
    return { id: o.id, label: o.label, groupLabel: o.groupLabel, source: o.source, matchIds, unknownIds };
  });
}

/**
 * One requirement made of several conditions, all of which must hold.
 *
 * A definite failure on any one of them is a definite failure, whatever the
 * others do: nothing a shopper checks afterwards will make a product that is
 * too expensive cheap enough. Short of that, an unanswerable condition leaves
 * the whole requirement unanswerable.
 */
export function classifyConditions(view: ProductView, cat: CategoryDefinition, conditions: Condition[]): NeedState {
  let unknown = false;
  for (const c of conditions) {
    const state = classifyCondition(view, cat, c);
    if (state === "miss") return "miss";
    if (state === "unknown") unknown = true;
  }
  return unknown ? "unknown" : "match";
}

/** One product against one requirement, from the lists above. */
export function stateFor(need: Pick<NeedDefinition, "matchIds" | "unknownIds">, productId: string): NeedState {
  if (need.matchIds.includes(productId)) return "match";
  if (need.unknownIds.includes(productId)) return "unknown";
  return "miss";
}
