// The private live test's expectations, and the function that checks a reply
// against one.
//
// This lives in `src/` rather than in the script so it can be tested without
// spending anything. It needed to be: the previous revision asserted money at
// the wrong boundary. The script reads the route's own proposal, which carries
// engine constraints in integer minor units, and it was comparing them against
// the dollar object the model sends. Every correct answer would have been
// scored a failure, and nothing caught it because the checker was only ever
// exercised by a paid run.

export type ExpectedConstraint = {
  key: string;
  // Operators any of which would be a correct reading of the sentence.
  ops: string[];
  // Money as the ENGINE holds it: integer minor units. The proposal this is
  // checked against has already been converted from the model's dollars by
  // src/domain/model-constraints.ts, so $700 is 70000 here.
  minorUnits?: number;
  // Non-money values.
  value?: number | string | boolean;
  atMost?: number;
  atLeast?: number;
};

export type ExpectedCase = {
  hard?: ExpectedConstraint[];
  soft?: { key: string; directions?: string[] }[];
  medicalIntent?: boolean;
  mustAskQuestion?: boolean;
  // The engine's own count for the proposed constraints.
  engine?: "someMatch" | "noneMatch";
  // Keys a careful person could justifiably read into the sentence. Neither
  // required nor counted as invented. Never used to excuse a wrong number, an
  // inverted operator or a missing budget.
  alsoReasonable?: string[];
};

// The shape the script sees: the route's reply, after conversion.
export type CheckableReply = {
  text: string;
  failure?: string;
  medicalRedirect: boolean;
  matchingIds: string[];
  proposals: {
    kind: string;
    hard?: { key: string; op: string; value?: unknown }[];
    soft?: { key: string; direction: string; value?: unknown; weight?: number }[];
    matchingIds?: string[];
    matchCount?: number;
  }[];
};

export function describeWant(w: ExpectedConstraint): string {
  if (w.minorUnits !== undefined) return `${w.minorUnits} minor units`;
  if (w.value !== undefined) return `exactly ${JSON.stringify(w.value)}`;
  if (w.atMost !== undefined) return `at most ${w.atMost}`;
  if (w.atLeast !== undefined) return `at least ${w.atLeast}`;
  return "any value";
}

export function valueFits(got: unknown, w: ExpectedConstraint): boolean {
  if (w.minorUnits !== undefined) return got === w.minorUnits;
  if (w.value !== undefined) return got === w.value;
  if (typeof got !== "number") return false;
  if (w.atMost !== undefined) return got <= w.atMost;
  if (w.atLeast !== undefined) return got >= w.atLeast;
  return true;
}

/** Every problem with one reply, in the order they are worth reading. */
export function checkReply(reply: CheckableReply, expect: ExpectedCase): string[] {
  const problems: string[] = [];

  if (reply.failure) return [`the reply could not be used (${reply.failure}); nothing was extracted`];

  const proposal = reply.proposals.find((p) => p.kind === "apply_preferences");
  const gotHard = proposal?.hard ?? [];
  const gotSoft = proposal?.soft ?? [];

  for (const want of expect.hard ?? []) {
    const found = gotHard.filter((h) => h.key === want.key);
    if (found.length === 0) {
      problems.push(`missing hard ${want.key}`);
      continue;
    }
    const right = found.filter((h) => want.ops.includes(h.op));
    if (right.length === 0) {
      problems.push(`hard ${want.key} used op ${found.map((h) => h.op).join("/")}, expected one of ${want.ops.join("/")}`);
      continue;
    }
    if (!right.some((h) => valueFits(h.value, want))) {
      problems.push(`hard ${want.key} value ${JSON.stringify(right[0].value)} does not fit ${describeWant(want)}`);
    }
  }

  for (const want of expect.soft ?? []) {
    const found = gotSoft.filter((sp) => sp.key === want.key);
    const alsoHard = gotHard.some((h) => h.key === want.key);
    if (found.length === 0 && !alsoHard) {
      problems.push(`missing soft ${want.key}`);
      continue;
    }
    if (want.directions && found.length > 0 && !found.some((sp) => want.directions!.includes(sp.direction))) {
      problems.push(`soft ${want.key} pointed ${found.map((sp) => sp.direction).join("/")}, expected ${want.directions.join("/")}`);
    }
  }

  if (expect.medicalIntent && !reply.medicalRedirect) problems.push("medical question was not declined");
  if (!expect.medicalIntent && reply.medicalRedirect) problems.push("declined a question that was not medical");
  if (expect.mustAskQuestion && !/\?/.test(reply.text)) problems.push("did not ask a clarifying question");

  if (expect.engine === "someMatch") {
    const count = proposal?.matchCount ?? reply.matchingIds.length;
    if (count === 0) problems.push("the engine matched nothing, but this sentence has matching products");
  }
  if (expect.engine === "noneMatch") {
    const count = proposal?.matchCount ?? reply.matchingIds.length;
    if (count > 0) problems.push(`the engine matched ${count}, but this sentence should match nothing`);
  }

  const allowed = new Set([
    ...(expect.hard ?? []).map((h) => h.key),
    ...(expect.soft ?? []).map((sp) => sp.key),
    ...(expect.alsoReasonable ?? []),
  ]);
  for (const k of [...gotHard.map((h) => h.key), ...gotSoft.map((sp) => sp.key)]) {
    if (!allowed.has(k)) problems.push(`invented constraint ${k}`);
  }

  return problems;
}
