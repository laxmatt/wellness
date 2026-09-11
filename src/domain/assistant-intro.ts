/**
 * What the assistant says before anybody has typed anything, and where that
 * depends on where it was opened from.
 *
 * The panel used to carry one hardcoded list of three examples: two about red
 * light panels and one about drinks. A shopper on the wellness drinks page
 * pressed "Not sure which wellness drinks suits you?" and was offered "A
 * full-body panel under $700" and "Something I can set up without an
 * electrician". Nothing was broken underneath, which is the problem: the
 * invitation described a different shop, and the first thing it showed was
 * evidence that it had not noticed which page it was on.
 *
 * Where it was opened from is passed in, not worked out. The panel is mounted
 * once per page and a URL is a weak thing to read intent from: the same panel
 * is reachable from a category invitation, a product page and a comparison, and
 * a launcher knows which of those it is.
 *
 * Every example is tied to the catalogue by the keys beside it. Those keys are
 * checked against the category definition by a test, so an example cannot go on
 * describing a filter this site stopped having.
 */

import type { CategoryDefinition } from "./category";

/** Where the shopper opened the assistant from. Stated by the control they pressed. */
export type AssistantEntry = { kind: "category"; categoryId: string } | { kind: "general" };

export type IntroExample = {
  text: string;
  /** Attribute or filter keys this example rests on. Checked against the category. */
  keys: string[];
};

export type AssistantIntro = {
  lead: string;
  examples: IntroExample[];
};

/**
 * Per category, in the vocabulary that category already uses.
 *
 * Hand-written, because a sentence assembled out of filter labels reads like an
 * invoice ("Zero sugar and Under $2"). Held to the catalogue by the keys, which
 * a test walks.
 */
const BY_CATEGORY: Record<string, IntroExample[]> = {
  "wellness-drinks": [
    { text: "Zero sugar and no caffeine", keys: ["sugar_g", "caffeine_mg"] },
    { text: "An energy drink under $2 a serving", keys: ["function", "price_per_serving_minor"] },
    { text: "Electrolytes with low sugar", keys: ["function", "sugar_g"] },
  ],
  "cold-plunge": [
    { text: "Under $2,000 with a chiller", keys: ["price", "chiller_included"] },
    { text: "Something I can set up without plumbing", keys: ["plumbing"] },
    { text: "An inflatable tub for outdoors", keys: ["tub_type", "placement"] },
  ],
  "red-light": [
    { text: "A full-body panel under $1,000", keys: ["coverage", "price"] },
    { text: "Something targeted, for face and joints", keys: ["coverage"] },
    { text: "Under $500 and hangs on a door", keys: ["price", "mounting"] },
  ],
};

/**
 * The broad entry: no category in front of the shopper, so the examples name
 * one. Each names exactly one section of this site, which is what makes them
 * answerable at all from a standing start.
 */
const GENERAL: IntroExample[] = [
  { text: "Red light panels under $500", keys: ["price"] },
  { text: "A cold plunge I can set up without plumbing", keys: ["plumbing"] },
  { text: "Wellness drinks with zero sugar", keys: ["sugar_g"] },
];

export const introExamplesFor = (categoryId: string): IntroExample[] | undefined => BY_CATEGORY[categoryId];

/**
 * The opening copy for an entry point.
 *
 * An entry naming a category this site does not have falls back to the broad
 * copy rather than to another category's. Showing the wrong shop is the defect
 * this exists to fix, and a bad id is not a reason to reintroduce it.
 */
export function introFor(entry: AssistantEntry, categories: CategoryDefinition[]): AssistantIntro {
  if (entry.kind === "category") {
    const cat = categories.find((c) => c.id === entry.categoryId);
    const examples = introExamplesFor(entry.categoryId);
    if (cat && examples) {
      return { lead: `Tell me what matters and I will narrow the ${cat.navLabel.toLowerCase()} on this page. For example:`, examples };
    }
  }
  const sections = categories.map((c) => c.navLabel.toLowerCase());
  const named = sections.length > 1 ? `${sections.slice(0, -1).join(", ")} and ${sections[sections.length - 1]}` : sections[0];
  return { lead: `Tell me what you need and I will narrow the list. This site compares ${named}. For example:`, examples: GENERAL };
}
