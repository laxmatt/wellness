// What the shopper is told about how many products match is authored here,
// from the engine's own numbers.
//
// Two mechanisms, and they are not equal. Only the first is a guarantee.
//
// 1. `engineSummary` is written by this code from the count the deterministic
//    engine produced. It is returned on every reply as `matchSummary`, beside
//    the cards it describes, and it is true by construction. This is the
//    authoritative statement of what matched.
//
// 2. `screenModelClaims` is a heuristic backstop over the model's own prose. It
//    catches availability claims and product counts that disagree with the
//    engine and replaces the text when it finds one. It is pattern matching:
//    it will miss paraphrases nobody anticipated, and it must not be described
//    as enforcement. What makes a wrong number in the prose survivable is that
//    the authored summary sits next to it, not that this filter caught it.

export type MatchClaim = "none" | "some" | null;

// Phrases that assert an empty result. Each needs a subject as well as a
// negation, so "no caffeine" and "no more than $500" do not trip it.
const NONE_PATTERNS: RegExp[] = [
  /\bthere (?:are|is|were|was) (?:currently )?(?:no|none|not any)\b[^.?!]*\b(?:products?|options?|items?|models?|matches?|results?|panels?|tubs?|drinks?)\b/i,
  /\b(?:no|not any) (?:products?|options?|items?|models?|matches?|results?|panels?|tubs?|drinks?)\b[^.?!]*\b(?:listed|available|match|matching|meet|fit|under|below|within|in the (?:catalogue|catalog|list|range))\b/i,
  /\b(?:nothing|none)\b[^.?!]*\b(?:match(?:es)?|fits?|qualifies|available|listed|meets?|comes? in)\b/i,
  /\bnone of (?:the|these|them|our)\b[^.?!]*\b(?:match|fit|qualify|meet|are|come)\b/i,
  /\b(?:we |i )?(?:do not|don't|doesn't|does not) (?:have|carry|list|offer|stock|show)\b[^.?!]*\b(?:any|anything|products?|options?)\b/i,
  /\b(?:could not|couldn't|cannot|can't) find (?:any|anything|a )\b/i,
  /\bno (?:such|matching|qualifying) (?:products?|options?|items?)\b/i,
  /\b(?:unfortunately|sorry)[^.?!]*\b(?:nothing|none|no products?|no options?)\b/i,
  /\b(?:everything|all of them|all products?) (?:is|are) (?:above|over|outside)\b/i,
];

// Phrases that assert a non-empty result. Narrow: this direction only matters
// when the engine found nothing at all.
const SOME_PATTERNS: RegExp[] = [
  /\bhere (?:are|is)\b[^.?!]*\b(?:option|options|product|products|pick|picks|choice|choices|one|ones|match|matches)\b/i,
  /\b(?:these|the following|those)\b[^.?!]*\b(?:match|fit|qualify|meet)\b/i,
  /\b(?:i|we) (?:found|have|can offer)\b[^.?!]*\b(?:product|products|option|options|match|matches)\b/i,
  /\b(?:a few|several|some|plenty of|many)\b[^.?!]*\b(?:products?|options?|matches?)\b[^.?!]*\b(?:fit|match|qualify|meet|available|under|below)\b/i,
];

const WORD_NUMBERS: Record<string, number> = {
  no: 0,
  none: 0,
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

// Numbers the model presents as a count of products. "$700" and "660nm" are not
// counts and are excluded by requiring a product noun immediately after.
const COUNT_PATTERN =
  /(?<![$\d.])\b(\d{1,3}|no|none|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b[ ]+(?:of the [\d]+ )?(?:other )?(?:products?|options?|items?|models?|matches?|results?|panels?|tubs?|drinks?)\b/gi;

export function statedCounts(text: string): number[] {
  const found: number[] = [];
  for (const m of text.matchAll(COUNT_PATTERN)) {
    const token = m[1].toLowerCase();
    const n = /^\d+$/.test(token) ? Number(token) : WORD_NUMBERS[token];
    if (n !== undefined) found.push(n);
  }
  return found;
}

export function detectMatchClaim(text: string): MatchClaim {
  if (NONE_PATTERNS.some((r) => r.test(text))) return "none";
  if (SOME_PATTERNS.some((r) => r.test(text))) return "some";
  return null;
}

// Authored by this code from the engine's numbers. Always correct, because it
// is not derived from anything the model said.
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

// Kept as the older name for the sentence the screen substitutes.
export const engineSentence = engineSummary;

export type Screened = {
  text: string;
  replaced: boolean;
  reason: "availability" | "count" | null;
  claim: MatchClaim;
  statedCounts: number[];
};

/**
 * A heuristic backstop, not a guarantee. It replaces the model's prose when it
 * can see a contradiction with the engine: an availability claim pointing the
 * wrong way, or a stated product count that is not the engine's.
 *
 * `matchCount` and `total` come from the deterministic engine over every
 * product, never from the shortlist the model was shown.
 */
export function screenModelClaims(text: string, matchCount: number, total: number): Screened {
  const claim = detectMatchClaim(text);
  const counts = statedCounts(text);

  const availabilityWrong = (claim === "none" && matchCount > 0) || (claim === "some" && matchCount === 0);
  // A count is wrong when it is neither the number that matched nor the size of
  // the category, which the model may legitimately mention.
  const countWrong = counts.some((n) => n !== matchCount && n !== total);

  if (!availabilityWrong && !countWrong) return { text, replaced: false, reason: null, claim, statedCounts: counts };
  return {
    text: engineSummary(matchCount, total),
    replaced: true,
    reason: availabilityWrong ? "availability" : "count",
    claim,
    statedCounts: counts,
  };
}

// Older name, kept so existing callers and tests keep working.
export const reconcileMatchClaim = screenModelClaims;
