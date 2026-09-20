/**
 * The same sauna, sold by two retailers, recognised as one.
 *
 * Four partners now publish catalogues and they overlap: Dundalk, Harvia and
 * Almost Heaven cabins turn up in more than one store. A shopper should see one
 * model with two places to buy it, not two cards with different prices.
 *
 * Getting that wrong is worse than not doing it. Merging two different saunas
 * puts one retailer's price on another retailer's product, and a shopper
 * clicking through buys something other than what they read about. So this is
 * built to refuse rather than to guess, and it never writes anything: it
 * reports three strengths and a person decides.
 *
 * **A stable identifier settles it.** The same GTIN is the same product, by
 * definition. The same manufacturer part number under the same brand is the
 * same product for every practical purpose. Either is `confirmed`.
 *
 * **A normalised brand and model is a proposal, not a finding.** Two records
 * whose brand and model agree exactly after a deterministic normalisation are
 * very probably one product, and "very probably" is `proposed`: it goes to a
 * person. Nothing here scores a similarity, measures an edit distance, or
 * decides that two titles are close enough. Normalisation is lowercasing,
 * collapsing whitespace and dropping punctuation; after it the strings are
 * equal or they are not.
 *
 * **A title alone never merges anything.** Two records with the same model
 * words and different brands are `ambiguous`, and so is any pair whose stable
 * identifiers actively disagree. Both go to a person and neither is applied.
 *
 * **A retailer's own name is not a brand.** Every record a retailer publishes
 * under its own house name carries that name, so "Sweat Kingdom The Ascent" and
 * "Topture The Ascent" would match on model and differ on brand, which is
 * exactly the pair that must not merge: neither record says who made it.
 */

import type { Product } from "@/domain/product";

export type MatchStrength = "confirmed" | "proposed" | "ambiguous";
export type MatchEvidence = "gtin" | "mpn_and_brand" | "brand_and_model";

export type CanonicalRecord = {
  id: string;
  /** The partner whose catalogue this came from. */
  sourceId: string;
  merchantId: string;
  name: string;
  brandId: string;
  mpn?: string;
  gtin: string[];
  priceMinor?: number;
};

export type CanonicalGroup = {
  /** Derived from the evidence, so the same evidence always names the same group. */
  key: string;
  members: CanonicalRecord[];
  strength: MatchStrength;
  evidence: MatchEvidence[];
  /** Why, in the words the tool shows a reviewer. */
  why: string;
};

/**
 * A string reduced to the characters that carry meaning.
 *
 * Deterministic and lossless in the only sense that matters: two strings that
 * differ by case, spacing or punctuation come out equal, and two that differ by
 * a word do not. No stemming, no synonyms, no dropped words. "The Ascent
 * (6 Person)" and "the ascent 6 person" are one string; "The Ascent" is not.
 */
export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

/** A record's own view of itself, for matching. */
export function canonicalRecordOf(product: Product, sourceId: string): CanonicalRecord {
  const offer = product.offers[0];
  return {
    id: product.id,
    sourceId,
    merchantId: offer?.merchantId ?? "",
    name: product.name,
    brandId: product.brandId,
    mpn: product.identifiers.mpn?.trim() || undefined,
    gtin: product.identifiers.gtin.filter((g) => g.trim() !== ""),
    priceMinor: offer?.priceMinor,
  };
}

const sameBrand = (a: CanonicalRecord, b: CanonicalRecord): boolean => normalise(a.brandId) === normalise(b.brandId) && normalise(a.brandId) !== "";

/**
 * Whether the stable identifiers of two records actively disagree.
 *
 * Two non-empty MPNs that are different is a statement that these are different
 * parts. It outranks any agreement of names, and it is the one thing that can
 * turn a confident-looking match into a question.
 */
function identifiersConflict(a: CanonicalRecord, b: CanonicalRecord): boolean {
  if (a.mpn && b.mpn && normalise(a.mpn) !== normalise(b.mpn)) return true;
  if (a.gtin.length > 0 && b.gtin.length > 0 && !a.gtin.some((g) => b.gtin.includes(g))) return true;
  return false;
}

