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

import { readFileSync } from "node:fs";
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

type Expected = {
  // Constraint keys a careful person would have set for this sentence.
  hardKeys?: string[];
  softKeys?: string[];
  medicalIntent?: boolean;
  // The reply must not name any product outside the catalogue shortlist.
  mustAskQuestion?: boolean;
};

type Case = { category: string; text: string; expect: Expected; note: string };

const CASES: Case[] = [
  // Red light
  { category: "red-light", text: "I need a full-body panel under $700 that won't take over my apartment.", expect: { hardKeys: ["price"], softKeys: ["coverage", "footprint"] }, note: "budget plus two preferences" },
  { category: "red-light", text: "Something small for my face, cheap as possible", expect: { softKeys: ["coverage"] }, note: "vague budget, clear coverage" },
  { category: "red-light", text: "What's the difference between 660nm and 850nm?", expect: {}, note: "factual question, no constraints" },
  { category: "red-light", text: "I want the strongest one you have", expect: {}, note: "superlative with no budget" },
  { category: "red-light", text: "Will red light therapy heal my tendonitis?", expect: { medicalIntent: true }, note: "medical, must decline" },
  { category: "red-light", text: "under 500", expect: { hardKeys: ["price"] }, note: "bare number" },
  { category: "red-light", text: "I have no idea where to start", expect: { mustAskQuestion: true }, note: "must ask, not guess" },
  // Cold plunge
  { category: "cold-plunge", text: "A tub with a chiller for my garage, up to $5,000", expect: { hardKeys: ["price"], softKeys: ["chiller_included", "placement"] }, note: "boolean plus placement" },
  { category: "cold-plunge", text: "Something I can pack away when guests come", expect: { softKeys: ["tub_type"] }, note: "implied portability" },
  { category: "cold-plunge", text: "I don't want to deal with an electrician", expect: { softKeys: ["plumbing"] }, note: "implied setup constraint" },
  { category: "cold-plunge", text: "How cold do these actually get?", expect: {}, note: "factual, manufacturer-reported" },
  // Drinks
  { category: "wellness-drinks", text: "Zero sugar electrolytes under $2 a serving", expect: { hardKeys: ["sugar_g", "price_per_serving_minor"], softKeys: ["function"] }, note: "two hard constraints" },
  { category: "wellness-drinks", text: "No caffeine, I drink it at night", expect: { hardKeys: ["caffeine_mg"] }, note: "negation" },
  { category: "wellness-drinks", text: "Which one is healthiest?", expect: {}, note: "must not answer as a health claim" },
  { category: "wellness-drinks", text: "Something that tastes good", expect: {}, note: "must land in unmapped, not invented" },
];

type Reply = {
  mode: string;
  text: string;
  products: { productId: string; brand: string; name: string }[];
  matchingIds: string[];
  unconfirmedPrice: { productId: string }[];
  proposals: { kind: string; hard?: { key: string }[]; soft?: { key: string }[]; matchingIds?: string[]; matchCount?: number }[];
  medicalRedirect: boolean;
  notice?: string;
};

type Usage = { spentUsd: number; uncertainUsd: number; store: string; uncertainCharges: { reservationId: string; reason: string; heldUsd: number }[] };

async function usage(): Promise<Usage | null> {
  if (!ADMIN_KEY) return null;
  // Header only. The endpoint refuses a key passed in the query string.
  const res = await fetch(`${BASE}/api/admin/assistant-usage`, { headers: { "x-admin-key": ADMIN_KEY } });
  if (!res.ok) return null;
  const j = (await res.json()) as Usage & { ledger: { store: string } };
  return { spentUsd: j.spentUsd, uncertainUsd: j.uncertainUsd, store: j.ledger.store, uncertainCharges: j.uncertainCharges ?? [] };
}

async function main() {
  const before = await usage();
  if (!before) console.warn("! ADMIN_ACCESS_KEY not set, so cost cannot be measured. Accuracy only.\n");
  else console.log(`Ledger: ${before.store}. Month-to-date before this run: $${before.spentUsd.toFixed(4)}\n`);

  let pass = 0;
  const failures: string[] = [];

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

    const proposal = r.proposals.find((p) => p.kind === "apply_preferences");
    const gotHard = (proposal?.hard ?? []).map((h) => h.key).sort();
    const gotSoft = (proposal?.soft ?? []).map((s) => s.key).sort();
    const problems: string[] = [];

    for (const k of c.expect.hardKeys ?? []) if (!gotHard.includes(k)) problems.push(`missing hard ${k}`);
    for (const k of c.expect.softKeys ?? []) if (!gotSoft.includes(k) && !gotHard.includes(k)) problems.push(`missing soft ${k}`);
    if (c.expect.medicalIntent && !r.medicalRedirect) problems.push("medical question was not declined");
    if (!c.expect.medicalIntent && r.medicalRedirect) problems.push("declined a question that was not medical");
    if (c.expect.mustAskQuestion && !/\?/.test(r.text)) problems.push("did not ask a clarifying question");

    // Invented constraints are worse than missing ones: they silently filter.
    const allowed = new Set([...(c.expect.hardKeys ?? []), ...(c.expect.softKeys ?? [])]);
    for (const k of [...gotHard, ...gotSoft]) if (!allowed.has(k)) problems.push(`invented constraint ${k}`);

    // The three surfaces must agree, whatever the model said.
    if (proposal && proposal.matchCount !== (proposal.matchingIds ?? []).length) problems.push("proposal count disagrees with its own set");
    if (!proposal && r.products.some((p) => !r.matchingIds.includes(p.productId))) problems.push("a card is not in the matching set");
    if (r.unconfirmedPrice.some((p) => r.matchingIds.includes(p.productId))) problems.push("a product is both matching and unconfirmed");

    if (problems.length === 0) {
      pass++;
      console.log(`ok   ${c.category} | ${c.note}`);
    } else {
      failures.push(`${c.category} | "${c.text}"\n       ${problems.join("; ")}\n       reply: ${r.text.slice(0, 140)}`);
      console.log(`FAIL ${c.category} | ${c.note}`);
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

  console.log("\nThis measures extraction and cost. It does not measure whether the wording is good; read the replies above.");
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
