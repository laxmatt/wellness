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

// A key on its own is far too weak. `price gte 5000000` and `price lte 50000`
// both "contain price", and a run that only compared key names scored the first
// as a pass for "under $500". So each expectation names the operator and the
// direction of the value, and the resulting product set is checked against the
// site's own engine.
type ExpectedConstraint = {
  key: string;
  // Operators any of which would be a correct reading of the sentence.
  ops: string[];
  // Money is checked in dollars, as the model now sends it. The engine's cents
  // are code's business, not the model's.
  dollars?: number;
  // Non-money values.
  value?: number | string | boolean;
  atMost?: number;
  atLeast?: number;
};

type Expected = {
  hard?: ExpectedConstraint[];
  soft?: { key: string; directions?: string[] }[];
  medicalIntent?: boolean;
  mustAskQuestion?: boolean;
  // The engine's own count for the proposed constraints. "someMatch" means the
  // reply must not be able to claim emptiness; "noneMatch" the opposite.
  engine?: "someMatch" | "noneMatch";
  // Keys a careful person could justifiably read into the sentence without
  // being wrong. They are neither required nor counted as invented.
  //
  // This is not a way to make failures go away. It exists because "cheap as
  // possible" really does imply a price preference and "small" really does
  // imply footprint, and scoring those as inventions measured the test's
  // imagination rather than the model's accuracy. Every hard budget, every
  // negation and every factual case below stays strict: nothing that could
  // hide a wrong number or an inverted operator is listed here.
  alsoReasonable?: string[];
};

type Case = { category: string; text: string; expect: Expected; note: string };

