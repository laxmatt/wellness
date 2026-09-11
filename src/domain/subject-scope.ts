import type { CategoryDefinition } from "./category";

/**
 * Whether a typed message is about something this site holds.
 *
 * WHAT THIS IS NOT. This does not recognise arbitrary topics and nothing here
 * should ever be described as though it does. It answers three narrow
 * questions, each from a list somebody wrote down:
 *
 *   1. Does the message name one of this site's three categories? Decided from
 *      each category's own `name`, `navLabel`, `slug` and its hand-maintained
 *      `aliases`. That is the whole basis. A category the message names by a
 *      phrase nobody listed is not recognised.
 *   2. Does it name one of a SHORT, EXPLICIT list of product kinds this site
 *      does not stock? `ABSENT_SUBJECTS` below is that list, in full. It is
 *      four entries long. It is not a model of everything the site lacks.
 *   3. Neither? Then the answer is "none", and the caller falls back to the
 *      site's fixed statement of what it can compare, with the same links.
 *
 * The third case is the common one and it is the honest one. A shopper asking
 * about something nobody listed gets told what this site holds and is given
 * the links; they are never told the site understood them.
 *
 * The cost of a miss is one reply that offers the wrong link and changes
 * nothing on the page. The cost of a false positive is the same. Nothing here
 * applies a filter, moves a shopper, or spends anything: every route through
 * this file ends in text and an anchor the shopper may ignore.
 */

export type SubjectScope =
  // Nothing outside this category was named. The caller proceeds as before.
  | { kind: "in_scope" }
  // Exactly one other category was named and this one was not.
  | { kind: "other_category"; categoryIds: string[] }
  // More than one category was named, or another was named alongside this one.
  // The site asks rather than choosing.
  | { kind: "ambiguous"; categoryIds: string[] }
  // A listed subject this site has no catalogue for.
  | { kind: "absent_subject"; labels: string[] };

/**
 * Product kinds people ask for that this site has no catalogue for.
 *
 * Hand-written, and deliberately tiny. Each entry exists so the assistant can
 * say "this site has no X catalogue" instead of a generic non-answer. Adding an
 * entry is a claim about the catalogue, so only add one for something the site
 * genuinely does not carry.
 *
 * `label` is the noun the reply uses. It is rendered by the site, never echoed
 * from what the shopper typed.
 */
export const ABSENT_SUBJECTS: { label: string; terms: string[] }[] = [
  { label: "vitamins", terms: ["vitamin", "vitamins", "multivitamin", "multivitamins"] },
  { label: "saunas", terms: ["sauna", "saunas", "steam room", "steam rooms"] },
  { label: "massage guns", terms: ["massage gun", "massage guns", "percussion massager", "theragun"] },
  { label: "fitness trackers", terms: ["fitness tracker", "fitness trackers", "smartwatch", "smartwatches", "whoop", "oura ring"] },
];

// Words that turn a mention into a refusal. "I don't want a cold plunge" names
// cold plunges and asks for the opposite, and offering to move that shopper is
// worse than saying nothing.
const NEGATOR_WORDS = new Set(["no", "not", "never", "without", "dont", "doesnt", "didnt", "wont", "cant", "avoid", "skip", "hate", "except", "besides", "anything"]);
const NEGATOR_PHRASES = [
  ["instead", "of"],
  ["other", "than"],
  ["rather", "than"],
  ["already", "have"],
  ["already", "own"],
  ["not", "interested", "in"],
];
// How far back a negator reaches. "I do not want a large expensive cold plunge"
// puts three words between the two.
const NEGATION_WINDOW = 5;

/** Lowercased word tokens. Apostrophes close up so "don't" is one token. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * How far a typed word may sit from a listed one and still count as it.
 *
 * Scaled by length, because one edit in a five-letter word is a different thing
 * from one edit in a twelve-letter word. "vitimens" is two edits from
 * "vitamins"; "saUna" typed as "sona" is not, and should not match.
 * Short words get no tolerance at all: at four letters, distance 1 reaches
 * most of the language.
 */
function tolerance(len: number): number {
  if (len >= 8) return 2;
  if (len >= 5) return 1;
  return 0;
}

/**
 * The index of the first token that matches `term`, or -1.
 *
 * Multi-word terms match a contiguous run of tokens, exactly. Single-word terms
 * may also match a near miss, so an ordinary typo does not turn an answerable
 * question into a shrug.
 */
