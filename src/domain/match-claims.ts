// The site's own sentence about how many products matched, written from the
// engine's count.
//
// This file used to also screen the model's prose for contradictions. That
// machinery is gone: the model's prose is no longer displayed at all, so there
// is nothing to screen. See src/domain/reply-composer.ts. A filter over English
// was never a guarantee, and removing the thing it was guarding is a better
// answer than a longer pattern list.

/**
 * @param oneRelaxationIsEnough true when dropping a single constraint admits at
 * least one product. Undefined when the caller has not worked it out, and the
 * sentence then says nothing about how many would have to go.
 *
 * It used to promise "so one of them would have to be relaxed" whatever the
 * truth. With a chiller, a $5,000 budget and no plumbing, no single removal
 * admits anything, and the site told the shopper otherwise.
 */
export function engineSummary(matchCount: number, total: number, oneRelaxationIsEnough?: boolean): string {
  if (total === 0) return "There are no products in this category yet.";
  if (matchCount === 0) {
    const head = `No products match. This category has ${total} ${total === 1 ? "product" : "products"}, and none of them meet every constraint`;
    if (oneRelaxationIsEnough === true) return `${head}, so one of them would have to be relaxed.`;
    if (oneRelaxationIsEnough === false) return `${head}. Setting aside any single one of them still leaves nothing, so more than one would have to go.`;
    return `${head}.`;
  }
  if (matchCount === total) {
    return `All ${total} ${total === 1 ? "product" : "products"} in this category match.`;
  }
  return `${matchCount} of the ${total} products in this category ${matchCount === 1 ? "matches" : "match"}.`;
}
