/**
 * The four things an operator does to a staged record, and what each one needs
 * the record to be.
 *
 * Kept apart from the file handling because these are the rules, and a rule
 * that only exists inside a command-line script is a rule no test reaches.
 *
 * There is no new gate here. `ProductStatus` is the catalogue's own field and
 * every shopper read in `src/lib/queries.ts` already asks for published records
 * only, so approving is setting a field and hiding is setting it back.
 */

import type { ProductStatus } from "@/domain/product";

export type InventoryAction = "approve" | "hide" | "unhide";

const RULES: Record<InventoryAction, { from: ProductStatus[]; to: ProductStatus }> = {
  approve: { from: ["draft", "hidden"], to: "published" },
  hide: { from: ["published"], to: "hidden" },
  unhide: { from: ["hidden"], to: "published" },
};

export type Transition = { ok: true; to: ProductStatus } | { ok: false; error: string };

export function transition(current: ProductStatus, action: InventoryAction): Transition {
  const rule = RULES[action];
  if (rule.from.includes(current)) return { ok: true, to: rule.to };
  return {
    ok: false,
    error: `This record is ${current}. "${action}" works on a record that is ${rule.from.join(" or ")}.`,
  };
}

export const STATUS_WORDS: Record<ProductStatus, string> = {
  draft: "draft, not in the storefront",
  published: "published, in the storefront on this machine",
  hidden: "hidden, out of the storefront and still here",
  discontinued: "discontinued",
};
