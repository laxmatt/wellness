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
// not a generated apology, so it cannot drift into an explanation.
export const FIXED_LIMITATION =
  "I can only compare the products on this site using the specifications it holds: price, size, coverage, setup and the rest of the fields on each product page. I cannot explain what a product does for you, and this site does not publish claims about that. Tell me what matters to you and I will narrow the list.";

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
    if (unmapped.length > 0) parts.push(`This site does not compare ${unmapped.join(", ")}.`);
    return parts.join(" ");
  }

  // Nothing was understood as a preference. If they asked a question, say what
  // this site can and cannot answer; otherwise invite the preference.
  if (looksLikeQuestion(input.lastUserText)) return FIXED_LIMITATION;

  parts.push("Tell me what matters to you and I will narrow the list: a budget, a size, or how you want to use it.");
  parts.push(engineSummary(matchCount, totalProducts));
  return parts.join(" ");
}
