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

const CATEGORY = "cold-plunge";
const TEXT = "A tub with a chiller, up to $5,000";

// What the operator asked to see: the chiller asserted as true, and a budget
// admitting no more than $5,000. Both are judged from the composed reply's
// proposal, in the units the engine compares, not from the model's own words.
const BUDGET_CENTS = 500000;

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

// A budget is judged by operator and amount together, because `lt 500000` and
// `lte 499999` admit the same set and `lt 499999` does not.
function admittedMaximum(op: string | undefined, value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (op === "lte") return value;
  if (op === "lt") return value - 1;
  return null;
}

function judge(r: Reply): string[] {
  const problems: string[] = [];
  const applied = r.proposals.find((p) => p.kind === "apply_preferences");
  const hard = applied?.hard ?? [];
  const soft = applied?.soft ?? [];

  const chillerHard = hard.find((c) => c.key === "chiller_included");
  if (!chillerHard) {
    const chillerSoft = soft.find((c) => c.key === "chiller_included");
    problems.push(
      chillerSoft
        ? `chiller_included came back as a preference (${chillerSoft.direction}), not as chiller = true`
        : "no chiller_included constraint at all",
    );
  } else if (!(chillerHard.op === "eq" && chillerHard.value === true)) {
    problems.push(`chiller_included is ${chillerHard.op} ${JSON.stringify(chillerHard.value)}, not eq true`);
  }

  const price = hard.find((c) => c.key === "price");
  if (!price) problems.push("no price constraint");
  else {
    const max = admittedMaximum(price.op, price.value);
    if (max === null) problems.push(`price is ${price.op} ${JSON.stringify(price.value)}, which sets no upper bound in cents`);
    else if (max > BUDGET_CENTS) problems.push(`price admits up to ${max} cents, above the ${BUDGET_CENTS} asked for`);
  }

  return problems;
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

  const problems = r.failure ? [`the reply could not be used (${r.failure}); nothing was extracted`] : judge(r);
  const record: CaseRecord = {
    category: CATEGORY,
    note: "strict structured outputs, chiller plus budget",
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
