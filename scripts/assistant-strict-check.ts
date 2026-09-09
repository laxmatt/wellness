/**
 * One request, with strict structured outputs on.
 *
 *   npm run assistant:strictcheck
 *
 * The schema in `intentJsonSchema()` is written to constraints taken from
 * secondary sources, because the official documentation is unreachable from
 * this container. Non-paid tests check the schema's shape and check that every
 * value branch it offers is one the validator accepts. What they cannot check
 * is whether this account and this model compile the schema at all.
 *
 * That question costs one request and is asymmetric: a schema strict mode
 * refuses comes back as a 400 before inference, which `statusError` settles as
 * `not_billed`. A schema it accepts costs one ordinary call.
 *
 * It sends one sentence, and it stops. No retry, no second case. The result
 * goes into docs/live-test-results/ because the container is disposable.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

// One named case per authorized request. Each is judged by the same
// `checkReply` the 15-case suite uses, against the same expectation, so a
// single request cannot be scored more leniently than the suite would score it.
type Named = { category: string; text: string; note: string; expect: ExpectedCase };

const CASES: Record<string, Named> = {
  chiller: {
    category: "cold-plunge",
    text: "A tub with a chiller, up to $5,000",
    note: "strict structured outputs, chiller plus budget",
    expect: {
      hard: [
        { key: "chiller_included", ops: ["eq"], value: true },
        { key: "price", ops: ["lt", "lte"], admitsAtMost: 500000, orAtMost: 499999 },
      ],
    },
  },
  // Copied from the 15-case suite unchanged. "Under $2 a serving" admits at
  // most 199 minor units, so lt 200 and lte 199 are the same request and lte
  // 200 is a different one.
  drinks: {
    category: "wellness-drinks",
    text: "Zero sugar electrolytes under $2 a serving",
    note: "strict structured outputs, zero sugar plus function plus budget",
    expect: {
      hard: [
        { key: "sugar_g", ops: ["lte", "eq", "lt"], atMost: 1 },
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
      ],
      soft: [{ key: "function" }],
      alsoReasonable: ["format", "electrolytes_mg"],
    },
  },
};

const CASE_NAME = process.argv[2] ?? "chiller";
const SELECTED = CASES[CASE_NAME];
if (!SELECTED) {
  console.error(`Unknown case "${CASE_NAME}". Known: ${Object.keys(CASES).join(", ")}`);
  process.exit(2);
}
const { category: CATEGORY, text: TEXT } = SELECTED;

type Constraint = { key: string; op?: string; direction?: string; value?: unknown; weight?: number };

type Reply = {
  text: string;
  mode: string;
  failure?: string;
  matchSummary?: string;
  matchingIds: string[];
  proposals: { kind: string; hard?: Constraint[]; soft?: Constraint[] }[];
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

// The suite's own checker, so this cannot drift from how the suite scores.
function judge(r: Reply): string[] {
  return checkReply(r as CheckableReply, SELECTED.expect);
}

async function main() {
  const before = await usage();
  if (!before) {
    console.error("ADMIN_ACCESS_KEY is not set, so the cost of this request cannot be measured. Stopping before spending anything.");
    process.exit(2);
  }
  console.log(`Ledger: ${before.store}. Spent this month: $${before.spentUsd.toFixed(6)}. Held uncertain: $${before.uncertainUsd.toFixed(6)}`);
  console.log(`Sending one request with strict structured outputs: "${TEXT}"\n`);

  const res = await fetch(`${BASE}/api/assistant`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: `s_strictcheck_${Date.now()}`,
      categoryId: CATEGORY,
      messages: [{ role: "user", text: TEXT }],
      hard: [],
      soft: [],
    }),
  });

  const after = await usage();
  const spent = after && before ? after.spentUsd - before.spentUsd : null;
  const newlyUncertain = after ? after.uncertainCharges.filter((u) => !before.uncertainCharges.some((b) => b.reservationId === u.reservationId)) : [];

  if (!res.ok) {
    console.error(`HTTP ${res.status} from the application.`);
    console.error(`Spend for this attempt: ${spent === null ? "unknown" : `$${spent.toFixed(6)}`}. Newly uncertain: ${newlyUncertain.length}`);
    writeReport({
      records: [],
      plannedCases: 1,
      before,
      after,
      stoppedEarly: { reason: `the application returned HTTP ${res.status}` },
    });
    process.exit(3);
  }

  const r = (await res.json()) as Reply;
  console.log(`mode: ${r.mode}${r.failure ? `  failure: ${r.failure}` : ""}`);
  console.log(`reply: ${r.text}`);
  console.log(`match summary: ${r.matchSummary ?? "(none)"}`);
  const applied = r.proposals.find((p) => p.kind === "apply_preferences");
  console.log(`hard: ${JSON.stringify(applied?.hard ?? [])}`);
  console.log(`soft: ${JSON.stringify(applied?.soft ?? [])}`);
  // The engine's own answer for those constraints, named rather than counted,
  // so each product can be checked against the sentence by hand.
  console.log(`matching: ${JSON.stringify(r.matchingIds)}`);

  const problems = r.failure ? [`the reply could not be used (${r.failure}); nothing was extracted`] : judge(r);
  const record: CaseRecord = {
    category: CATEGORY,
    note: SELECTED.note,
    text: TEXT,
    reply: r.text,
    problems,
    shown: r.matchingIds.length,
  };

  console.log(`\n${problems.length === 0 ? "ok" : `FAIL: ${problems.join("; ")}`}`);
  if (spent !== null) console.log(`Measured cost of this request: $${spent.toFixed(6)}`);
  if (newlyUncertain.length > 0) {
    console.log(`\n${newlyUncertain.length} charge(s) could not be measured and hold budget:`);
    for (const u of newlyUncertain) console.log(`  ${u.reservationId}  $${u.heldUsd.toFixed(6)}  ${u.reason}`);
  }

  const path = writeReport({ records: [record], plannedCases: 1, before, after });
  console.log(`\nReport written to ${path}.`);
  process.exit(problems.length === 0 ? 0 : 1);
}

function writeReport(args: Parameters<typeof buildReport>[0]): string {
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
