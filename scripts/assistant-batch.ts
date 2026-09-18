/**
 * One frozen verification batch: ten single-turn conversations, ten calls.
 *
 *   npm run assistant:batch
 *
 * Three known failures from 03:31 in their exact wording, the drinks
 * repetition twice, and six paraphrases the prompt corrections were not
 * written against. No second turns, no clarification answered, no retries.
 *
 * Scored by `scoreCase`, which distinguishes a required constraint from a
 * required preference, refuses a constraint the case did not allow, and names
 * a budget the shopper never stated as invented.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { scoreCase, type CaseExpectation } from "../src/domain/evaluation-scoring";
import type { CheckableReply } from "../src/domain/livetest-expectations";
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
const RUN_ALLOWANCE_USD = 0.03;
const MAX_CALLS = 10;

type Case = {
  n: number;
  id: string;
  category: string;
  text: string;
  why: string;
  expect: CaseExpectation;
  // Asserted only where the required hard constraints decide membership.
  products?: string[];
  unconfirmed?: string[];
};

const CASES: Case[] = [
  {
    n: 1,
    id: "B1-cheapest-chiller",
    category: "cold-plunge",
    text: "The cheapest one that still has a chiller.",
    why: "03:31 returned price lte 549000, the cheapest chiller tub's own price",
    expect: {
      requiredHard: [{ key: "chiller_included", ops: ["eq"], value: true }],
      requiredSoft: [{ key: "price", directions: ["prefer_low"] }],
      forbiddenHard: [{ key: "price", because: "the shopper named no amount" }],
      allowed: ["tub_type"],
    },
  },
  {
    n: 2,
    id: "B2-decimal-per-serving",
    category: "wellness-drinks",
    text: "Something under $1.60 a serving that isn't a can.",
    why: "03:31 returned lt 16000, reading $1.60 as $160",
    expect: {
      requiredHard: [
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 159 },
        { key: "format", ops: ["neq"], value: "rtd_can" },
      ],
    },
    products: ["lmnt-citrus-salt-30"],
    unconfirmed: ["liquid-iv-hydration-multiplier-16"],
  },
  {
    n: 3,
    id: "B3-repetition-a",
    category: "wellness-drinks",
    text: "Zero sugar electrolytes under $2 a serving",
    why: "function 0 of 5 and sugar_g 2 of 5 across earlier samples",
    expect: {
      requiredHard: [
        { key: "sugar_g", ops: ["eq", "lte", "lt"], atMost: 1 },
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
        { key: "function", ops: ["includes", "in"], value: "electrolytes" },
      ],
      allowed: ["format"],
    },
    products: ["lmnt-citrus-salt-30"],
    unconfirmed: [],
  },
  {
    n: 4,
    id: "B4-repetition-b",
    category: "wellness-drinks",
    text: "Zero sugar electrolytes under $2 a serving",
    why: "the same sentence again, in a separate session",
    expect: {
      requiredHard: [
        { key: "sugar_g", ops: ["eq", "lte", "lt"], atMost: 1 },
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
        { key: "function", ops: ["includes", "in"], value: "electrolytes" },
      ],
      allowed: ["format"],
    },
    products: ["lmnt-citrus-salt-30"],
    unconfirmed: [],
  },
  {
    n: 5,
    id: "B5-least-expensive",
    category: "red-light",
    text: "Whichever red light panel is least expensive.",
    why: "a superlative with no amount, in wording the fix was not written against",
    expect: {
      requiredSoft: [{ key: "price", directions: ["prefer_low"] }],
      forbiddenHard: [{ key: "price", because: "the shopper named no amount" }],
      allowed: ["coverage", "footprint", "mounting"],
    },
  },
  {
    n: 6,
    id: "B6-smallest-plunge",
    category: "cold-plunge",
    text: "The smallest cold plunge you have.",
    why: "cold plunge holds water capacity and height, neither filterable, so size has nowhere to go",
    expect: {
      // Saying so, or asking, is the answer. Guessing a filter that means
      // something else is not, and neither is a price nobody named.
      mustNameOrAsk: { because: "this category has no size filter" },
      forbiddenHard: [{ key: "price", because: "the shopper named no amount" }],
      allowed: ["tub_type"],
    },
  },
  {
    n: 7,
    id: "B7-less-than-decimal",
    category: "wellness-drinks",
    text: "Drinks that cost less than $2.25 per serving.",
    why: "a comparison against a stated decimal: a requirement, not a preference",
    expect: {
      requiredHard: [{ key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 224 }],
    },
    products: ["celsius-sparkling-orange-12", "cure-hydration-lemonade-14", "lmnt-citrus-salt-30"],
    unconfirmed: ["liquid-iv-hydration-multiplier-16", "olipop-root-beer-12"],
  },
  {
    n: 8,
    id: "B8-cents-no-dollar-sign",
    category: "wellness-drinks",
    text: "Nothing above 90 cents a serving.",
    why: "a sub-dollar amount written without a dollar sign; inclusive wording",
    expect: {
      requiredHard: [{ key: "price_per_serving_minor", ops: ["lte", "lt"], admitsAtMost: 90 }],
    },
    products: [],
    unconfirmed: ["liquid-iv-hydration-multiplier-16", "olipop-root-beer-12"],
  },
  {
    n: 9,
    id: "B9-three-requirements",
    category: "wellness-drinks",
    text: "No caffeine, no sugar, under $2 a serving.",
    why: "three requirements in one sentence, none of which may be dropped",
    expect: {
      requiredHard: [
        { key: "caffeine_mg", ops: ["eq", "lte", "lt"], atMost: 0 },
        { key: "sugar_g", ops: ["eq", "lte", "lt"], atMost: 0 },
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
      ],
      allowed: ["function", "format"],
    },
    products: ["lmnt-citrus-salt-30"],
    unconfirmed: [],
  },
  {
    n: 10,
    id: "B10-two-hard-one-soft",
    category: "wellness-drinks",
    text: "A greens powder with a subscription, ideally cheap.",
    why: "two requirements and one preference in one sentence",
    expect: {
      requiredHard: [
        { key: "function", ops: ["includes", "in"], value: "greens" },
        { key: "subscription_available", ops: ["eq"], value: true },
      ],
      requiredSoft: [{ key: "price", directions: ["prefer_low"] }],
      forbiddenHard: [{ key: "price", because: "\"ideally cheap\" names no amount" }],
      allowed: ["format"],
    },
    products: ["ag1-pouch-30"],
    unconfirmed: [],
  },
];

type Constraint = { key: string; op?: string; direction?: string; value?: unknown; weight?: number };
type Reply = {
  text: string;
  mode: string;
  failure?: string;
  matchingIds: string[];
  unconfirmedPrice: { productId: string }[];
  question?: { text: string; options: string[] };
  proposals: { kind: string; hard?: Constraint[]; soft?: Constraint[] }[];
  medicalRedirect: boolean;
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

type Turn = Case & {
  reply: string;
  mode: string;
  failure?: string;
  question?: { text: string; options: string[] };
  gotHard: Constraint[];
  gotSoft: Constraint[];
  matched: string[];
  gotUnconfirmed: string[];
  problems: string[];
  productProblems: string[];
  costUsd: number | null;
};

const turns: Turn[] = [];
let calls = 0;
let stopped: string | null = null;
const sorted = (a: string[]) => [...a].sort();
const same = (a: string[], b: string[]) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

async function main() {
  const before = await usage();
  if (!before) {
    console.error("ADMIN_ACCESS_KEY is not set or the admin endpoint refused. Nothing was spent.");
    process.exit(2);
  }
  const bad: string[] = [];
  if (process.env.ASSISTANT_RESPONSE_FORMAT?.trim() !== "json_schema") bad.push("ASSISTANT_RESPONSE_FORMAT is not json_schema in this shell");
  if (before.credential.mode !== "proxy") bad.push(`credential mode is "${before.credential.mode}"`);
  if (before.credential.baseUrl !== "https://api.openai.com/v1") bad.push(`base URL is "${before.credential.baseUrl}"`);
  if (before.store !== "postgres" || !before.shared) bad.push(`ledger is "${before.store}", shared=${before.shared}`);
  if (bad.length > 0) {
    console.error("Refusing to spend:\n  " + bad.join("\n  "));
    process.exit(2);
  }

  console.log(`Ledger: ${before.store}, shared. Spent: $${before.spentUsd.toFixed(6)}. Uncertain: $${before.uncertainUsd.toFixed(6)}. Cap remaining: $${before.remainingUsd.toFixed(6)}`);
  console.log(`Batch: ${CASES.length} single-turn conversations, ${MAX_CALLS} calls maximum, $${RUN_ALLOWANCE_USD.toFixed(2)} allowance, reservation $${before.worstCasePerRequestUsd.toFixed(5)} per call.\n`);

  let last = before;
  for (const c of CASES) {
    const spentSoFar = last.spentUsd - before.spentUsd;
    if (calls >= MAX_CALLS) {
      stopped = `the call ceiling of ${MAX_CALLS} was reached`;
      break;
    }
    if (spentSoFar + before.worstCasePerRequestUsd > RUN_ALLOWANCE_USD + 1e-9) {
      stopped = `the next call's worst case would take the batch past its $${RUN_ALLOWANCE_USD.toFixed(2)} allowance (spent $${spentSoFar.toFixed(6)})`;
      break;
    }

    calls++;
    const res = await fetch(`${BASE}/api/assistant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: `s_batch_${Date.now()}_${c.n}`, categoryId: c.category, messages: [{ role: "user", text: c.text }], hard: [], soft: [] }),
    });
    if (!res.ok) {
      stopped = `case ${c.n} returned HTTP ${res.status}`;
      break;
    }
    const r = (await res.json()) as Reply;
    const applied = r.proposals.find((p) => p.kind === "apply_preferences");
    const v = scoreCase(r as CheckableReply, c.expect);
    const productProblems: string[] = [];
    if (v.problems.length === 0 && c.products !== undefined && !same(r.matchingIds, c.products)) {
      productProblems.push(`matched ${JSON.stringify(sorted(r.matchingIds))}, expected ${JSON.stringify(sorted(c.products))}`);
    }
    const gotUnconfirmed = r.unconfirmedPrice.map((u) => u.productId);
    if (v.problems.length === 0 && c.unconfirmed !== undefined && !same(gotUnconfirmed, c.unconfirmed.slice(0, 3))) {
      productProblems.push(`unconfirmed ${JSON.stringify(sorted(gotUnconfirmed))}, expected ${JSON.stringify(sorted(c.unconfirmed.slice(0, 3)))}`);
    }

    turns.push({
      ...c,
      reply: r.text,
      mode: r.mode,
      failure: r.failure,
      question: r.question,
      gotHard: applied?.hard ?? [],
      gotSoft: applied?.soft ?? [],
      matched: r.matchingIds,
      gotUnconfirmed,
      problems: v.problems,
      productProblems,
      costUsd: null,
    });
    const line = [...v.problems, ...productProblems];
    console.log(`${line.length === 0 ? "ok  " : "FAIL"} ${c.n}. ${c.id}${line.length ? `  ${line.join("; ")}` : ""}`);

    if (r.mode !== "live") {
      stopped = `case ${c.n} replied in "${r.mode}" mode, not "live"`;
      break;
    }
    const now = await usage();
    if (now) {
      const created = now.uncertainCharges.filter((u) => !last.uncertainCharges.some((b) => b.reservationId === u.reservationId));
      turns[turns.length - 1].costUsd = Number((now.spentUsd - last.spentUsd).toFixed(6));
      last = now;
      if (created.length > 0) {
        stopped = `a charge could not be measured (${created.map((u) => u.reservationId).join(", ")})`;
        break;
      }
    }
    await sleep(400);
  }

  const after = (await usage()) ?? last;
  write(before, after);
  process.exit(turns.some((t) => t.problems.length > 0 || t.productProblems.length > 0) || stopped ? 1 : 0);
}

const snap = (u: Usage) => ({ spentUsd: u.spentUsd, uncertainUsd: u.uncertainUsd, store: u.store, credential: u.credential, uncertainCharges: u.uncertainCharges });

function write(before: Usage, after: Usage) {
  const dir = "docs/live-test-results";
  mkdirSync(dir, { recursive: true });
  const records: CaseRecord[] = turns.map((t) => ({
    category: t.category,
    note: `${t.n}. ${t.id}`,
    text: t.text,
    reply: t.reply,
    problems: [...t.problems, ...t.productProblems],
    shown: t.matched.length,
  }));
  const lines = [
    buildReport({
      records,
      plannedCases: CASES.length,
      before: snap(before),
      after: snap(after),
      stoppedEarly: stopped ? { reason: stopped } : undefined,
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      unit: { one: "conversation", many: "conversations" },
    }),
    "",
    "## Every case, as it happened",
    "",
    `Calls: **${calls}** of a ${MAX_CALLS} ceiling. Allowance $${RUN_ALLOWANCE_USD.toFixed(2)}, spent $${(after.spentUsd - before.spentUsd).toFixed(6)}. Single turn each, no clarification answered, no retries.`,
    "",
  ];
  for (const t of turns) {
    lines.push(
      `### ${t.n}. ${t.id}`,
      "",
      `> ${t.text}`,
      "",
      `Why it is here: ${t.why}.`,
      "",
      `**Reply.** ${t.reply.replace(/\n/g, " ")}`,
      "",
      t.question ? `**Asked.** ${t.question.text} [${t.question.options.join(" | ")}]\n` : "",
      "| | |",
      "| --- | --- |",
      `| hard | \`${JSON.stringify(t.gotHard)}\` |`,
      `| soft | \`${JSON.stringify(t.gotSoft)}\` |`,
      `| matched | ${t.matched.length === 0 ? "none" : t.matched.map((m) => `\`${m}\``).join(", ")} |`,
      `| unconfirmed on price | ${t.gotUnconfirmed.length === 0 ? "none" : t.gotUnconfirmed.map((m) => `\`${m}\``).join(", ")} |`,
      `| cost | ${t.costUsd === null ? "not measured" : `$${t.costUsd.toFixed(6)}`} |`,
      `| result | ${[...t.problems, ...t.productProblems].length === 0 ? "ok" : [...t.problems, ...t.productProblems].join("; ")} |`,
      "",
    );
  }
  const body = lines.join("\n");
  const path = `${dir}/${reportStamp()}-batch.md`;
  writeFileSync(path, body);
  writeFileSync(`${dir}/latest.md`, body);
  console.log(`\nReport written to ${path}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
