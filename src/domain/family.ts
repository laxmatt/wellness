/**
 * Which records a shopper is actually choosing between.
 *
 * A merchant's catalogue and a comparison are not the same list. Sweat
 * Kingdom sells The Sweat Cabin on one page and The Sweat Cabin in a blackout
 * finish on another; both are real pages with their own price, stock, pictures
 * and affiliate link, and both are kept. But a comparison table offering both
 * is asking somebody to decide between a product and its own paint, and the
 * question they came with was which cabin, not which colour.
 *
 * So a record may say it is a configuration of another record, and a
 * comparison groups on that. Two rules keep it honest.
 *
 * **It is always somebody's decision.** Nothing here reads a title, measures a
 * name against another name, or decides that two products look similar. The
 * relationship is a pair of record ids and a sentence, written by a person,
 * saved in a versioned mapping profile, and approved before it is used. A
 * heuristic that got this right nine times in ten would merge two different
 * saunas the tenth time and nobody would see it happen.
 *
 * **One level, and no record in two families.** A member's representative may
 * not itself be a member. That is what makes a chain impossible, and a cycle is
 * a chain that closes, so refusing chains refuses cycles without having to walk
 * a graph looking for one.
 */

import type { Product } from "./product";

export type Family = {
  /** The record the family is compared as. */
  representative: Product;
  /** Its configurations, in id order. Empty for a product nobody points at. */
  members: Product[];
};

export type FamilyIssue = { id: string; message: string };

/**
 * Every reason a set of records is not a valid set of families.
 *
 * Run over a whole catalogue rather than over one record, because all four
 * failures are about a pair: a representative that is not there, a record
 * pointing at itself, a record in two families, and a chain.
 */
export function familyIssues(products: Product[]): FamilyIssue[] {
  const issues: FamilyIssue[] = [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const claimed = new Map<string, string>();

  for (const product of products) {
    const family = product.family;
    if (!family) continue;
    if (family.of === product.id) {
      issues.push({ id: product.id, message: "This record says it is a configuration of itself." });
      continue;
    }
    const representative = byId.get(family.of);
    if (!representative) {
      issues.push({ id: product.id, message: `This record is a configuration of "${family.of}", and there is no such record.` });
      continue;
    }
    if (representative.family) {
      issues.push({
        id: product.id,
        message: `This record is a configuration of "${family.of}", which is itself a configuration of "${representative.family.of}". A family is one level deep: point this at "${representative.family.of}" instead, or decide that "${family.of}" is a model of its own.`,
      });
    }
    const already = claimed.get(product.id);
    if (already) issues.push({ id: product.id, message: `This record is already a configuration of "${already}".` });
    claimed.set(product.id, family.of);
  }
  return issues;
}

/**
 * The records to compare, each with the configurations it stands for.
 *
 * A member whose representative is not in the set given stands on its own
 * rather than disappearing. A comparison drawn from published records only will
 * hit that the day a representative is hidden and a configuration is not, and a
 * product vanishing from a category page is worse than one appearing unattached
 * to a family that is not on screen.
 */
export function groupIntoFamilies(products: Product[]): Family[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const members = new Map<string, Product[]>();
  const representatives: Product[] = [];

  for (const product of products) {
    const of = product.family?.of;
    if (of !== undefined && of !== product.id && byId.has(of)) {
      members.set(of, [...(members.get(of) ?? []), product]);
    } else {
      representatives.push(product);
    }
  }

  return representatives
    .map((representative) => ({
      representative,
      members: (members.get(representative.id) ?? []).sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.representative.id.localeCompare(b.representative.id));
}

/** How many products a shopper would be offered as distinct things. */
export const comparisonCount = (products: Product[]): number => groupIntoFamilies(products).length;
