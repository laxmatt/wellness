/**
 * Reading a value out of text a partner wrote, with everything the person
 * approving it needs to see.
 *
 * This is the part of the flow that can invent a fact, so it is the part with
 * the most said about it. A pattern over a description will find something in
 * almost any prose; whether what it found is a specification of this product is
 * a judgement, and no amount of regular expression makes it not one.
 *
 * So four things come back with every extraction and all four are shown before
 * anything is written: the source text the pattern ran over, exactly what it
 * matched, how it matched, and whether a person has approved that rule. An
 * extraction whose rule is not approved is displayed and never written. That is
 * the whole mechanism; there is no confidence score that lets a high number
 * stand in for somebody looking.
 *
 * `confidence` is evidence, not a probability. A cell that is entirely the
 * value ("240V" in a voltage column) is a different kind of reading from a
 * number pulled out of a sentence, and the second is the one this project has
 * already decided not to trust: a sauna's capacity is not established by
 * finding "2-3 Person" in a marketing title.
 */

import type { AttributeDefinition, AttributePrimitive } from "@/domain/attributes";
import { normaliseAttribute } from "./normalize";
import { compilePattern, type AttributeRule } from "./profile";

/** How the text was found, which is as much as a pattern can tell anybody. */
export type Confidence =
  /** The pattern matched the whole cell. The cell is the value. */
  | "whole_cell"
  /** The pattern matched inside longer text. A reading out of prose. */
  | "in_prose";

export type ReviewState =
  /** A rule a person approved, with a value that normalised. Written. */
  | "approved"
  /** A value, and nobody has approved the rule that produced it. Shown, never written. */
  | "needs_approval"
  /** The pattern matched nothing in this cell. */
  | "no_match"
  /** It matched, and what it matched is not a value this attribute can hold. */
  | "refused";

export type Extraction = {
  key: string;
  column: string;
  /** What the pattern ran over, capped for display. The cap is stated when it bites. */
  sourceText: string;
  sourceTruncated: boolean;
  /** Exactly what the capture group took, before any translation. */
  matchedText?: string;
  value?: AttributePrimitive;
  confidence?: Confidence;
  reviewState: ReviewState;
  /** The rule, restated so a reviewer is not reading it from another screen. */
  pattern: string;
  approved: boolean;
  notes: string[];
};

const DISPLAY_CHARS = 400;

/**
 * A match at a stated position is a whole-cell match only when it covers the
 * trimmed cell exactly. "240V" matched in "240V" is the cell; "240V" matched in
 * "Runs on 240V, 30A" is a reading out of a sentence.
 */
function confidenceOf(cell: string, match: RegExpExecArray): Confidence {
  return match[0].trim() === cell.trim() ? "whole_cell" : "in_prose";
}

/**
 * Run one extraction rule against one cell.
 *
 * `def` is the category's own definition of the attribute, so the value is
 * checked against the thing it has to be rather than against the pattern's
 * idea of it. A pattern that captures "six" for an integer attribute produces a
 * refusal with the text in it, not a record with a hole where a number goes.
 */
export function applyExtraction(rule: Extract<AttributeRule, { from: "extract" }>, cell: string, def: AttributeDefinition): Extraction {
  const notes: string[] = [];
  const sourceTruncated = cell.length > DISPLAY_CHARS;
  const base: Extraction = {
    key: rule.key,
    column: rule.column,
    sourceText: sourceTruncated ? `${cell.slice(0, DISPLAY_CHARS)}…` : cell,
    sourceTruncated,
    reviewState: "no_match",
    pattern: rule.pattern,
    approved: rule.approved,
    notes,
  };

  const compiled = compilePattern(rule.pattern, rule.flags.replace(/g/g, ""));
  if (!compiled.ok) return { ...base, reviewState: "refused", notes: [compiled.reason] };
  if (cell.trim() === "") return { ...base, notes: ["This cell is empty. Nothing was read, which is not the same as a value of nothing."] };

  const match = compiled.regex.exec(cell);
  if (!match || match[1] === undefined) {
    return { ...base, notes: [`The pattern found nothing in this cell. The attribute stays unknown, which is what the file says about it.`] };
  }

  const matchedText = match[1];
  const confidence = confidenceOf(cell, match);
  if (confidence === "in_prose") {
    notes.push("Read out of longer text rather than from a field stating it. Prose is where a partner sells the product, so a figure found in it describes this product only if a person says it does.");
  }

  const normalised = normaliseAttribute(matchedText, def, rule.valueMap);
  if (normalised.ok === false) {
    return { ...base, matchedText, confidence, reviewState: "refused", notes: [...notes, normalised.reason] };
  }
  if (normalised.ok === "empty") {
    return { ...base, matchedText, confidence, reviewState: "refused", notes: [...notes, "The pattern captured nothing but whitespace."] };
  }
  if (normalised.note) notes.push(normalised.note);

  return {
    ...base,
    matchedText,
    value: normalised.value,
    confidence,
    reviewState: rule.approved ? "approved" : "needs_approval",
    notes: rule.approved
      ? notes
      : [...notes, "This rule is not approved, so this value is shown and not written. Approve the rule to write it, having read the source text above."],
  };
}

/** The sentence recorded on an extracted value, so the record says how it was got. */
export function extractionNote(e: Extraction): string {
  const how = e.confidence === "whole_cell" ? "which is the whole of that cell" : "found inside longer text in that cell";
  return `Extracted from "${e.column}" by the pattern ${JSON.stringify(e.pattern)}, ${how}. It matched ${JSON.stringify(e.matchedText ?? "")}. The rule was approved by a person before this value was written.`;
}
