/**
 * One pass of docs/EVALUATION-PLAN.md.
 *
 *   npm run assistant:evaluate
 *
 * Twelve varied conversations across the three categories, three of which run
 * on to a second turn, plus three repetitions of one sentence. At most 25
 * model calls, and never a call whose worst case would take the run past its
 * allowance.
 *
 * Nothing here may be edited to improve a score. The expectations are the
 * plan's, the scoring is `checkReply`, and the run stops rather than retrying.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { checkReply, type CheckableReply, type ExpectedCase } from "../src/domain/livetest-expectations";
import { buildReport, reportStamp, type CaseRecord } from "../src/domain/livetest-report";

function loadEnvLocal(path = ".env.local") {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const BASE = process.env.ASSISTANT_TEST_BASE_URL ?? "http://localhost:3000";
const ADMIN_KEY = process.env.ADMIN_ACCESS_KEY ?? "";
const RUN_ALLOWANCE_USD = 0.05;
const MAX_CALLS = 25;

type FollowUp =
  | { kind: "unconditional"; text: string }
  // Answered only if the site asks, with the option the shopper's own words
  // name. Absent question, absent answer: recorded as not exercised.
  | { kind: "if_asked"; label: string };

type Case = {
  id: string;
  category: string;
  text: string;
  note: string;
  expect: ExpectedCase;
  // The engine's own answer for the expected constraints, from the catalogue.
  // Set only where the expected HARD constraints decide membership: a case
  // whose expectation is a preference cannot pin a product set, because a
  // preference orders and does not filter. Every case records its products
  // whether or not it asserts them.
  //
  // Checked only when the constraints came back as expected: products that
  // follow from different constraints say nothing about these.
  products?: string[];
  unconfirmed?: string[];
  followUp?: FollowUp;
  followUpExpect?: ExpectedCase;
  followUpProducts?: string[];
  skipsModel?: boolean;
};

const CASES: Case[] = [
  {
    id: "R1/M2",
    category: "red-light",
    text: "I need a full-body panel under $700 that won't take over my apartment.",
    note: "budget with two preferences; typed clarification if asked",
    expect: {
      hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 69999 }],
      soft: [{ key: "coverage" }, { key: "footprint", directions: ["prefer_low"] }],
      alsoReasonable: ["mounting"],
    },
    // No product expectation. Coverage and footprint are expected as
    // preferences, and a preference does not decide what matches, so the
    // product set depends on which form the reply takes. Recorded, not scored.
    followUp: { kind: "if_asked", label: "" },
  },
  {
    id: "R2",
    category: "red-light",
    text: "Nothing over $1,200, and I want to be able to hang it on a door.",
    note: "inclusive budget plus a published list value",
    expect: {
      hard: [
        { key: "price", ops: ["lte", "lt"], admitsAtMost: 120000 },
        { key: "mounting", ops: ["includes", "in"], value: "door_hang" },
      ],
    },
    products: [],
    unconfirmed: ["bon-charge-max", "hooga-pro1500"],
  },
  {
    id: "R3",
    category: "red-light",
    text: "Something small for my face.",
    note: "no budget may be invented",
    expect: { soft: [{ key: "coverage" }], alsoReasonable: ["footprint"] },
  },
  {
    id: "R4",
    category: "red-light",
    text: "Will red light heal my tendonitis?",
    note: "medical, refused before any model call",
    expect: { medicalIntent: true },
    skipsModel: true,
  },
  {
    id: "C1/X1",
    category: "cold-plunge",
    text: "A tub with a chiller, up to $5,000.",
    note: "chiller plus budget; budget changed on turn two",
    expect: {
      hard: [
        { key: "price", ops: ["lte", "lt"], admitsAtMost: 500000 },
        { key: "chiller_included", ops: ["eq"], value: true },
      ],
    },
    products: [],
    unconfirmed: [],
    followUp: { kind: "unconditional", text: "Actually, make it up to $10,000." },
    followUpExpect: {
      hard: [
        { key: "price", ops: ["lte", "lt"], admitsAtMost: 1000000 },
        { key: "chiller_included", ops: ["eq"], value: true },
      ],
    },
    followUpProducts: ["edge-tub-elite", "plunge-original", "renu-cold-stoic-2"],
  },
  {
    id: "C2",
    category: "cold-plunge",
    text: "I don't want to deal with an electrician.",
    note: "implied setup constraint",
    // Soft-only expectation, so membership is not determined. Recorded.
    expect: { soft: [{ key: "plumbing" }] },
  },
  {
    id: "C3",
    category: "cold-plunge",
    text: "Something I can pack away when guests come.",
    note: "implied portability",
    // Soft-only expectation, so membership is not determined. Recorded.
    expect: { soft: [{ key: "tub_type" }] },
  },
  {
    id: "C4",
    category: "cold-plunge",
    text: "The cheapest one that still has a chiller.",
    note: "superlative becomes a preference, not a budget",
    expect: {
      hard: [{ key: "chiller_included", ops: ["eq"], value: true }],
      soft: [{ key: "price", directions: ["prefer_low"] }],
    },
    products: ["edge-tub-elite", "plunge-original", "renu-cold-stoic-2"],
    unconfirmed: [],
  },
  {
    id: "D1",
    category: "wellness-drinks",
    text: "No caffeine, I drink it at night.",
    note: "negation, and the operator must not invert it",
    expect: { hard: [{ key: "caffeine_mg", ops: ["eq", "lte", "lt"], atMost: 0 }] },
    products: ["ag1-pouch-30", "cure-hydration-lemonade-14", "liquid-iv-hydration-multiplier-16", "lmnt-citrus-salt-30", "olipop-root-beer-12"],
    unconfirmed: [],
  },
  {
    id: "D2/M1",
    category: "wellness-drinks",
    text: "A greens powder I can subscribe to.",
    note: "list value plus boolean; clicked clarification if asked",
    expect: {
      hard: [
        { key: "function", ops: ["includes", "in"], value: "greens" },
        { key: "subscription_available", ops: ["eq"], value: true },
      ],
    },
    products: ["ag1-pouch-30"],
    unconfirmed: [],
    followUp: { kind: "if_asked", label: "" },
  },
  {
    id: "D3",
    category: "wellness-drinks",
    text: "Which one is healthiest?",
    note: "must get the shopping clarification, not the clinician line",
    expect: { medicalIntent: false },
  },
  {
    id: "D4",
    category: "wellness-drinks",
    text: "Something under $1.60 a serving that isn't a can.",
    note: "decimal per-serving budget with a negated enum",
    expect: {
      hard: [
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 159 },
        { key: "format", ops: ["neq"], value: "rtd_can" },
      ],
    },
    products: ["lmnt-citrus-salt-30"],
    unconfirmed: ["liquid-iv-hydration-multiplier-16"],
  },
];

const REPETITION: Case = {
  id: "REP",
  category: "wellness-drinks",
  text: "Zero sugar electrolytes under $2 a serving",
  note: "repetition: how often is sugar_g extracted",
  expect: {
    hard: [
      { key: "sugar_g", ops: ["lte", "eq", "lt"], atMost: 1 },
      { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
      { key: "function", ops: ["includes", "in"], value: "electrolytes" },
    ],
    alsoReasonable: ["format"],
  },
};

type Constraint = { key: string; op?: string; direction?: string; value?: unknown; weight?: number };
type Reply = {
  text: string;
  mode: string;
  failure?: string;
  matchSummary?: string;
  matchingIds: string[];
  unconfirmedPrice: { productId: string }[];
  question?: { text: string; options: string[]; key?: string };
  proposals: { kind: string; hard?: Constraint[]; soft?: Constraint[]; matchingIds?: string[] }[];
  medicalRedirect: boolean;
  notice?: string;
};

type Usage = {
  spentUsd: number;
  uncertainUsd: number;
  worstCasePerRequestUsd: number;
  remainingUsd: number;
  store: string;
  shared: boolean;
  credential: { mode: string; baseUrl?: string };
  uncertainCharges: { reservationId: string; reason: string; heldUsd: number }[];
};

async function usage(): Promise<Usage | null> {
  if (!ADMIN_KEY) return null;
  const res = await fetch(`${BASE}/api/admin/assistant-usage`, { headers: { "x-admin-key": ADMIN_KEY } });
  if (!res.ok) return null;
  const j = (await res.json()) as Usage & { ledger: { store: string; shared: boolean } };
  return { ...j, store: j.ledger.store, shared: j.ledger.shared };
}

// Everything written down, turn by turn, whatever it says.
type Turn = {
  caseId: string;
  turn: number;
  text: string;
  answered?: "clicked" | "typed" | "unconditional";
  reply: string;
  mode: string;
  failure?: string;
  question?: { text: string; options: string[] };
  hard: Constraint[];
  soft: Constraint[];
  matching: string[];
  unconfirmed: string[];
  problems: string[];
  productProblems: string[];
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
};

const turns: Turn[] = [];
const notes: string[] = [];
let calls = 0;
let stopped: string | null = null;

const sorted = (a: string[]) => [...a].sort();
const same = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

async function ask(args: {
  sessionId: string;
  category: string;
  messages: { role: "user" | "assistant"; text: string }[];
  hard: Constraint[];
  soft: Constraint[];
  answering?: { key: string; via: "option" | "typed" };
}): Promise<Reply | null> {
  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: args.sessionId,
      categoryId: args.category,
      messages: args.messages,
      hard: args.hard,
      soft: args.soft,
      answering: args.answering,
    }),
  });
  if (!res.ok) {
    stopped = `the application returned HTTP ${res.status}`;
    return null;
  }
  return (await res.json()) as Reply;
}

function record(c: Case, turn: number, text: string, r: Reply, expect: ExpectedCase, products: string[] | undefined, unconfirmed: string[] | undefined, answered?: Turn["answered"]) {
  const applied = r.proposals.find((p) => p.kind === "apply_preferences");
  const problems = r.failure ? [`the reply could not be used (${r.failure}); nothing was extracted`] : checkReply(r as CheckableReply, expect);
  const productProblems: string[] = [];
  // Only meaningful when the constraints are the expected ones: products that
  // follow from different constraints say nothing about these.
  if (problems.length === 0 && products !== undefined && !same(r.matchingIds, products)) {
    productProblems.push(`matched ${JSON.stringify(sorted(r.matchingIds))}, expected ${JSON.stringify(sorted(products))}`);
  }
  const gotUnconfirmed = r.unconfirmedPrice.map((u) => u.productId);
  if (problems.length === 0 && unconfirmed !== undefined && !same(gotUnconfirmed, unconfirmed.slice(0, 3))) {
    productProblems.push(`unconfirmed ${JSON.stringify(sorted(gotUnconfirmed))}, expected up to 3 of ${JSON.stringify(sorted(unconfirmed))}`);
  }
  turns.push({
    caseId: c.id,
    turn,
    text,
    answered,
    reply: r.text,
    mode: r.mode,
    failure: r.failure,
    question: r.question ? { text: r.question.text, options: r.question.options } : undefined,
    hard: applied?.hard ?? [],
    soft: applied?.soft ?? [],
    matching: r.matchingIds,
    unconfirmed: gotUnconfirmed,
    problems,
    productProblems,
    costUsd: null,
    inputTokens: null,
    outputTokens: null,
  });
  const line = [...problems, ...productProblems];
  console.log(`${line.length === 0 ? "ok  " : "FAIL"} ${c.id} turn ${turn}${answered ? ` (${answered})` : ""}${line.length ? `  ${line.join("; ")}` : ""}`);
}

// Mirrors the provider: text that is exactly an option is the same act as
// pressing it; text naming one among other words is a typed answer.
function classify(text: string, options: string[]): "option" | "typed" {
  const bare = text.trim().replace(/[.,!?;:]+$/, "").toLowerCase();
  return options.some((o) => o.trim().toLowerCase() === bare) ? "option" : "typed";
}

function mentions(text: string, term: string): boolean {
  const cleaned = term.replace(/[_-]+/g, " ").trim();
  if (cleaned.length < 3) return false;
  const escaped = cleaned.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s_-]+");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu").test(text);
}

async function guard(before: Usage, spentSoFar: number): Promise<boolean> {
  if (calls >= MAX_CALLS) {
    stopped = `the call ceiling of ${MAX_CALLS} was reached`;
    return false;
  }
  const worstCase = before.worstCasePerRequestUsd;
  if (spentSoFar + worstCase > RUN_ALLOWANCE_USD + 1e-9) {
    stopped = `the next call's worst case ($${worstCase.toFixed(5)}) would take the run past its $${RUN_ALLOWANCE_USD.toFixed(2)} allowance (spent $${spentSoFar.toFixed(6)})`;
    return false;
  }
  return true;
}

async function main() {
  const before = await usage();
  if (!before) {
    console.error("ADMIN_ACCESS_KEY is not set or the admin endpoint refused. Nothing was spent.");
    process.exit(2);
  }

  // A rehearsal against a stubbed model, to prove the runner before it spends
  // anything. It cannot be used for a real run: it refuses the moment the
  // paid configuration is present, and it relaxes nothing about the call
  // ceiling or the run allowance.
  const dryRun = process.env.ASSISTANT_EVAL_DRY_RUN === "1";
  if (dryRun && before.credential.mode === "proxy") {
    console.error("ASSISTANT_EVAL_DRY_RUN is set while the proxy credential is configured. Refusing: a rehearsal must not run against the paid path.");
    process.exit(2);
  }
  if (dryRun) console.log("REHEARSAL against a stubbed model. Nothing here is a result.\n");

  // Fail closed. Every one of these is a reason not to spend.
  const problems: string[] = [];
  if (process.env.ASSISTANT_RESPONSE_FORMAT?.trim() !== "json_schema") problems.push("ASSISTANT_RESPONSE_FORMAT is not json_schema in this shell; check the server's own environment");
  if (!dryRun && before.credential.mode !== "proxy") problems.push(`credential mode is "${before.credential.mode}", not "proxy"`);
  if (!dryRun && before.credential.baseUrl !== "https://api.openai.com/v1") problems.push(`base URL is "${before.credential.baseUrl}"`);
  if (before.store !== "postgres" || !before.shared) problems.push(`ledger is "${before.store}", shared=${before.shared}`);
  if (problems.length > 0) {
    console.error("Refusing to spend:\n  " + problems.join("\n  "));
    process.exit(2);
  }

  console.log(`Ledger: ${before.store}, shared. Spent this month: $${before.spentUsd.toFixed(6)}. Held uncertain: $${before.uncertainUsd.toFixed(6)}`);
  console.log(`Cap remaining: $${before.remainingUsd.toFixed(6)}. Run allowance: $${RUN_ALLOWANCE_USD.toFixed(2)}. Reservation per call: $${before.worstCasePerRequestUsd.toFixed(5)}`);
  console.log(`Ceiling: ${MAX_CALLS} calls. Cases: ${CASES.length} varied, 3 repetitions.\n`);

  let last = before;
  const spent = () => last.spentUsd - before.spentUsd;

  const runTurn = async (c: Case, turn: number, text: string, expect: ExpectedCase, products: string[] | undefined, unconfirmed: string[] | undefined, opts: {
    sessionId: string;
    messages: { role: "user" | "assistant"; text: string }[];
    hard: Constraint[];
    soft: Constraint[];
    answering?: { key: string; via: "option" | "typed" };
    answered?: Turn["answered"];
    costs: boolean;
  }): Promise<Reply | null> => {
    if (opts.costs && !(await guard(last, spent()))) return null;
    if (opts.costs) calls++;
    const r = await ask({ sessionId: opts.sessionId, category: c.category, messages: opts.messages, hard: opts.hard, soft: opts.soft, answering: opts.answering });
    if (!r) return null;
    if (r.mode !== "live") {
      stopped = `the endpoint replied in "${r.mode}" mode, not "live"`;
      record(c, turn, text, r, expect, products, unconfirmed, opts.answered);
      return null;
    }
    record(c, turn, text, r, expect, products, unconfirmed, opts.answered);

    const now = await usage();
    if (now) {
      const created = now.uncertainCharges.filter((u) => !last.uncertainCharges.some((b) => b.reservationId === u.reservationId));
      const t = turns[turns.length - 1];
      t.costUsd = Number((now.spentUsd - last.spentUsd).toFixed(6));
      last = now;
      if (created.length > 0) {
        stopped = `a charge could not be measured (${created.map((u) => u.reservationId).join(", ")})`;
        return null;
      }
    }
    return r;
  };

  for (const c of CASES) {
    const sessionId = `s_eval_${Date.now()}_${c.id.replace(/\W/g, "")}`;
    const messages: { role: "user" | "assistant"; text: string }[] = [{ role: "user", text: c.text }];
    const r = await runTurn(c, 1, c.text, c.expect, c.products, c.unconfirmed, {
      sessionId,
      messages,
      hard: [],
      soft: [],
      costs: !c.skipsModel,
    });
    if (stopped) break;
    if (!r) continue;

    if (c.followUp) {
      const applied = r.proposals.find((p) => p.kind === "apply_preferences");
      const held = { hard: applied?.hard ?? [], soft: applied?.soft ?? [] };
      if (c.followUp.kind === "unconditional") {
        const text = c.followUp.text;
        messages.push({ role: "assistant", text: r.text }, { role: "user", text });
        await runTurn(c, 2, text, c.followUpExpect ?? c.expect, c.followUpProducts, undefined, {
          sessionId,
          messages,
          hard: held.hard,
          soft: held.soft,
          answered: "unconditional",
          costs: true,
        });
      } else if (r.question && r.question.key && r.question.options.length > 0) {
        // The option the shopper's own words name. None, and nothing is
        // answered: an unasked-for answer is a different conversation.
        const option = r.question.options.find((o) => mentions(c.text, o));
        if (!option) {
          notes.push(`${c.id}: the site asked "${r.question.text}" but no option matches the shopper's own words, so nothing was answered.`);
        } else {
          const via = classify(option, r.question.options);
          messages.push({ role: "assistant", text: r.text }, { role: "user", text: option });
          await runTurn(c, 2, option, c.expect, undefined, undefined, {
            sessionId,
            messages,
            hard: held.hard,
            soft: held.soft,
            answering: { key: r.question.key, via },
            answered: via === "option" ? "clicked" : "typed",
            costs: true,
          });
        }
      } else {
        notes.push(`${c.id}: the site asked no clarifying question, so the clarification path was NOT EXERCISED.`);
        console.log(`--   ${c.id} clarification not exercised (no question asked)`);
      }
    }
    if (stopped) break;
    await sleep(400);
  }

  if (!stopped) {
    for (let i = 1; i <= 3; i++) {
      const c = { ...REPETITION, id: `REP${i}` };
      await runTurn(c, 1, c.text, c.expect, undefined, undefined, {
        sessionId: `s_eval_${Date.now()}_rep${i}`,
        messages: [{ role: "user", text: c.text }],
        hard: [],
        soft: [],
        costs: true,
      });
      if (stopped) break;
      await sleep(400);
    }
  }

  const after = (await usage()) ?? last;
  writeReport(before, after);
  process.exit(turns.some((t) => t.problems.length > 0 || t.productProblems.length > 0) || stopped ? 1 : 0);
}

function snapshot(u: Usage) {
  return { spentUsd: u.spentUsd, uncertainUsd: u.uncertainUsd, store: u.store, credential: u.credential, uncertainCharges: u.uncertainCharges };
}

function writeReport(before: Usage, after: Usage) {
  const dir = "docs/live-test-results";
  mkdirSync(dir, { recursive: true });
  const records: CaseRecord[] = turns.map((t) => ({
    category: t.caseId,
    note: `turn ${t.turn}${t.answered ? `, ${t.answered}` : ""}`,
    text: t.text,
    reply: t.reply,
    problems: [...t.problems, ...t.productProblems],
    shown: t.matching.length,
  }));

  const lines: string[] = [
    buildReport({
      records,
      plannedCases: CASES.length + 3,
      before: snapshot(before),
      after: snapshot(after),
      stoppedEarly: stopped ? { reason: stopped } : undefined,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    }),
    "",
    "## Every turn, as it happened",
    "",
    `Model calls: **${calls}** of a ${MAX_CALLS} ceiling. Run allowance $${RUN_ALLOWANCE_USD.toFixed(2)}, spent $${(after.spentUsd - before.spentUsd).toFixed(6)}.`,
    "",
  ];

  for (const t of turns) {
    lines.push(
      `### ${t.caseId} turn ${t.turn}${t.answered ? ` (${t.answered})` : ""}`,
      "",
      `> ${t.text}`,
      "",
      `**Reply.** ${t.reply.replace(/\n/g, " ")}`,
      "",
      t.question ? `**Asked.** ${t.question.text} [${t.question.options.join(" | ")}]\n` : "",
      `| | |`,
      `| --- | --- |`,
      `| hard | \`${JSON.stringify(t.hard)}\` |`,
      `| soft | \`${JSON.stringify(t.soft)}\` |`,
      `| matched | ${t.matching.length === 0 ? "none" : t.matching.map((m) => `\`${m}\``).join(", ")} |`,
      `| unconfirmed on price | ${t.unconfirmed.length === 0 ? "none" : t.unconfirmed.map((m) => `\`${m}\``).join(", ")} |`,
      `| cost | ${t.costUsd === null ? "not measured" : `$${t.costUsd.toFixed(6)}`} |`,
      `| result | ${[...t.problems, ...t.productProblems].length === 0 ? "ok" : [...t.problems, ...t.productProblems].join("; ")} |`,
      "",
    );
  }

  if (notes.length > 0) lines.push("## Paths not exercised", "", ...notes.map((n) => `- ${n}`), "");

  const body = lines.join("\n");
  const path = `${dir}/${reportStamp()}.md`;
  writeFileSync(path, body);
  writeFileSync(`${dir}/latest.md`, body);
  console.log(`\nReport written to ${path}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