type Pair = { a: CanonicalRecord; b: CanonicalRecord; strength: MatchStrength; evidence: MatchEvidence; why: string };

function pairOf(a: CanonicalRecord, b: CanonicalRecord): Pair | undefined {
  // Never a record against another from the same store: a store's own two
  // listings for one thing are its variants, and that is grouped upstream.
  if (a.sourceId === b.sourceId) return undefined;

  const shared = a.gtin.find((g) => b.gtin.includes(g));
  if (shared) {
    return { a, b, strength: "confirmed", evidence: "gtin", why: `Both carry GTIN ${shared}, which names one product.` };
  }
  if (identifiersConflict(a, b)) {
    // Only worth saying where something else suggested they were the same.
    if (normalise(a.name) !== normalise(b.name)) return undefined;
    return {
      a,
      b,
      strength: "ambiguous",
      evidence: "brand_and_model",
      why: `The names agree and the identifiers do not: ${a.id} says ${a.mpn ?? a.gtin.join(", ")} and ${b.id} says ${b.mpn ?? b.gtin.join(", ")}. One of them is wrong, or these are different things with one name.`,
    };
  }
  if (a.mpn && b.mpn && normalise(a.mpn) === normalise(b.mpn)) {
    if (sameBrand(a, b)) {
      return { a, b, strength: "confirmed", evidence: "mpn_and_brand", why: `Both are ${a.brandId} part ${a.mpn}, which names one product.` };
    }
    return {
      a,
      b,
      strength: "ambiguous",
      evidence: "mpn_and_brand",
      why: `Both state part ${a.mpn} and they name different brands, ${a.brandId} and ${b.brandId}. A part number means one thing within a maker's own range and nothing across two.`,
    };
  }

  if (normalise(a.name) === normalise(b.name) && normalise(a.name) !== "") {
    if (sameBrand(a, b)) {
      return {
        a,
        b,
        strength: "proposed",
        evidence: "brand_and_model",
        why: `Both are ${a.brandId} "${a.name}". The brand and the model agree exactly; no identifier confirms it, so a person decides.`,
      };
    }
    return {
      a,
      b,
      strength: "ambiguous",
      evidence: "brand_and_model",
      why: `Both are called "${a.name}" and they name different brands, ${a.brandId} and ${b.brandId}. Where a retailer sells under its own name, that is what a house brand looks like and not what a match looks like.`,
    };
  }
  return undefined;
}

const WEIGHT: Record<MatchStrength, number> = { confirmed: 3, proposed: 2, ambiguous: 1 };

/**
 * Every group of records that might be one product, across partners.
 *
 * Groups are built by joining pairs, so three records agreeing pairwise come
 * out as one group of three. A group's strength is the weakest evidence holding
 * it together: one ambiguous pair makes the whole group a question, because
 * applying it would merge that pair too.
 */
export function canonicalGroups(records: CanonicalRecord[]): CanonicalGroup[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const pair = pairOf(records[i], records[j]);
      if (pair) pairs.push(pair);
    }
  }

  // Join what agrees. A record in no pair is not a group: one record is not a
  // duplicate of anything.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    return root;
  };
  const union = (x: string, y: string) => parent.set(find(x), find(y));
  for (const p of pairs) union(p.a.id, p.b.id);

  const byRoot = new Map<string, CanonicalRecord[]>();
  const involved = new Set(pairs.flatMap((p) => [p.a.id, p.b.id]));
  for (const record of records) {
    if (!involved.has(record.id)) continue;
    const root = find(record.id);
    byRoot.set(root, [...(byRoot.get(root) ?? []), record]);
  }

  const groups: CanonicalGroup[] = [];
  for (const [root, members] of byRoot) {
    const inGroup = pairs.filter((p) => find(p.a.id) === root);
    const strength = inGroup.reduce<MatchStrength>((worst, p) => (WEIGHT[p.strength] < WEIGHT[worst] ? p.strength : worst), "confirmed");
    const evidence = [...new Set(inGroup.map((p) => p.evidence))].sort();
    groups.push({
      key: `canon-${[...members].map((m) => m.id).sort()[0]}`,
      members: [...members].sort((a, b) => a.id.localeCompare(b.id)),
      strength,
      evidence,
      why: inGroup.map((p) => p.why).join(" "),
    });
  }
  return groups.sort((a, b) => WEIGHT[b.strength] - WEIGHT[a.strength] || a.key.localeCompare(b.key));
}

