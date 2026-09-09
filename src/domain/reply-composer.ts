import type { CategoryDefinition } from "./category";
import { engineSummary } from "./match-claims";
import { describeConstraint } from "./personalization/describe";
import type { HardConstraint, SoftPreference } from "./personalization";

// Every sentence a shopper reads is written here, from the catalogue and the
// engine's own result.
//
// The model's prose is not displayed at all. It was checked against the data
// for a while, and checking it was the wrong shape of answer: a filter over
// English can only ever catch the phrasings someone thought of, and the run of
// 20:57 produced a placeholder price quoted as fact, an unattributed figure
// stated as measured, and an explanation of what light does to tissue. None of
// those were caught by instructions and only some by patterns.
//
// So the model's job is now exactly one thing: turn a sentence into
// preferences. What those preferences matched, what the products cost, who
// says so, and what this site cannot answer are all rendered from approved
// data by the templates below.

// Shown when someone asks something the catalogue cannot answer. Fixed text,
// not a generated apology, so it cannot drift into an explanation. It ends in
// a question because a dead end is not an answer.
export const FIXED_LIMITATION =
  "I can only compare the products on this site using the specifications it holds: price, size, coverage, setup and the rest of the fields on each product page. I cannot explain what a product does for you, and this site does not publish claims about that. What would you like to narrow by instead?";

// The invitation, when nothing was understood and nothing was asked. Also a
// question, so a shopper is never left with a statement they cannot act on.
export const FIXED_INVITATION = "What matters most to you here?";

export type ComposedQuestion = { text: string; options: string[]; key?: string };

/**
 * A clarifying question built from the category's own filters.
 *
 * The model used to write both the question and its options. They were free
 * text on the way to the screen, which is the same exposure as its prose: a
 * question can carry a claim as easily as a sentence can. So the wording is
 * fixed here and the options are the category's own labels, which the catalogue
 * defines and this site already shows on its filter chips.
 */
export function clarifyingQuestion(cat: CategoryDefinition, constrainedKeys: string[]): ComposedQuestion | undefined {
  const taken = new Set(constrainedKeys);

  const price = cat.filters.find((f) => f.key === "price" && !taken.has("price"));
  if (price) {
    const options = (price.presets ?? []).map((p) => p.label).slice(0, 5);
    if (options.length > 0) return { text: "What is your budget?", options };
  }

  for (const f of cat.filters) {
    if (taken.has(f.key)) continue;
    const def = cat.attributeDefinitions.find((a) => a.key === f.key);
    const options = (def?.enumOptions ?? []).map((o) => o.label).slice(0, 5);
    if (options.length > 0) return { text: `Which ${(def?.shortLabel ?? f.label).toLowerCase()} suits you?`, options };
  }

  const remaining = cat.filters.filter((f) => !taken.has(f.key)).slice(0, 5);
  if (remaining.length === 0) return undefined;
  return { text: FIXED_INVITATION, options: remaining.map((f) => f.label) };
}

/**
 * The question to ask when the shopper named a value of a filter and nothing
 * was extracted for it.
 *
 * Same wording as `clarifyingQuestion`, and the options are the category's own
 * labels for values the catalogue actually holds. Nothing the shopper wrote is
 * echoed: the site asks about its own filter, in its own words.
 */
export function questionForKey(cat: CategoryDefinition, key: string, options: string[]): ComposedQuestion | undefined {
  if (options.length === 0) return undefined;
  const def = cat.attributeDefinitions.find((a) => a.key === key);
  const label = (def?.shortLabel ?? def?.label ?? cat.filters.find((f) => f.key === key)?.label ?? key).toLowerCase();
  return { text: `Which ${label} suits you?`, options: options.slice(0, 5), key };
}

export type ComposeInput = {
  cat: CategoryDefinition;
  hard: HardConstraint[];
  soft: SoftPreference[];
  unmapped: string[];
  matchCount: number;
  totalProducts: number;
  // True when the model proposed a change to the preferences.
  changed: boolean;
  clearing: boolean;
  // The shopper's own last message, used only to tell a question from a
  // statement. Never echoed back.
  lastUserText: string;
  // Filter keys the shopper named a value of that nothing was extracted for.
  // Said plainly rather than passed over: a reply that lists what was applied
  // and stays silent about what was not reads as though everything was.
  unaddressed?: string[];
  // Filter keys a typed answer might have meant to drop. Kept, and said out
  // loud, because the alternative is discarding a requirement on a guess.
  revoked?: string[];
};

