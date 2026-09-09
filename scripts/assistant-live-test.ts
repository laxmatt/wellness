/**
 * Private live-model check. Never runs in CI, never exposed as a page.
 *
 *   npm run assistant:livetest
 *
 * Secrets are read from .env.local, so nothing sensitive is typed at a shell
 * prompt or left in shell history.
 *
 * It sends a fixed set of shopper sentences to the running app's assistant
 * endpoint and reports two things the deterministic tests cannot:
 *
 *   1. Whether the model extracted the constraints a person would have entered.
 *   2. What a conversation actually costs, read from the usage ledger rather
 *      than estimated.
 *
 * Nothing here proves the assistant is ready. It gives numbers to judge it by.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { checkReply, type CheckableReply, type ExpectedCase } from "../src/domain/livetest-expectations";
import { buildReport, reportStamp, type CaseRecord } from "../src/domain/livetest-report";

// The same file the app reads, parsed the same way: KEY=value, one per line,
// blank lines and # comments skipped, existing environment variables win.
// Avoids asking anyone to retype a secret into a terminal.
function loadEnvLocal(path = ".env.local") {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const BASE = process.env.ASSISTANT_TEST_BASE_URL ?? "http://localhost:3000";
const ADMIN_KEY = process.env.ADMIN_ACCESS_KEY ?? "";

type Case = { category: string; text: string; expect: ExpectedCase; note: string };

const CASES: Case[] = [
  // Red light. Prices are in integer cents, which is what the filter uses.
  {
    category: "red-light",
    text: "I need a full-body panel under $700 that won't take over my apartment.",
    expect: {
      hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 70000, orAtMost: 69999 }],
      soft: [{ key: "coverage" }, { key: "footprint", directions: ["prefer_low"] }],
      alsoReasonable: ["mounting"],
    },
    note: "budget plus two preferences",
  },
  {
    category: "red-light",
    text: "Something small for my face, cheap as possible",
    // "small" is a footprint preference and "cheap as possible" is a price
    // preference. Both are correct readings, so neither counts against it, but
    // coverage is still required: "for my face" is what the filters exist for.
    expect: { soft: [{ key: "coverage" }], alsoReasonable: ["footprint", "price"] },
    note: "vague budget, clear coverage",
  },
  { category: "red-light", text: "What's the difference between 660nm and 850nm?", expect: {}, note: "factual question, no constraints" },
  { category: "red-light", text: "I want the strongest one you have", expect: {}, note: "superlative with no budget" },
  { category: "red-light", text: "Will red light therapy heal my tendonitis?", expect: { medicalIntent: true }, note: "medical, must decline" },
  {
    category: "red-light",
    text: "under 500",
    // The engine matches at least one product under $500. A reply that says
    // otherwise is the failure this case exists to catch.
    expect: { hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 50000, orAtMost: 49999 }], engine: "someMatch" },
    note: "bare number, and the count must match the engine",
  },
  { category: "red-light", text: "I have no idea where to start", expect: { mustAskQuestion: true }, note: "must ask, not guess" },
  // Cold plunge
  {
    category: "cold-plunge",
    text: "A tub with a chiller for my garage, up to $5,000",
    expect: {
      hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 500000, orAtMost: 499999 }],
      soft: [{ key: "chiller_included" }, { key: "placement" }],
      alsoReasonable: ["tub_type"],
    },
    note: "boolean plus placement",
  },
  { category: "cold-plunge", text: "Something I can pack away when guests come", expect: { soft: [{ key: "tub_type" }] }, note: "implied portability" },
  { category: "cold-plunge", text: "I don't want to deal with an electrician", expect: { soft: [{ key: "plumbing" }] }, note: "implied setup constraint" },
  { category: "cold-plunge", text: "How cold do these actually get?", expect: {}, note: "factual, manufacturer-reported" },
  // Drinks
  {
    category: "wellness-drinks",
    text: "Zero sugar electrolytes under $2 a serving",
    // "Electrolytes" names the kind of product, so it is a requirement, not a
    // ranking nudge. The site's own rules say so in four places: the filter is
    // `kind: "list"`, and its chips intersect rather than reorder; the model's
    // FILTERS line tells it to use `includes`, a hard operator; the attribute
    // declares `preferenceDirection: "neutral"`, so there is no direction to
    // prefer along; and `function` is the scoring `segmentKey` and appears in
    // none of the scoring criteria, so it divides the catalogue rather than
    // ranking within it. A soft preference cannot deliver what was asked
    // either: it does not exclude, so an energy drink stays in the results.
    //
    // This expectation is stricter than the one it replaces, which accepted a
    // preference or a constraint. It does not make any recorded run pass.
    expect: {
      hard: [
        { key: "sugar_g", ops: ["lte", "eq", "lt"], atMost: 1 },
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
        { key: "function", ops: ["includes", "in", "eq"], value: "electrolytes" },
      ],
      alsoReasonable: ["format"],
    },
    note: "two hard constraints, both with real values",
  },
  {
    category: "wellness-drinks",
    text: "No caffeine, I drink it at night",
    // "neq 0" would be the opposite of what was asked, so the operator matters
    // more here than anywhere else in the set.
    expect: { hard: [{ key: "caffeine_mg", ops: ["lte", "eq", "lt"], atMost: 0 }] },
    note: "negation, and the operator must not invert it",
  },
  { category: "wellness-drinks", text: "Which one is healthiest?", expect: {}, note: "must not answer as a health claim" },
  { category: "wellness-drinks", text: "Something that tastes good", expect: {}, note: "must land in unmapped, not invented" },
];

type Reply = {
  mode: string;
  text: string;
  // Set when the model answered and nothing usable came back.
  failure?: string;
  // Written by the site's engine, not the model.
  matchSummary?: string;
  products: { productId: string; brand: string; name: string }[];
  matchingIds: string[];
  unconfirmedPrice: { productId: string }[];
  proposals: {
    kind: string;
    hard?: { key: string; op: string; value?: unknown }[];
    soft?: { key: string; direction: string; value?: unknown; weight?: number }[];
    matchingIds?: string[];
    matchCount?: number;
  }[];
  medicalRedirect: boolean;
  notice?: string;
};

type Usage = {
  spentUsd: number;
  uncertainUsd: number;
  store: string;
  credential: { mode: string; baseUrl?: string };
  uncertainCharges: { reservationId: string; reason: string; heldUsd: number }[];
};

async function usage(): Promise<Usage | null> {
  if (!ADMIN_KEY) return null;
  // Header only. The endpoint refuses a key passed in the query string.
  const res = await fetch(`${BASE}/api/admin/assistant-usage`, { headers: { "x-admin-key": ADMIN_KEY } });
  if (!res.ok) return null;
  const j = (await res.json()) as Usage & { ledger: { store: string } };
  return {
    spentUsd: j.spentUsd,
    uncertainUsd: j.uncertainUsd,
    store: j.ledger.store,
    credential: j.credential ?? { mode: "unknown" },
    uncertainCharges: j.uncertainCharges ?? [],
  };
}

async function main() {
  const before = await usage();
  if (!before) console.warn("! ADMIN_ACCESS_KEY not set, so cost cannot be measured. Accuracy only.\n");
  else console.log(`Ledger: ${before.store}. Month-to-date before this run: $${before.spentUsd.toFixed(4)}\n`);

  let pass = 0;
  const failures: string[] = [];
  // Kept for the written report. The container this runs in is disposable, so
  // the result has to end up in the repository to be worth anything later.
  const records: CaseRecord[] = [];

  for (const [i, c] of CASES.entries()) {
    const sessionId = `s_livetest_${Date.now()}_${i}`;
    const res = await fetch(`${BASE}/api/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, categoryId: c.category, messages: [{ role: "user", text: c.text }], hard: [], soft: [] }),
    });
    if (!res.ok) {
      // Recorded, not just counted. A case the application refused is a case
      // that was attempted, and a report that omits it says the run was
      // shorter than it was.
      failures.push(`${c.text} -> HTTP ${res.status}`);
      records.push({
        category: c.category,
        note: c.note,
        text: c.text,
        reply: `(no reply: the application returned HTTP ${res.status})`,
        problems: [`the application returned HTTP ${res.status}`],
        shown: 0,
      });
      console.log(`FAIL ${c.category} | ${c.note}  [HTTP ${res.status}]`);
      await sleep(400);
      continue;
    }
    const r = (await res.json()) as Reply;

    if (r.mode !== "live") {
      console.error(`\nAborting: the endpoint replied in "${r.mode}" mode, not "live".`);
      console.error(r.notice ?? "Check OPENAI_API_KEY and that the ledger is shared (DATABASE_URL).");
      // Whatever ran before this point was still paid for. Write it down
      // before leaving: an abort used to discard every record it had.
      writeReport({
        records,
        plannedCases: CASES.length,
        before,
        after: await usage(),
        stoppedEarly: { reason: `the endpoint replied in "${r.mode}" mode, not "live"` },
      });
      process.exit(2);
    }

    // An unreadable reply is its own failure, and a distinct one: the model was
    // called and charged for, and nothing came back to score.
    if (r.failure) {
      const line = `${c.category} | "${c.text}"\n       the reply could not be read (${r.failure}); nothing was extracted`;
      failures.push(line);
      records.push({ category: c.category, note: c.note, text: c.text, reply: r.text, problems: [`unreadable reply (${r.failure})`], shown: r.matchingIds.length });
      console.log(`FAIL ${c.category} | ${c.note}  [unreadable reply]`);
      await sleep(400);
      continue;
    }

    // The same function a non-paid test exercises against a real route
    // response, so the assertions cannot drift from what the route returns.
    const problems = checkReply(r as CheckableReply, c.expect);
    // Recorded for every case, passing or not. Dropping this on the pass path
    // once cost a run its report: the console had all fifteen results and the
    // committed file had one.
    records.push({ category: c.category, note: c.note, text: c.text, reply: r.text, problems, shown: r.matchingIds.length });
    if (problems.length === 0) {
      pass++;
      console.log(`ok   ${c.category} | ${c.note}`);
    } else {
      failures.push(`${c.category} | "${c.text}"\n       ${problems.join("; ")}\n       reply: ${r.text.slice(0, 140)}`);
      console.log(`FAIL ${c.category} | ${c.note}`);
    }
    // Checked after every request, not only at the end. A run that keeps going
    // after the first unmeasurable charge holds more budget with each one, and
    // the operator asked to be stopped at the first.
    if (before) {
      const now = await usage();
      if (now && now.uncertainUsd > before.uncertainUsd + 1e-9) {
        console.error(`\nStopping: a charge could not be measured. Held uncertain is now $${now.uncertainUsd.toFixed(4)}, was $${before.uncertainUsd.toFixed(4)}.`);
        console.error("Reconcile it against the provider's usage record before running again.");
        writeReport({ records, plannedCases: CASES.length, before, after: now, stoppedEarly: { reason: "a charge could not be measured" } });
        process.exit(3);
      }
    }

    await sleep(400);
  }

  const after = await usage();
  console.log(`\n${pass} of ${CASES.length} cases matched what a person would have entered.`);
  if (failures.length > 0) console.log(`\nFailures:\n  ${failures.join("\n  ")}`);

  if (before && after) {
    const spent = after.spentUsd - before.spentUsd;
    console.log(`\nMeasured spend for ${CASES.length} single-turn conversations: $${spent.toFixed(4)}`);
    console.log(`Observed cost per conversation: $${(spent / CASES.length).toFixed(5)}`);
    console.log("A real conversation runs several turns, so multiply by your expected turns per session before setting the cap.");

    const newlyUncertain = after.uncertainCharges.filter((u) => !before.uncertainCharges.some((b) => b.reservationId === u.reservationId));
    if (newlyUncertain.length > 0) {
      // These are calls that may have been charged but could not be measured.
      // They hold budget until an operator checks the provider's usage page.
      console.log(`\n${newlyUncertain.length} call(s) ended without a confirmed cost, holding $${after.uncertainUsd.toFixed(4)} against the cap:`);
      for (const u of newlyUncertain) console.log(`  ${u.reservationId}  $${u.heldUsd.toFixed(5)}  ${u.reason}`);
      console.log("Check the provider's usage record for this window, then POST {action:\"reconcile\",reservationId,actualUsd} to the admin endpoint.");
      console.log("Measured spend above excludes these, so treat it as a lower bound until they are reconciled.");
    }
  }

  const reportPath = writeReport({ records, plannedCases: CASES.length, before, after });
  console.log(`\nReport written to ${reportPath}. Commit it: the container this ran in is disposable.`);
  console.log("This measures extraction and cost. It does not measure whether the wording is good; read the replies above.");
  process.exit(failures.length === 0 ? 0 : 1);
}

// Written into the repository, not just printed, so the numbers survive the
// session that produced them. The text itself is built by
// src/domain/livetest-report.ts, which a non-paid test exercises.
function writeReport(args: {
  records: CaseRecord[];
  plannedCases: number;
  before: Usage | null;
  after: Usage | null;
  stoppedEarly?: { reason: string };
}): string {
  const dir = "docs/live-test-results";
  mkdirSync(dir, { recursive: true });
  const body = buildReport({ ...args, model: process.env.OPENAI_MODEL ?? "gpt-4o-mini" });
  const path = `${dir}/${reportStamp()}.md`;
  writeFileSync(path, body);
  writeFileSync(`${dir}/latest.md`, body);
  return path;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
