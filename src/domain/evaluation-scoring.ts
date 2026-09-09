import type { CheckableReply, ExpectedConstraint } from "./livetest-expectations";
import { admittedMaximum, describeWant, valueFits } from "./livetest-expectations";

// Scoring an evaluation case, with the four kinds of expectation named.
//
// `checkReply` was written for the 15-case suite and treats a hard constraint
// as satisfying a soft expectation. That is defensible when the question is
// "was the shopper's interest recorded at all", and wrong when the question is
// "did the site do what a careful person would have done". The run of 03:31
// showed the difference: "the cheapest one that still has a chiller" came back
// with a hard budget of $5,490, the exact price of the cheapest chiller tub,
// and passed, because a hard `price` satisfied an expected `price` preference.
//
// So an evaluation case says which it means, and says what must not appear.

export type CaseExpectation = {
  // Must be present as a hard constraint. A preference on the key does not do.
  requiredHard?: ExpectedConstraint[];
  // Must be present as a soft preference. A hard constraint on the key does
  // NOT do: a preference orders, a constraint excludes, and turning one into
  // the other changes what the shopper is shown.
  requiredSoft?: { key: string; directions?: string[] }[];
  // Keys that must not appear as hard constraints. A budget the shopper never
  // stated is the case this exists for: it silently narrows the search to
  // something they did not ask for.
  forbiddenHard?: { key: string; because: string }[];
  // Keys a careful person could justifiably read in. Neither required nor
  // counted against.
  allowed?: string[];
  medicalIntent?: boolean;
  mustAskQuestion?: boolean;
};

export type Verdict = {
  problems: string[];
  // Named separately so a report can say which kind of thing went wrong.
  missingHard: string[];
  missingSoft: string[];
  wrongForm: string[];
  invented: string[];
};

/**
 * One case, judged.
 *
 * Every failure names the key and what was wanted, because a score without
 * that is not reviewable.
 */
export function scoreCase(reply: CheckableReply, expect: CaseExpectation): Verdict {
  const v: Verdict = { problems: [], missingHard: [], missingSoft: [], wrongForm: [], invented: [] };

  if (reply.failure) {
    v.problems.push(`the reply could not be used (${reply.failure}); nothing was extracted`);
    return v;
  }

  const proposal = reply.proposals.find((p) => p.kind === "apply_preferences");
  const gotHard = proposal?.hard ?? [];
  const gotSoft = proposal?.soft ?? [];

  for (const want of expect.requiredHard ?? []) {
    const found = gotHard.filter((h) => h.key === want.key);
    if (found.length === 0) {
      // Said precisely: a preference on the key is a different answer, not a
      // near miss, and the report should be able to tell them apart.
      if (gotSoft.some((s) => s.key === want.key)) {
        v.wrongForm.push(`${want.key} came back as a preference; a constraint was required`);
        v.problems.push(`hard ${want.key} required, got a preference`);
      } else {
        v.missingHard.push(want.key);
        v.problems.push(`missing hard ${want.key}`);
      }
      continue;
    }
    const right = found.filter((h) => want.ops.includes(h.op));
    if (right.length === 0) {
      v.problems.push(`hard ${want.key} used op ${found.map((h) => h.op).join("/")}, expected one of ${want.ops.join("/")}`);
      continue;
    }
    if (!right.some((h) => valueFits(h.value, want, h.op))) {
      v.problems.push(`hard ${want.key} ${right.map((h) => `${h.op} ${JSON.stringify(h.value)}`).join(", ")} does not fit ${describeWant(want)}`);
    }
  }

  for (const want of expect.requiredSoft ?? []) {
    const found = gotSoft.filter((s) => s.key === want.key);
    if (found.length === 0) {
      if (gotHard.some((h) => h.key === want.key)) {
        v.wrongForm.push(`${want.key} came back as a constraint; a preference was required`);
        v.problems.push(`soft ${want.key} required, got a constraint`);
      } else {
        v.missingSoft.push(want.key);
        v.problems.push(`missing soft ${want.key}`);
      }
      continue;
    }
    if (want.directions && !found.some((s) => want.directions!.includes(s.direction))) {
      v.problems.push(`soft ${want.key} pointed ${found.map((s) => s.direction).join("/")}, expected ${want.directions.join("/")}`);
    }
  }

  for (const forbidden of expect.forbiddenHard ?? []) {
    const found = gotHard.filter((h) => h.key === forbidden.key);
    if (found.length > 0) {
      const shown = found.map((h) => `${h.op} ${JSON.stringify(h.value)}`).join(", ");
      v.invented.push(forbidden.key);
      v.problems.push(`invented hard ${forbidden.key} (${shown}): ${forbidden.because}`);
    }
  }

  if (expect.medicalIntent && !reply.medicalRedirect) v.problems.push("medical question was not declined");
  if (!expect.medicalIntent && reply.medicalRedirect) v.problems.push("declined a question that was not medical");
  if (expect.mustAskQuestion && !/\?/.test(reply.text)) v.problems.push("did not ask a clarifying question");

  return v;
}

// Re-exported so a caller judging money does not have to reach past this file.
export { admittedMaximum };
