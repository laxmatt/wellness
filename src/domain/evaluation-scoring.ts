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

export type SoftExpectation = {
  key: string;
  directions?: string[];
  // A list of alternatives is a legitimate target, and a one-element list is
  // the same preference as the bare value.
  // The target the preference names, when the sentence names one. A direction
  // alone is not enough: `prefer_value` on the wrong enum points the ranking at
  // the wrong products while looking correct.
  value?: number | string | boolean | string[];
};

export type CaseExpectation = {
  // Must be present as a hard constraint. A preference on the key does not do.
  requiredHard?: ExpectedConstraint[];
  // Must be present as a soft preference. A hard constraint on the key does
  // NOT do: a preference orders, a constraint excludes, and turning one into
  // the other changes what the shopper is shown.
  requiredSoft?: SoftExpectation[];
  // Satisfied by either form, because the sentence genuinely reads both ways.
  // "I don't want to deal with an electrician" is as fairly a requirement as a
  // preference, and a case that says so must not be scored as though it had
  // picked one.
  requiredEither?: { key: string; ops?: string[]; directions?: string[]; value?: number | string | boolean | string[] }[];
  // Keys that must not appear as hard constraints. A budget the shopper never
  // stated is the case this exists for: it silently narrows the search to
  // something they did not ask for.
  forbiddenHard?: { key: string; because: string }[];
  // Keys a careful person could justifiably read in. Neither required nor
  // counted against. Every other key IS counted against: an extra constraint
  // nobody asked for narrows the search, and a scorer that ignores extras
  // cannot tell a correct answer from a correct answer plus an invention.
  allowed?: string[];
  medicalIntent?: boolean;
  mustAskQuestion?: boolean;
  // For a sentence naming something this category cannot filter on. The right
  // answer is to say so, not to approximate it with a filter that means
  // something else.
  mustNameOrAsk?: { because: string };
};

export type Verdict = {
  problems: string[];
  // Named separately so a report can say which kind of thing went wrong.
  missingHard: string[];
  missingSoft: string[];
  wrongForm: string[];
  invented: string[];
  // Keys the case neither required nor allowed.
  extras: string[];
};

/**
 * Two values naming the same thing.
 *
 * A preference on a list key may arrive as `"outdoor"` or as `["outdoor"]`, and
 * they mean the same. Comparing with `===` called the second a miss. Order does
 * not matter for a set of alternatives; a longer or shorter list does.
 */
function sameTarget(got: unknown, want: unknown): boolean {
  const one = (v: unknown) => (Array.isArray(v) ? (v.length === 1 ? v[0] : v) : v);
  const a = one(got);
  const b = one(want);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    const rest = [...b];
    return a.every((x) => {
      const i = rest.findIndex((y) => y === x);
      if (i === -1) return false;
      rest.splice(i, 1);
      return true;
    });
  }
  return a === b;
}

/**
 * One case, judged.
 *
 * Every failure names the key and what was wanted, because a score without
 * that is not reviewable.
 */
export function scoreCase(reply: CheckableReply, expect: CaseExpectation): Verdict {
  const v: Verdict = { problems: [], missingHard: [], missingSoft: [], wrongForm: [], invented: [], extras: [] };

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
    // Direction and target, on the SAME entry. Checked apart, a reply carrying
    // `prefer_value indoor` and `prefer_low outdoor` satisfied an expectation
    // of `prefer_value outdoor`: one entry supplied the direction, the other
    // the value, and neither was what was asked for.
    const ok = found.filter(
      (s) =>
        (!want.directions || want.directions.includes(s.direction)) &&
        (want.value === undefined || sameTarget(s.value, want.value)),
    );
    if (ok.length === 0) {
      const shown = found.map((s) => `${s.direction}${s.value === undefined ? "" : ` ${JSON.stringify(s.value)}`}`).join(", ");
      const wanted = `${want.directions ? want.directions.join("/") : "any direction"}${want.value === undefined ? "" : ` ${JSON.stringify(want.value)}`}`;
      v.problems.push(`soft ${want.key} came back as ${shown}; expected one entry that is ${wanted}`);
    }
  }

  for (const want of expect.requiredEither ?? []) {
    const hard = gotHard.filter((h) => h.key === want.key);
    const soft = gotSoft.filter((s) => s.key === want.key);
    if (hard.length === 0 && soft.length === 0) {
      v.missingHard.push(want.key);
      v.problems.push(`missing ${want.key}, in either form`);
      continue;
    }
    // Either form will do, and whichever form it is, the operator or direction
    // and the target have to be on the same entry.
    const okHard = hard.filter(
      (h) => (!want.ops || want.ops.includes(h.op)) && (want.value === undefined || sameTarget(h.value, want.value)),
    );
    const okSoft = soft.filter(
      (s) => (!want.directions || want.directions.includes(s.direction)) && (want.value === undefined || sameTarget(s.value, want.value)),
    );
    if (okHard.length === 0 && okSoft.length === 0) {
      const shown = [
        ...hard.map((h) => `hard ${h.op}${h.value === undefined ? "" : ` ${JSON.stringify(h.value)}`}`),
        ...soft.map((s) => `soft ${s.direction}${s.value === undefined ? "" : ` ${JSON.stringify(s.value)}`}`),
      ].join(", ");
      v.problems.push(`${want.key} came back as ${shown}; no single entry matches what was expected`);
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

  // Anything the case did not ask for and did not allow. An extra constraint
  // is not a harmless flourish: it excludes products the shopper never ruled
  // out, and it is exactly what an invented budget looks like on a key the
  // case forgot to forbid.
  const named = new Set<string>([
    ...(expect.requiredHard ?? []).map((w) => w.key),
    ...(expect.requiredSoft ?? []).map((w) => w.key),
    ...(expect.requiredEither ?? []).map((w) => w.key),
    ...(expect.allowed ?? []),
    ...(expect.forbiddenHard ?? []).map((w) => w.key),
  ]);
  for (const c of [...gotHard, ...gotSoft]) {
    if (named.has(c.key) || v.extras.includes(c.key)) continue;
    v.extras.push(c.key);
    const where = gotHard.some((h) => h.key === c.key) ? "hard" : "soft";
    v.problems.push(`unexpected ${where} ${c.key}: the sentence did not ask for it and the case does not allow it`);
  }

  if (expect.mustNameOrAsk) {
    // Judged on what the shopper is shown, because that is what the route
    // returns: the composed reply counts unmapped phrases in a fixed sentence,
    // and a clarifying question is the other acceptable answer.
    // The panel renders `question` as its own card with clickable options, and
    // the composed sentence rarely carries a question mark, so looking for one
    // in the prose misses every question the site actually asks.
    const asked = (reply.question?.options.length ?? 0) > 0 || /\?/.test(reply.text);
    const said = /not something this site compares/i.test(reply.text) || /I have not filtered by/i.test(reply.text) || asked;
    if (!said) v.problems.push(`nothing was said about what could not be filtered: ${expect.mustNameOrAsk.because}`);
  }

  if (expect.medicalIntent && !reply.medicalRedirect) v.problems.push("medical question was not declined");
  if (!expect.medicalIntent && reply.medicalRedirect) v.problems.push("declined a question that was not medical");
  if (expect.mustAskQuestion && !((reply.question?.options.length ?? 0) > 0 || /\?/.test(reply.text))) {
    v.problems.push("did not ask a clarifying question");
  }

  return v;
}

// Re-exported so a caller judging money does not have to reach past this file.
export { admittedMaximum };