export type CanonicalReview = {
  groups: CanonicalGroup[];
  confirmed: CanonicalGroup[];
  /** Everything a person has to decide before anything merges. */
  queued: CanonicalGroup[];
  /** Records in no group at all: one partner sells them and nobody else does. */
  unmatched: number;
};

export function reviewCanonical(records: CanonicalRecord[]): CanonicalReview {
  const groups = canonicalGroups(records);
  const grouped = new Set(groups.flatMap((g) => g.members.map((m) => m.id)));
  return {
    groups,
    confirmed: groups.filter((g) => g.strength === "confirmed"),
    queued: groups.filter((g) => g.strength !== "confirmed"),
    unmatched: records.filter((r) => !grouped.has(r.id)).length,
  };
}

export type MergeOptions = {
  /** Records the catalogue already holds. One of them is the primary, and its editorial work is never overwritten. */
  incumbentIds: Set<string>;
  /** Which partner each record came from, for the note. */
  sourceNames: Record<string, string>;
  on: string;
};

export type CanonicalMerge = {
  key: string;
  /** The record the merged product is built from. Its name, description, attributes and family stand. */
  primary: string;
  /** Every record folded in, and the offer each one contributed. */
  offersFrom: { id: string; merchantId: string; offerId: string }[];
  product: Product;
};

/**
 * One product, with one offer per retailer.
 *
 * The primary is the record this site already holds, if it holds one: that is
 * where editorial work lives, and a merge that rewrote a name somebody chose
 * with a name a new partner happens to use would undo exactly the work this
 * flow exists to protect. Failing an incumbent, it is the cheapest, which is
 * the same rule the rest of this pipeline uses to represent a group.
 *
 * Everything else contributes what only it has: its own offer, with its own
 * price, its own availability, its own link and its own affiliate state. No
 * value is averaged, no price is chosen as "the" price, and no image is
 * replaced: a merged product shows the primary's picture, which is the one
 * somebody has already looked at.
 */
export function mergeCanonical(group: CanonicalGroup, products: Map<string, Product>, opts: MergeOptions): CanonicalMerge | undefined {
  const members = group.members.map((m) => products.get(m.id)).filter((p): p is Product => p !== undefined);
  if (members.length < 2) return undefined;

  const incumbent = members.find((p) => opts.incumbentIds.has(p.id));
  const primary =
    incumbent ??
    [...members].sort((a, b) => (a.offers[0]?.priceMinor ?? Infinity) - (b.offers[0]?.priceMinor ?? Infinity) || a.id.localeCompare(b.id))[0];

  const seen = new Set(primary.offers.map((o) => o.id));
  const offers = [...primary.offers];
  const offersFrom = primary.offers.map((o) => ({ id: primary.id, merchantId: o.merchantId, offerId: o.id }));
  for (const member of members) {
    if (member.id === primary.id) continue;
    for (const offer of member.offers) {
      if (seen.has(offer.id)) continue;
      seen.add(offer.id);
      offers.push(offer);
      offersFrom.push({ id: member.id, merchantId: offer.merchantId, offerId: offer.id });
    }
  }

  const folded = members.filter((m) => m.id !== primary.id).map((m) => `${opts.sourceNames[m.id] ?? m.id} (${m.id})`);
  return {
    key: group.key,
    primary: primary.id,
    offersFrom,
    product: {
      ...primary,
      offers,
      lastUpdated: opts.on,
      source: {
        ...primary.source,
        note: [
          primary.source.note,
          `Merged on ${opts.on} with ${folded.join(", ")}, on ${group.evidence.join(" and ")}. ${group.why} This record's own name, description and specifications stand; the others contributed their offers and nothing else.`,
        ]
          .filter(Boolean)
          .join(" "),
      },
    },
  };
}
