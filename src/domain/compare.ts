import { isUsable } from "@/domain/provenance";
import type { CategoryDefinition } from "./category";
import { attributeDef } from "./category";
import { comparable } from "./conditions";
import { formatMoney } from "./money";
import type { Badge } from "./recommend/badges";
import { primaryStrength, primaryTradeoff, type RecommendedProduct } from "./recommend";
import type { Verification } from "./provenance";
import { displayPrice, type ProductView } from "./view";

// Serializable comparison model. Built on the server so the client component
// carries no domain code, only rows to render.

export type CompareCell = {
  text: string;
  verification?: Verification;
  best: boolean;
};

export type CompareRow = {
  key: string;
  label: string;
  cells: CompareCell[];
  // Every product states the same value. The UI can fold these away.
  same: boolean;
  // Set when no winner is marked because the values are not comparable, e.g.
  // one product states irradiance without the distance it was measured at.
  notComparable?: string;
};

export type CompareGroup = { label: string; rows: CompareRow[] };

export type CompareColumn = {
  id: string;
  slug: string;
  name: string;
  brand: string;
  price: string;
  badge: Badge | null;
  image: ProductView["images"][number] | undefined;
  score: number;
};

export type CompareModel = {
  columns: CompareColumn[];
  groups: CompareGroup[];
};

function isDemoValue(view: ProductView, key: string): boolean {
  const v = view.provenance[`attributes.${key}`]?.verification;
  return v !== undefined && !isUsable(v);
}

// A winner is only marked when the numbers mean the same thing. Three ways a
// row fails that test: the attribute has no better-or-worse direction, some
// value is a placeholder, or the attribute was measured under conditions that
// are missing or differ between products (irradiance at an unstated distance).
function comparability(items: RecommendedProduct[], cat: CategoryDefinition, key: string): { ok: true } | { ok: false; reason?: string } {
  const def = key === "price" ? undefined : attributeDef(cat, key);
  const dir = key === "price" ? "lower_better" : (def?.preferenceDirection ?? "neutral");
  if (dir === "neutral") return { ok: false };

  if (key !== "price" && items.some((it) => isDemoValue(it.view, key))) {
    return { ok: false, reason: "Not ranked: at least one value here is placeholder data." };
  }
  if (key === "price" && items.some((it) => it.view.price.isDemo)) {
    return { ok: false, reason: "Not ranked: at least one price here is a placeholder." };
  }

  const condKey = def?.comparabilityKey;
  if (condKey) {
    const stated = items.map((it) => it.view.attributes[condKey]);
    const condLabel = (attributeDef(cat, condKey)?.shortLabel ?? condKey).toLowerCase();
    if (stated.some((v) => v === undefined)) {
      return { ok: false, reason: `Not ranked: ${condLabel} is not stated for every product, so these figures are not comparable.` };
    }
    if (new Set(stated.map((v) => JSON.stringify(v))).size > 1) {
      return { ok: false, reason: `Not ranked: these figures were measured at a different ${condLabel}.` };
    }
  }

  // Last, because the conditions a figure was taken under are the more useful
  // thing to say when both are wrong. A bound is not an exact value: "more than
  // 189 mW/cm2" beats a stated 185, and against a stated 200 nobody knows, so
  // no winner is marked in a row where any figure is a bound.
  if (key !== "price" && items.some((it) => it.view.bounds[key] !== undefined)) {
    return { ok: false, reason: "Not ranked: at least one figure here is a stated bound, not an exact value." };
  }
  return { ok: true };
}

function bestIndexes(items: RecommendedProduct[], cat: CategoryDefinition, key: string): Set<number> {
  if (!comparability(items, cat, key).ok) return new Set();
  const dir = key === "price" ? "lower_better" : (attributeDef(cat, key)?.preferenceDirection ?? "neutral");
  const vals = items.map((it) => comparable(it.view, cat, key));
  const present = vals.filter((v): v is number => v !== undefined);
  if (present.length < 2) return new Set();
  const target = dir === "higher_better" ? Math.max(...present) : Math.min(...present);
  // No winner when everything ties.
  if (present.every((v) => v === target)) return new Set();
  const out = new Set<number>();
  vals.forEach((v, i) => {
    if (v === target) out.add(i);
  });
  return out;
}

export function buildCompareModel(items: RecommendedProduct[], cat: CategoryDefinition): CompareModel {
  const columns: CompareColumn[] = items.map((it) => ({
    id: it.view.id,
    slug: it.view.slug,
    name: it.view.name,
    brand: it.view.brand.name,
    price: displayPrice(it.view.price),
    badge: it.badges[0] ?? null,
    image: it.view.images.find((i) => i.role === "card") ?? it.view.images.find((i) => i.role === "primary") ?? it.view.images[0],
    score: it.score,
  }));

  const priceBest = bestIndexes(items, cat, "price");
  const priceComparable = comparability(items, cat, "price");
  const scores = items.map((it) => it.score);
  const topScore = Math.max(...scores);

  const overview: CompareGroup = {
    label: "Overview",
    rows: [
      {
        key: "price",
        label: "Price",
        cells: items.map((it, i) => ({ text: displayPrice(it.view.price), best: priceBest.has(i) })),
        same: new Set(items.map((it) => it.view.price.money.amountMinor)).size === 1,
        notComparable: priceComparable.ok ? undefined : priceComparable.reason,
      },
      {
        key: "score",
        label: cat.scoring.label,
        cells: items.map((it) => ({ text: `${it.score} / 100`, best: it.score === topScore && new Set(scores).size > 1 })),
        same: new Set(scores).size === 1,
      },
      {
        key: "why",
        label: "Why",
        cells: items.map((it) => ({ text: primaryStrength(it.view, cat) ?? "Nothing flagged", best: false })),
        same: false,
      },
      {
        key: "tradeoff",
        label: "Tradeoff",
        // No rule fired is not evidence of no tradeoff. Say what we did.
        cells: items.map((it) => ({ text: primaryTradeoff(it.view, cat) ?? "Tradeoffs not assessed", best: false })),
        same: false,
      },
    ],
  };

  const groups: CompareGroup[] = cat.compareGroups.map((g) => ({
    label: g.label,
    rows: g.keys.map((key) => {
      const specs = items.map((it) => it.view.specs.find((s) => s.key === key));
      const best = bestIndexes(items, cat, key);
      const comp = comparability(items, cat, key);
      const texts = specs.map((s) => s?.formatted ?? "Not stated");
      return {
        key,
        label: specs.find(Boolean)?.shortLabel ?? key,
        notComparable: comp.ok ? undefined : comp.reason,
        cells: specs.map((s, i) => ({
          text: texts[i],
          verification: s?.provenance && (s.alwaysShowVerification || !isUsable(s.provenance.verification)) ? s.provenance.verification : undefined,
          best: best.has(i),
        })),
        same: new Set(texts).size === 1,
      };
    }),
  }));

  const retailers: CompareGroup = {
    label: "Buying",
    rows: [
      {
        key: "retailers",
        label: "Retailers",
        cells: items.map((it) => ({
          text:
            it.view.offers.length === 0
              ? "None listed"
              : it.view.price.isDemo
                ? `${it.view.offers.length}, price not confirmed`
                : `${it.view.offers.length}, from ${formatMoney(it.view.price.money)}`,
          best: false,
        })),
        same: new Set(items.map((it) => it.view.offers.length)).size === 1,
      },
    ],
  };

  return { columns, groups: [overview, ...groups, retailers] };
}

export function differingRowCount(model: CompareModel): number {
  return model.groups.reduce((n, g) => n + g.rows.filter((r) => !r.same).length, 0);
}
