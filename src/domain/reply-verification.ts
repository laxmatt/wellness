import type { GroundedProduct } from "@/providers/ai/OpenAIProvider";

// Prose is checked against the approved data before a shopper reads it.
//
// The prompt has told the model since the beginning to use only catalogue
// figures and to attribute manufacturer claims. A live run showed it quoting a
// placeholder price as fact, stating a manufacturer's irradiance figure as
// measured, and answering a wavelength question out of general knowledge with
// language about tissue penetration and therapeutic effects. Instructions did
// not hold any of those lines.
//
// This does not judge whether a reply is true. It refuses two specific things
// that a shopping assistant on a wellness site must never do, both decidable
// from the approved data:
//
//   1. State a figure that is not in the data the reply was built from.
//   2. Explain what a product does to a body.
//
// When either fires, the prose is replaced by a limitation and the shopper is
// left with the facts the site renders itself. It fails towards saying less.

export type Verdict = { ok: true } | { ok: false; reason: "unapproved_figure" | "unsupported_claim"; detail: string };

// Words that turn a specification into a claim about an effect. Deliberately
// narrow: this is the category of sentence the site must not publish, not a
// general check on wording.
const CLAIM_PATTERNS: RegExp[] = [
  /\b(?:penetrat\w+|absorb\w+ into)\b/i,
  /\b(?:therapeutic|clinical(?:ly)?|efficacy|effective for|benefits? (?:of|for|include)|health benefits?)\b/i,
  /\b(?:helps? (?:with|to)|aids?|improves?|reduces?|relieves?|promotes?|boosts?|stimulates?|repairs?|regenerat\w+)\b/i,
  /\b(?:collagen|inflammation|circulation|recovery time|muscle repair|mitochondri\w+)\b/i,
  /\b(?:associated with|linked to|known (?:to|for))\b[^.?!]*\b(?:benefit|effect|result|improvement)\b/i,
];

// Numbers as they appear in prose. Ordinals and list markers are excluded by
// requiring the number to be more than a bare list index at the line start.
const NUMBER_PATTERN = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\w])/g;

function digitsOf(value: string): string {
  return value.replace(/[^\d.]/g, "").replace(/\.0+$/, "");
}

/**
 * Every figure a reply is allowed to state: the ones in the products it was
 * shown, plus the counts the site itself authored, plus the amounts the shopper
 * asked about.
 */
export function approvedFigures(products: GroundedProduct[], extra: (string | number)[] = []): Set<string> {
  const approved = new Set<string>();
  const add = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return;
    const d = digitsOf(String(v));
    if (d) for (const part of d.split(/[^\d.]+/)) if (part) approved.add(part.replace(/\.0+$/, ""));
  };
  for (const p of products) {
    add(p.price);
    for (const f of p.facts) {
      // A fact's value can carry several numbers, such as "660 nm, 850 nm".
      for (const m of String(f.value).matchAll(NUMBER_PATTERN)) add(m[1]);
    }
  }
  for (const e of extra) add(e);
  // Small integers are how anyone counts a list, and the site's own summary
  // states counts, so they are not treated as claims about product data.
  for (let i = 0; i <= 20; i++) approved.add(String(i));
  return approved;
}

export function verifyReply(text: string, approved: Set<string>): Verdict {
  for (const r of CLAIM_PATTERNS) {
    const m = r.exec(text);
    if (m) return { ok: false, reason: "unsupported_claim", detail: m[0] };
  }
  for (const m of text.matchAll(NUMBER_PATTERN)) {
    const raw = m[1].replace(/,/g, "");
    const normalised = raw.replace(/\.0+$/, "");
    if (!approved.has(normalised)) return { ok: false, reason: "unapproved_figure", detail: m[1] };
  }
  return { ok: true };
}

// What replaces prose that did not verify. It says what the site can do rather
// than pretending the question was answered.
export function limitationText(reason: "unapproved_figure" | "unsupported_claim"): string {
  if (reason === "unsupported_claim") {
    return "I can only compare these products on the specifications this site holds. What a product does to your body is not something I can answer, and this site does not publish claims about it.";
  }
  return "I can only quote figures this site holds for these products. The specifications and prices shown here come from the site's own records; anything not listed is not something I can state.";
}