function findTerm(tokens: string[], term: string): number {
  const want = tokenize(term);
  if (want.length === 0) return -1;
  for (let i = 0; i + want.length <= tokens.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      if (tokens[i + k] !== want[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  if (want.length !== 1) return -1;
  const word = want[0];
  const slack = tolerance(word.length);
  if (slack === 0) return -1;
  for (let i = 0; i < tokens.length; i++) {
    // A length gap wider than the tolerance cannot be closed by edits within
    // it, and skipping those is what keeps "can" away from "caffeine".
    if (Math.abs(tokens[i].length - word.length) > slack) continue;
    if (levenshtein(tokens[i], word) <= slack) return i;
  }
  return -1;
}

function negatedAt(tokens: string[], at: number): boolean {
  const from = Math.max(0, at - NEGATION_WINDOW);
  for (let i = from; i < at; i++) {
    if (NEGATOR_WORDS.has(tokens[i])) return true;
    for (const phrase of NEGATOR_PHRASES) {
      if (phrase.every((w, k) => tokens[i + k] === w) && i + phrase.length <= at) return true;
    }
  }
  return false;
}

/**
 * True when `terms` appear and none of the appearances is negated.
 *
 * Not "any appearance is clean". A category is usually named by several of its
 * own phrases at once: "I do not want a big expensive cold plunge" contains
 * both "cold plunge" and "plunge", and the negator only sits close enough to
 * the first. Accepting the second turned a refusal into an invitation to move.
 */
function affirmed(tokens: string[], terms: string[]): boolean {
  let seen = false;
  for (const term of terms) {
    const at = findTerm(tokens, term);
    if (at < 0) continue;
    if (negatedAt(tokens, at)) return false;
    seen = true;
  }
  return seen;
}

/**
 * Categories the message names and rules out.
 *
 * Used where the site offers its sections as a way out of a dead end. Offering
 * "Go to Cold Plunges" to someone who has just written that they do not want a
 * cold plunge is tin-eared, and the refusal is already right there in the
 * sentence. It changes nothing else: a negated category was never going to be
 * proposed as a switch.
 */
export function negatedCategoryIds(text: string, all: CategoryDefinition[]): string[] {
  const tokens = tokenize(text);
  if (tokens.length === 0) return [];
  return all
    .filter((c) => categoryTerms(c).some((term) => {
      const at = findTerm(tokens, term);
      return at >= 0 && negatedAt(tokens, at);
    }))
    .map((c) => c.id);
}

/** The phrases that name a category, from the category's own definition. */
export function categoryTerms(cat: CategoryDefinition): string[] {
  return [cat.name, cat.navLabel, cat.slug.replace(/-/g, " "), ...cat.aliases];
}

/**
 * Every phrase this category already claims for itself, below the category
 * level: its matcher vocabulary, its filter and attribute labels, its facets.
 *
 * Used for one thing: suppressing the absent-subject answer when the category
 * in front of the shopper does list the word. The drinks catalogue lists
 * "vitamins" as a phrase for its greens filter, so a drinks shopper who types
 * it keeps the behaviour they had. A red-light shopper who types it is told
 * plainly that there is no vitamins catalogue, because nothing on that page
 * claims otherwise.
 */
function ownVocabulary(cat: CategoryDefinition): string[] {
  const out: string[] = [];
  for (const byValue of Object.values(cat.matcherVocabulary)) {
    for (const phrases of Object.values(byValue ?? {})) out.push(...phrases);
  }
  for (const f of cat.filters) out.push(f.label);
  for (const a of cat.attributeDefinitions) {
    out.push(a.label);
    if (a.shortLabel) out.push(a.shortLabel);
    for (const o of a.enumOptions ?? []) out.push(o.label);
  }
  for (const f of cat.facets) out.push(f.label);
  return out;
}

/**
 * What a message is about, relative to the category the shopper is looking at.
 *
 * Nothing here reads a filter, proposes one, or changes anything. The caller
 * turns the answer into a sentence and a link.
 */
export function resolveSubjectScope(text: string, current: CategoryDefinition, all: CategoryDefinition[]): SubjectScope {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { kind: "in_scope" };

  const named = all.filter((c) => affirmed(tokens, categoryTerms(c)));
  const others = named.filter((c) => c.id !== current.id);
  const self = named.some((c) => c.id === current.id);

  if (others.length === 1 && !self) return { kind: "other_category", categoryIds: [others[0].id] };
  if (others.length > 0) {
    // Self first, so the reply offers staying put before moving.
    const ids = [...(self ? [current.id] : []), ...others.map((c) => c.id)];
    return { kind: "ambiguous", categoryIds: ids };
  }

  if (!self) {
    const owned = ownVocabulary(current);
    const labels = ABSENT_SUBJECTS.filter((s) => affirmed(tokens, s.terms))
      // A word the category in front of the shopper already lists is not an
      // absent subject here, whatever this list says.
      .filter((s) => !s.terms.some((t) => findTerm(tokenize(owned.join(" ")), t) >= 0))
      .map((s) => s.label);
    if (labels.length > 0) return { kind: "absent_subject", labels };
  }

  return { kind: "in_scope" };
}
