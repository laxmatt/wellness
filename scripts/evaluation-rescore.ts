/**
 * Re-scores a completed run from its own record, with no model call.
 *
 *   npm run assistant:rescore docs/live-test-results/2026-09-09T03-31.md
 *
 * The run of 03:31 was scored by `checkReply`, which accepts a hard constraint
 * where a preference was expected. That let an invented budget pass. This
 * replays the constraints that run actually produced, kept in its own report,
 * against expectations that say which form each requirement takes and which
 * keys must not appear at all.
 *
 * It appends. The original observations and the original score stay exactly as
 * they were written: a second reading of the same evidence is not a reason to
 * rewrite the first.
 */

import { appendFileSync, readFileSync } from "node:fs";
import { scoreCase, type CaseExpectation } from "../src/domain/evaluation-scoring";
import type { CheckableReply } from "../src/domain/livetest-expectations";

type Turn = { id: string; turn: number; text: string; hard: unknown[]; soft: unknown[]; matched: string[]; result: string };

// Parsed from the report the run wrote, so the constraints re-scored here are
// the ones the route actually returned.
function parseTurns(md: string): Turn[] {
  const turns: Turn[] = [];
  const blocks = md.split(/^### /m).slice(1);
  for (const b of blocks) {
    const head = b.split("\n")[0].trim();
    const m = head.match(/^(.+?) turn (\d+)/);
    if (!m) continue;
    const grab = (label: string) => b.match(new RegExp(`^\\| ${label} \\| (.*) \\|$`, "m"))?.[1] ?? "";
    const json = (label: string) => {
      const raw = grab(label).replace(/^`|`$/g, "");
      try {
        return JSON.parse(raw) as unknown[];
      } catch {
        return [];
      }
    };
    const matched = grab("matched");
    turns.push({
      id: m[1],
      turn: Number(m[2]),
      text: (b.match(/^> (.*)$/m)?.[1] ?? "").trim(),
      hard: json("hard"),
      soft: json("soft"),
      matched: matched === "none" ? [] : [...matched.matchAll(/`([^`]+)`/g)].map((x) => x[1]),
      result: grab("result"),
    });
  }
  return turns;
}

// The same requirements as the plan, restated in the four kinds. Nothing is
// loosened: every case keeps what it asked for and says which form it wanted.
const EXPECT: Record<string, CaseExpectation> = {
  "R1/M2 1": {
    requiredHard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 69999 }],
    requiredSoft: [{ key: "coverage" }, { key: "footprint" }],
    allowed: ["mounting"],
  },
  // R1 and R3 named preferences and were scored by a checker that accepted a
  // constraint. The form they came back in differs from the plan's wording,
  // and the scoring in force on the day allowed it. Flagged below as a
  // stricter future expectation, not as a defect established on the day.
  "R2 1": {
    requiredHard: [
      { key: "price", ops: ["lte", "lt"], admitsAtMost: 120000 },
      { key: "mounting", ops: ["includes", "in"], value: "door_hang" },
    ],
  },
  "R3 1": {
    requiredSoft: [{ key: "coverage" }],
    allowed: ["footprint"],
    // "Something small for my face" states no budget.
    forbiddenHard: [{ key: "price", because: "the shopper stated no budget" }],
  },
  "R4 1": { medicalIntent: true },
  "C1/X1 1": {
    requiredHard: [
      { key: "price", ops: ["lte", "lt"], admitsAtMost: 500000 },
      { key: "chiller_included", ops: ["eq"], value: true },
    ],
  },
  "C1/X1 2": {
    requiredHard: [
      { key: "price", ops: ["lte", "lt"], admitsAtMost: 1000000 },
      { key: "chiller_included", ops: ["eq"], value: true },
    ],
  },
  // The frozen plan said "hard or soft `plumbing` at `none`", in those words.
  // Re-scoring it as a preference would invent a rule after the fact and call
  // a permitted answer a defect. "I don't want to deal with an electrician"
  // reads as a requirement at least as fairly as a preference.
  "C2 1": {
    requiredEither: [{ key: "plumbing", ops: ["eq", "lte", "lt"], directions: ["prefer_low", "prefer_value"] }],
    allowed: ["tub_type", "placement"],
  },
  "C3 1": {
    requiredSoft: [{ key: "tub_type" }],
    allowed: ["placement"],
  },
  "C4 1": {
    requiredHard: [{ key: "chiller_included", ops: ["eq"], value: true }],
    requiredSoft: [{ key: "price", directions: ["prefer_low"] }],
    // The sentence names no amount. A budget here is one the site invented.
    forbiddenHard: [{ key: "price", because: "the shopper asked for the cheapest, not for a price limit" }],
  },
  "D1 1": { requiredHard: [{ key: "caffeine_mg", ops: ["eq", "lte", "lt"], atMost: 0 }] },
  "D2/M1 1": {
    requiredHard: [
      { key: "function", ops: ["includes", "in"], value: "greens" },
      { key: "subscription_available", ops: ["eq"], value: true },
    ],
  },
  "D3 1": { medicalIntent: false },
  "D4 1": {
    requiredHard: [
      { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 159 },
      { key: "format", ops: ["neq"], value: "rtd_can" },
    ],
  },
};
for (const i of [1, 2, 3]) {
  EXPECT[`REP${i} 1`] = {
    requiredHard: [
      { key: "sugar_g", ops: ["lte", "eq", "lt"], atMost: 1 },
      { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
      { key: "function", ops: ["includes", "in"], value: "electrolytes" },
    ],
    allowed: ["format"],
  };
}

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run assistant:rescore <report.md>");
  process.exit(2);
}
const md = readFileSync(path, "utf8");
const turns = parseTurns(md);

const rows: string[] = [];
let passed = 0;
for (const t of turns) {
  const key = `${t.id} ${t.turn}`;
  const expect = EXPECT[key];
  if (!expect) {
    rows.push(`| ${key} | — | no expectation restated |`);
    continue;
  }
  // Reconstructed from the run's own record. The report keeps the constraints
  // and the products; it does not keep the question object, so a case that
  // turns on whether the site asked is not re-scored here.
  const reply = {
    text: "",
    medicalRedirect: t.id === "R4",
    matchingIds: t.matched,
    proposals: [{ kind: "apply_preferences", hard: t.hard as never, soft: t.soft as never }],
  } as CheckableReply;
  const v = scoreCase(reply, expect);
  if (v.problems.length === 0) passed++;
  // Only R1 and R3 are affected: the plan named a preference, the scoring in
  // force accepted a constraint, and the difference is a choice being made now
  // rather than a defect the run established.
  const stricterNow = ["R1/M2 1", "R3 1"].includes(key) && v.wrongForm.length > 0 && v.problems.length === v.wrongForm.length;
  const shown = v.problems.length === 0 ? "ok" : `${v.problems.join("; ")}${stricterNow ? " — **stricter expectation chosen now**, permitted by the scoring in force on the day" : ""}`;
  rows.push(`| ${key} | ${shown} | ${t.result === "ok" ? "ok" : "failed"} |`);
  console.log(`${v.problems.length === 0 ? "ok  " : "FAIL"} ${key}  ${v.problems.join("; ")}`);
}

const body = [
  "",
  "## Re-scored, from this run's own record",
  "",
  "Appended later, without a model call. The constraints below are the ones",
  "this run produced, read back from the table above, and re-judged against",
  "expectations that name which form each requirement takes and which keys must",
  "not appear at all.",
  "",
  "**The original score and every original observation above stand unchanged.**",
  "The scorer has been corrected twice since this run, and re-scoring an old",
  "record with a newer scorer is a second reading, never a replacement: the",
  "figures the run reported on the day are what it reported.",
  "A second reading of the same evidence is not a reason to rewrite the first,",
  "and the difference between the two readings is the point.",
  "",
  "Two kinds of difference appear below and they are not the same thing.",
  "C4 and D4 are defects in what was observed: an invented budget and a decimal",
  "off by a hundred, both wrong under the plan as it was frozen. R1 and R3 are",
  "a **stricter expectation chosen now**: the plan named preferences, the",
  "scoring in force accepted constraints, and calling that a failure of the run",
  "would be inventing a rule after the fact. C2 is neither. Its frozen",
  "expectation said \"hard or soft plumbing\" in those words, so the constraint",
  "it returned was permitted and stays permitted here.",
  "",
  `Re-scored: **${passed} of ${turns.filter((t) => EXPECT[`${t.id} ${t.turn}`]).length} turns pass**, against 11 of 16 on the day.`,
  "",
  "| Turn | Re-scored | Scored on the day |",
  "| --- | --- | --- |",
  ...rows,
  "",
].join("\n");

appendFileSync(path, body);
console.log(`\nAppended to ${path}.`);