// A question this site cannot answer from its own fields. Deliberately crude:
// it decides whether to offer the fixed limitation, and the cost of being
// wrong is a sentence inviting the shopper to say what matters to them.
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.endsWith("?")) return true;
  return /^\s*(what|which|how|why|when|where|who|is|are|does|do|can|could|should|will|would)\b/i.test(t);
}

function constraintList(cat: CategoryDefinition, hard: HardConstraint[]): string {
  return hard.map((c) => describeConstraint(cat, c)).join(", ");
}

function softList(cat: CategoryDefinition, soft: SoftPreference[]): string {
  return soft
    .map((p) => {
      const label = cat.attributeDefinitions.find((a) => a.key === p.key)?.shortLabel ?? p.key;
      if (p.direction === "prefer_low") return `lower ${label.toLowerCase()}`;
      if (p.direction === "prefer_high") return `higher ${label.toLowerCase()}`;
      return label.toLowerCase();
    })
    .join(", ");
}

/**
 * The reply text, composed. Nothing here can state a figure the catalogue does
 * not hold, because nothing here reads anything but the catalogue and the
 * engine's count.
 */
// One sentence per filter the shopper named and the site did not apply. The
// label is the category's own; the shopper's wording never appears.
function unaddressedSentences(cat: CategoryDefinition, keys: string[]): string[] {
  return keys.slice(0, 2).map((key) => {
    const def = cat.attributeDefinitions.find((a) => a.key === key);
    const label = (def?.shortLabel ?? def?.label ?? key).toLowerCase();
    return `I have not filtered by ${label}.`;
  });
}

export function composeReply(input: ComposeInput): string {
  const { cat, hard, soft, unmapped, matchCount, totalProducts, changed, clearing } = input;
  const parts: string[] = [];

  if (clearing) {
    parts.push("Clearing every filter.");
    parts.push(engineSummary(matchCount, totalProducts));
    return parts.join(" ");
  }

  if (changed && (hard.length > 0 || soft.length > 0)) {
    const hardText = hard.length > 0 ? `I have read that as ${constraintList(cat, hard)}.` : "";
    const softText = soft.length > 0 ? `Ranking for ${softList(cat, soft)}.` : "";
    if (hardText) parts.push(hardText);
    if (softText) parts.push(softText);
    parts.push(engineSummary(matchCount, totalProducts));
    // The count, never the words. `unmapped` is free text the model wrote, and
    // echoing it back puts an unvalidated sentence on the screen for the sake
    // of a phrase the shopper already typed.
    if (unmapped.length > 0) {
      parts.push(unmapped.length === 1 ? "One thing you mentioned is not something this site compares." : `${unmapped.length} things you mentioned are not something this site compares.`);
    }
    parts.push(...unaddressedSentences(cat, input.unaddressed ?? []));
    if ((input.revoked ?? []).length > 0) {
      const labels = (input.revoked ?? []).slice(0, 2).map((key) => {
        const def = cat.attributeDefinitions.find((a) => a.key === key);
        return (def?.shortLabel ?? def?.label ?? key).toLowerCase();
      });
      parts.push(
        labels.length === 1
          ? `I have kept your ${labels[0]} as it was. Did you want to drop it?`
          : `I have kept your ${labels.join(" and ")} as they were. Did you want to drop them?`,
      );
    }
    return parts.join(" ");
  }

  // Nothing was understood as a preference. If they asked a question, say what
  // this site can and cannot answer; otherwise invite the preference. Both end
  // in a question, because a shopper who has said nothing usable needs
  // somewhere to go next.
  if (looksLikeQuestion(input.lastUserText)) return FIXED_LIMITATION;

  parts.push(FIXED_INVITATION);
  parts.push(engineSummary(matchCount, totalProducts));
  return parts.join(" ");
}
