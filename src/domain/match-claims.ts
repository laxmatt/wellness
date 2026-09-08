// What the shopper reads about how many products match must come from the
// engine that decided it.
//
// The model is instructed not to claim anything about products it cannot see,
// and instructions are not enforcement. A live run produced "There are no
// products listed under $500 in the catalogue" while the engine matched one,
// because the model was shown six of eight and answered for the set. The
// instruction reduces that; this rejects it.
//
// Deliberately asymmetric. A claim is only overridden when it contradicts the
// engine's count, so ordinary prose is left alone and the failure mode is a
// sentence that is merely plainer, never one that is wrong.

export type MatchClaim = "none" | "some" | null;

// Phrases that assert an empty result. Each requires a subject as well as a
// negation, so "no caffeine" and "no more than $500" do not trip it.
const NONE_PATTERNS: RegExp[] = [
  /\bthere (?:are|is) (?:currently )?no\b[^.?!]*\b(?:products?|options?|items?|models?|matches?|results?)\b/i,
  /\bno (?:products?|options?|items?|models?|matches?|results?)\b[^.?!]*\b(?:listed|available|match|matching|meet|fit|under|below|in the (?:catalogue|catalog|list))\b/i,
  /\b(?:nothing|none)\b[^.?!]*\b(?:match(?:es)?|fits?|qualifies|available|listed|meets?)\b/i,
  /\bnone of (?:the|these|them)\b[^.?!]*\b(?:match|fit|qualify|meet)\b/i,
  /\b(?:we |i )?(?:do not|don't|doesn't|does not) (?:have|carry|list|offer|stock) (?:any|anything)\b/i,
  /\bcould not find (?:any|anything)\b/i,
  /\bno (?:such|matching) (?:products?|options?|items?)\b/i,
];

// Phrases that assert a non-empty result. Kept narrow: this direction only
// matters when the engine found nothing at all.
const SOME_PATTERNS: RegExp[] = [
  /\bhere (?:are|is)\b[^.?!]*\b(?:option|options|product|products|pick|picks|choice|choices|one|ones)\b/i,
  /\b(?:these|the following)\b[^.?!]*\b(?:match|fit|qualify|meet)\b/i,
  /\b(?:i|we) found\b[^.?!]*\b(?:product|products|option|options|match|matches)\b/i,
];

export function detectMatchClaim(text: string): MatchClaim {
  if (NONE_PATTERNS.some((r) => r.test(text))) return "none";
  if (SOME_PATTERNS.some((r) => r.test(text))) return "some";
  return null;
}

// The engine's own sentence. Plain, countable, and true by construction.
export function engineSentence(matchCount: number, total: number): string {
  if (matchCount === 0) {
    return `Nothing in the catalogue matches that. There ${total === 1 ? "is" : "are"} ${total} ${total === 1 ? "product" : "products"} in this category, and none of them fit, so you may want to relax one of the constraints.`;
  }
  if (matchCount === total) {
    return `All ${total} products in this category match that.`;
  }
  return `${matchCount} of the ${total} products in this category ${matchCount === 1 ? "matches" : "match"} that. They are shown beside this reply.`;
}

export type Reconciled = { text: string; replaced: boolean; claim: MatchClaim };

// `matchCount` and `total` come from the deterministic engine over every
// product, never from the shortlist the model saw.
export function reconcileMatchClaim(text: string, matchCount: number, total: number): Reconciled {
  const claim = detectMatchClaim(text);
  const contradicts = (claim === "none" && matchCount > 0) || (claim === "some" && matchCount === 0);
  if (!contradicts) return { text, replaced: false, claim };
  return { text: engineSentence(matchCount, total), replaced: true, claim };
}
