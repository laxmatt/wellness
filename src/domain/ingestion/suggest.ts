/**
 * A first mapping, from headings this project has written down.
 *
 * Every suggestion is an exact match against a list somebody typed. Nothing
 * here matches by resemblance: "title" is in the list and "prod_ttl" is not,
 * and a tool that guessed the second would be right often enough that nobody
 * would check it and wrong on the day it mattered.
 *
 * A suggestion is a draft of a decision. It is shown, it is editable, and it is
 * saved as a profile version only when a person saves it. Nothing suggested is
 * approved, and approval is what an import needs.
 */

import { normaliseHeader } from "@/domain/import/fields";
import type { CanonicalTarget, ColumnMapping, FieldOwnership, Grouping } from "./profile";

/**
 * Headings that name each field, most specific first.
 *
 * The order matters in two places. A feed carrying both `aw_deep_link` and
 * `link` carries the tracking link the network issued and the merchant's plain
 * page address, and the offer's link is the first of those: it is the one that
 * was issued. A Shopify snapshot carries both `variant_url` and `product_url`,
 * and the offer's link is the variant's, because that is the configuration a
 * shopper is being sent to.
 *
 * The Shopify names below were missing, and their absence is not a small thing.
 * A person uploading a real snapshot got a suggested mapping with no
 * description, no image and no stock, and every one of 737 records failed to
 * build on `columns.description` with nothing on screen to say which column it
 * should have been. A suggestion that quietly omits a required field is worse
 * than one that omits the file.
 */
const SYNONYMS: Record<CanonicalTarget, string[]> = {
  name: ["title", "name", "product name", "product title", "item name"],
  description: ["description", "product description", "long description", "details", "body text", "body html"],
  brand: ["brand", "manufacturer", "maker", "vendor", "brand name"],
  price: ["price", "sale price", "unit price", "current price", "cost"],
  availability: ["availability", "stock status", "stock", "in stock", "availability status", "available"],
  image: ["image link", "image", "image url", "main image", "primary image", "image src", "featured image"],
  link: ["aw deep link", "deep link", "tracking link", "affiliate link", "link", "url", "variant url", "product url"],
  merchant_sku: ["variant sku", "sku", "id", "merchant sku", "item id", "product id", "item code"],
  mpn: ["mpn", "manufacturer part number", "part number"],
};

/**
 * What each field is worth defending, before anybody has thought about it.
 *
 * Anything a person would write gets `review_on_change`, so a partner's
 * overnight edit is proposed rather than applied. Prices and stock are the
 * partner's to state and change often enough that queueing every move would
 * bury the queue, so those start as `feed`.
 */
const DEFAULT_OWNERSHIP: Record<CanonicalTarget, FieldOwnership> = {
  name: "review_on_change",
  description: "review_on_change",
  brand: "review_on_change",
  price: "feed",
  availability: "feed",
  image: "review_on_change",
  link: "feed",
  merchant_sku: "feed",
  mpn: "feed",
};

export type Suggestion = { columns: ColumnMapping[]; grouping: Grouping; unmapped: string[] };

export function suggestColumns(columns: string[]): Suggestion {
  const byNormalised = new Map(columns.map((c) => [normaliseHeader(c), c]));
  const taken = new Set<string>();
  const mappings: ColumnMapping[] = [];

  for (const [target, synonyms] of Object.entries(SYNONYMS) as [CanonicalTarget, string[]][]) {
    for (const synonym of synonyms) {
      const column = byNormalised.get(normaliseHeader(synonym));
      if (column !== undefined && !taken.has(column)) {
        mappings.push({ target, column, ownership: DEFAULT_OWNERSHIP[target] });
        taken.add(column);
        break;
      }
    }
  }

  // Group on the merchant's own product address where there is one: 225 rows
  // sharing 38 pages are 38 products, and the pages are the merchant's grouping
  // rather than one this invented. Failing that, on whatever identifies a line.
  // The product's page, not the variant's: a variant address is one
  // configuration of the same page and grouping on it would make every
  // configuration its own product. `url_path` drops the query either way, but
  // naming the product column says what the grouping means.
  const pageColumn = ["product url", "link", "url"].map((s) => byNormalised.get(normaliseHeader(s))).find((c) => c !== undefined);
  const skuColumn = mappings.find((m) => m.target === "merchant_sku")?.column;
  const grouping: Grouping = pageColumn
    ? { mode: "url_path", column: pageColumn, representative: "cheapest" }
    : { mode: "column", column: skuColumn ?? columns[0] ?? "", representative: "first" };

  return { columns: mappings, grouping, unmapped: columns.filter((c) => !taken.has(c) && c !== grouping.column) };
}
