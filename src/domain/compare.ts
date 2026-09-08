import type { CategoryDefinition } from "./category";
import { attributeDef } from "./category";
import { comparable } from "./conditions";
import { formatMoney } from "./money";
import type { Badge } from "./recommend/badges";
import { primaryStrength, primaryTradeoff, type RecommendedProduct } from "./recommend";
import type { Verification } from "./provenance";
import type { ProductView } from "./view";

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

function bestIndexes(items: RecommendedProduct[], cat: CategoryDefinition, key: string): Set<number> {
  // "price" is not an attribute definition; cheaper is better by convention.
  const dir = key === "price" ? "lower_better" : (attributeDef(cat, key)?.preferenceDirection ?? "neutral");
  if (dir === "neutral") return new Set();
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
    price: formatMoney(it.view.price.money),
    badge: it.badges[0] ?? null,
    image: it.view.images.find((i) => i.role === "card") ?? it.view.images.find((i) => i.role === "primary") ?? it.view.images[0],
    score: it.score,
  }));

  const priceBest = bestIndexes(items, cat, "price");
  const scores = items.map((it) => it.score);
  const topScore = Math.max(...scores);

  const overview: CompareGroup = {
    label: "Overview",
    rows: [
      {
        key: "price",
        label: "Price",
        cells: items.map((it, i) => ({ text: formatMoney(it.view.price.money), best: priceBest.has(i) })),
        same: new Set(items.map((it) => it.view.price.money.amountMinor)).size === 1,
      },
      {
        key: "score",
        label: "Quality score",
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
        cells: items.map((it) => ({ text: primaryTradeoff(it.view, cat) ?? "None flagged", best: false })),
        same: false,
      },
    ],
  };

  const groups: CompareGroup[] = cat.compareGroups.map((g) => ({
    label: g.label,
    rows: g.keys.map((key) => {
      const specs = items.map((it) => it.view.specs.find((s) => s.key === key));
      const best = bestIndexes(items, cat, key);
      const texts = specs.map((s) => s?.formatted ?? "Not stated");
      return {
        key,
        label: specs.find(Boolean)?.shortLabel ?? key,
        cells: specs.map((s, i) => ({
          text: texts[i],
          verification: s?.provenance && (s.alwaysShowVerification || s.provenance.verification === "demo") ? s.provenance.verification : undefined,
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
        cells: items.map((it) => ({ text: it.view.offers.length === 0 ? "None listed" : `${it.view.offers.length}, from ${formatMoney(it.view.price.money)}`, best: false })),
        same: new Set(items.map((it) => it.view.offers.length)).size === 1,
      },
    ],
  };

  return { columns, groups: [overview, ...groups, retailers] };
}

export function differingRowCount(model: CompareModel): number {
  return model.groups.reduce((n, g) => n + g.rows.filter((r) => !r.same).length, 0);
}