const CASES: Case[] = [
  // Red light. Prices are in integer cents, which is what the filter uses.
  {
    category: "red-light",
    text: "I need a full-body panel under $700 that won't take over my apartment.",
    expect: {
      hard: [{ key: "price", ops: ["lt", "lte"], dollars: 700 }],
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
    expect: { hard: [{ key: "price", ops: ["lt", "lte"], dollars: 500 }], engine: "someMatch" },
    note: "bare number, and the count must match the engine",
  },
  { category: "red-light", text: "I have no idea where to start", expect: { mustAskQuestion: true }, note: "must ask, not guess" },
  // Cold plunge
  {
    category: "cold-plunge",
    text: "A tub with a chiller for my garage, up to $5,000",
    expect: {
      hard: [{ key: "price", ops: ["lt", "lte"], dollars: 5000 }],
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
    expect: {
      hard: [
        { key: "sugar_g", ops: ["lte", "eq", "lt"], atMost: 1 },
        { key: "price_per_serving_minor", ops: ["lt", "lte"], dollars: 2 },
      ],
      soft: [{ key: "function" }],
      alsoReasonable: ["format", "electrolytes_mg"],
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

function describeWant(w: ExpectedConstraint): string {
  if (w.dollars !== undefined) return `$${w.dollars}, sent as {"amount": ${w.dollars}, "currency": "USD"}`;
  if (w.value !== undefined) return `exactly ${JSON.stringify(w.value)}`;
  if (w.atMost !== undefined) return `at most ${w.atMost}`;
  if (w.atLeast !== undefined) return `at least ${w.atLeast}`;
  return "any value";
}

function valueFits(got: unknown, w: ExpectedConstraint): boolean {
  if (w.dollars !== undefined) {
    // The money contract: an object in whole dollars. A bare number is the
    // defect this test exists to catch, so it fails here rather than being
    // interpreted.
    if (typeof got !== "object" || got === null) return false;
    const m = got as { amount?: unknown; currency?: unknown };
    return m.currency === "USD" && typeof m.amount === "number" && Math.abs(m.amount - w.dollars) < 1e-9;
  }
  if (w.value !== undefined) return got === w.value;
  if (typeof got !== "number") return false;
  if (w.atMost !== undefined) return got <= w.atMost;
  if (w.atLeast !== undefined) return got >= w.atLeast;
  return true;
}

async function main() {
  const before = await usage();
  if (!before) console.warn("! ADMIN_ACCESS_KEY not set, so cost cannot be measured. Accuracy only.\n");
  else console.log(`Ledger: ${before.store}. Month-to-date before this run: $${before.spentUsd.toFixed(4)}\n`);

  let pass = 0;
  const failures: string[] = [];
  // Kept for the written report. The container this runs in is disposable, so
  // the result has to end up in the repository to be worth anything later.
  const records: { category: string; note: string; text: string; reply: string; problems: string[]; shown: number }[] = [];

  for (const [i, c] of CASES.entries()) {
    const sessionId = `s_livetest_${Date.now()}_${i}`;
    const res = await fetch(`${BASE}/api/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, categoryId: c.category, messages: [{ role: "user", text: c.text }], hard: [], soft: [] }),
    });
    if (!res.ok) {
      failures.push(`${c.text} -> HTTP ${res.status}`);
      continue;
    }
    const r = (await res.json()) as Reply;

    if (r.mode !== "live") {
      console.error(`\nAborting: the endpoint replied in "${r.mode}" mode, not "live".`);
      console.error(r.notice ?? "Check OPENAI_API_KEY and that the ledger is shared (DATABASE_URL).");
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

    const proposal = r.proposals.find((p) => p.kind === "apply_preferences");
    const gotHard = proposal?.hard ?? [];
    const gotSoft = proposal?.soft ?? [];
    const problems: string[] = [];

    // Each expected constraint must be present with an operator that reads the
    // sentence correctly and a value in the right place. A matching key with
    // the wrong operator is a wrong answer, not a partial one.
    for (const want of c.expect.hard ?? []) {
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
      const valued = right.filter((h) => valueFits(h.value, want));
      if (valued.length === 0) {
        problems.push(`hard ${want.key} value ${JSON.stringify(right[0].value)} does not fit ${describeWant(want)}`);
      }
    }

    for (const want of c.expect.soft ?? []) {
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

    if (c.expect.medicalIntent && !r.medicalRedirect) problems.push("medical question was not declined");
    if (!c.expect.medicalIntent && r.medicalRedirect) problems.push("declined a question that was not medical");
    if (c.expect.mustAskQuestion && !/\?/.test(r.text)) problems.push("did not ask a clarifying question");

    // The engine decides what matches. The reply must not contradict it.
    if (c.expect.engine === "someMatch") {
      const count = proposal?.matchCount ?? r.matchingIds.length;
      if (count === 0) problems.push("the engine matched nothing, but this sentence has matching products");
      if (/\bno (?:products?|options?|matches)\b/i.test(r.text) && count > 0) {
        problems.push(`reply claims nothing matches while the engine matched ${count}`);
      }
    }

    // Invented constraints are worse than missing ones: they silently filter.
    const allowed = new Set([
      ...(c.expect.hard ?? []).map((h) => h.key),
      ...(c.expect.soft ?? []).map((sp) => sp.key),
      ...(c.expect.alsoReasonable ?? []),
    ]);
    for (const k of [...gotHard.map((h) => h.key), ...gotSoft.map((sp) => sp.key)]) {
      if (!allowed.has(k)) problems.push(`invented constraint ${k}`);
    }

    // The three surfaces must agree, whatever the model said.
    if (proposal && proposal.matchCount !== (proposal.matchingIds ?? []).length) problems.push("proposal count disagrees with its own set");
    if (!proposal && r.products.some((p) => !r.matchingIds.includes(p.productId))) problems.push("a card is not in the matching set");
    if (r.unconfirmedPrice.some((p) => r.matchingIds.includes(p.productId))) problems.push("a product is both matching and unconfirmed");

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
        writeReport({ pass, records, before, after: now });
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

  const reportPath = writeReport({ pass, records, before, after });
  console.log(`\nReport written to ${reportPath}. Commit it: the container this ran in is disposable.`);
  console.log("This measures extraction and cost. It does not measure whether the wording is good; read the replies above.");
  process.exit(failures.length === 0 ? 0 : 1);
}

// Written into the repository, not just printed, so the numbers survive the
// session that produced them.
function writeReport(args: {
  pass: number;
  records: { category: string; note: string; text: string; reply: string; problems: string[]; shown: number }[];
  before: Usage | null;
  after: Usage | null;
}): string {
  const { pass, records, before, after } = args;
  const stamp = new Date().toISOString().replace(/:/g, "-").slice(0, 16);
  const dir = "docs/live-test-results";
  mkdirSync(dir, { recursive: true });

  const spent = before && after ? after.spentUsd - before.spentUsd : null;
  const newlyUncertain = before && after ? after.uncertainCharges.filter((u) => !before.uncertainCharges.some((b) => b.reservationId === u.reservationId)) : [];

  const lines: string[] = [
    `# Live assistant test, ${new Date().toISOString()}`,
    "",
    `Model: \`${process.env.OPENAI_MODEL ?? "gpt-4o-mini"}\`. Credential mode: \`${after?.credential.mode ?? "unknown"}\`. Ledger: \`${after?.store ?? "unknown"}\`.`,
    "",
    "## Extraction",
    "",
    `${pass} of ${records.length} cases matched the constraints a careful person would have entered.`,
    "",
    "| Category | Case | Result | Products shown |",
    "| --- | --- | --- | --- |",
    ...records.map((r) => `| ${r.category} | ${r.note} | ${r.problems.length === 0 ? "ok" : r.problems.join("; ")} | ${r.shown} |`),
    "",
    "## Cost",
    "",
    spent === null
      ? "Not measured: no admin key was available to read the ledger."
      : [
          `Measured spend for ${records.length} single-turn conversations: **$${spent.toFixed(4)}**.`,
          "",
          `Observed cost per conversation: **$${(spent / records.length).toFixed(5)}**.`,
          "",
          "A real conversation runs several turns. Multiply by expected turns per session before setting the cap.",
        ].join("\n"),
    "",
  ];

  if (newlyUncertain.length > 0) {
    lines.push(
      "## Unconfirmed charges",
      "",
      `${newlyUncertain.length} call(s) ended without a confirmed cost, holding $${(after?.uncertainUsd ?? 0).toFixed(4)} against the cap. The measured spend above is a lower bound until these are reconciled against the provider's usage record.`,
      "",
      "| Reservation | Held | Reason |",
      "| --- | --- | --- |",
      ...newlyUncertain.map((u) => `| \`${u.reservationId}\` | $${u.heldUsd.toFixed(5)} | ${u.reason} |`),
      "",
    );
  }

  lines.push("## Replies, verbatim", "", "Read these. No script judges whether the wording is right for the site.", "");
  for (const r of records) lines.push(`**${r.category}** | "${r.text}"`, "", `> ${r.reply.replace(/\n/g, " ")}`, "");

  const path = `${dir}/${stamp}.md`;
  writeFileSync(path, lines.join("\n"));
  writeFileSync(`${dir}/latest.md`, lines.join("\n"));
  return path;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
