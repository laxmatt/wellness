// The site's own sentence about how many products matched, written from the
// engine's count.
//
// This file used to also screen the model's prose for contradictions. That
// machinery is gone: the model's prose is no longer displayed at all, so there
// is nothing to screen. See src/domain/reply-composer.ts. A filter over English
// was never a guarantee, and removing the thing it was guarding is a better
// answer than a longer pattern list.

export function engineSummary(matchCount: number, total: number): string {
  if (total === 0) return "There are no products in this category yet.";
  if (matchCount === 0) {
    return `No products match. This category has ${total} ${total === 1 ? "product" : "products"}, and none of them meet every constraint, so one of them would have to be relaxed.`;
  }
  if (matchCount === total) {
    return `All ${total} ${total === 1 ? "product" : "products"} in this category match.`;
  }
  return `${matchCount} of the ${total} products in this category ${matchCount === 1 ? "matches" : "match"}.`;
}
