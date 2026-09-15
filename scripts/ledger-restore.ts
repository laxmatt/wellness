/**
 * Put recorded accounting history back into a ledger that lost it.
 *
 *   npm run ledger:restore -- docs/live-test-results/restore/2026-09.json
 *   npm run ledger:restore -- <file> --dry-run
 *
 * This exists because a ledger was destroyed by a test run, and a ledger that
 * silently reads $0.00 afterwards is a clean history rather than a true one.
 * See docs/live-test-results/LEDGER-HISTORY.md.
 *
 * What it will not do:
 *   - invent a row. Every entry comes from the file, and the file cites the
 *     committed report each figure came from.
 *   - hide that a row was reconstructed. Reasons are prefixed RECONSTRUCTED:
 *     and stay that way.
 *   - overwrite anything. An id already present is skipped and reported.
 *   - run against a ledger that already has spend for the month, without an
 *     explicit --force, so it cannot be used to paper over live accounting.
 */

import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { z } from "zod";

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

const Entry = z.object({
  reservationId: z.string().min(1),
  sessionId: z.string().min(1),
  outcome: z.enum(["billed", "uncertain", "not_billed", "abandoned"]),
  costUsd: z.number().min(0),
  settledAt: z.string().min(1),
  reason: z.string().min(1),
  fidelity: z.enum(["exact", "aggregate"]),
  fromReport: z.string().min(1),
  model: z.string().optional(),
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
});

const RestoreFile = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  source: z.string().min(1),
  lostAt: z.string().optional(),
  lostBecause: z.string().optional(),
  entries: z.array(Entry).min(1),
});

async function main() {
  loadEnvLocal();
  const [path, ...flags] = process.argv.slice(2);
  const dryRun = flags.includes("--dry-run");
  const force = flags.includes("--force");

  if (!path) {
    console.error("Usage: npm run ledger:restore -- <file.json> [--dry-run] [--force]");
    process.exit(2);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. This writes to the application's ledger, so it must be named explicitly.");
    process.exit(2);
  }

  const parsed = RestoreFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    console.error(`${path} is not a restore file:\n${z.prettifyError(parsed.error)}`);
    process.exit(2);
  }
  const file = parsed.data;

  console.log(`Month:  ${file.month}`);
  console.log(`Source: ${file.source}`);
  if (file.lostBecause) console.log(`Lost:   ${file.lostBecause}`);
  console.log("");

  const pool = new Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();
  try {
    const tables = await client.query<{ present: boolean }>("SELECT to_regclass('assistant_usage') IS NOT NULL AS present");
    if (!tables.rows[0]?.present) {
      console.error("This ledger has no assistant_usage table yet. Start the application once so it migrates, then run this again.");
      process.exit(3);
    }

    const existing = await client.query<{ spent_usd: string; uncertain_usd: string }>(
      "SELECT spent_usd, uncertain_usd FROM assistant_budget WHERE month = $1",
      [file.month],
    );
    const spent = Number(existing.rows[0]?.spent_usd ?? 0);
    const uncertain = Number(existing.rows[0]?.uncertain_usd ?? 0);
    if ((spent > 0 || uncertain > 0) && !force) {
      console.error(`Refusing: ${file.month} already records $${spent.toFixed(6)} spent and $${uncertain.toFixed(6)} uncertain.`);
      console.error("Restoring into a ledger that already has accounting would double-count it. Pass --force only if you know why.");
      process.exit(3);
    }

    let written = 0;
    let skipped = 0;
    let addedSpent = 0;
    let addedUncertain = 0;

    for (const e of file.entries) {
      const seen = await client.query("SELECT 1 FROM assistant_usage WHERE reservation_id = $1", [e.reservationId]);
      if ((seen.rowCount ?? 0) > 0) {
        console.log(`skip   ${e.reservationId}  already present`);
        skipped++;
        continue;
      }
      const reason = `RECONSTRUCTED: ${e.reason} [${e.fidelity}, from ${e.fromReport}]`;
      console.log(`${dryRun ? "would " : ""}write  ${e.reservationId}  ${e.outcome.padEnd(9)} $${e.costUsd.toFixed(6)}  ${e.fidelity}`);
      if (dryRun) continue;

      await client.query("BEGIN");
      await client.query(
        `INSERT INTO assistant_usage (reservation_id, month, session_id, outcome, reason, model, input_tokens, output_tokens, cost_usd, settled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [e.reservationId, file.month, e.sessionId, e.outcome, reason, e.model ?? null, e.inputTokens ?? 0, e.outputTokens ?? 0, e.costUsd, e.settledAt],
      );
      await client.query("INSERT INTO assistant_budget (month) VALUES ($1) ON CONFLICT (month) DO NOTHING", [file.month]);
      await client.query(
        `UPDATE assistant_budget
            SET spent_usd = spent_usd + $2, uncertain_usd = uncertain_usd + $3
          WHERE month = $1`,
        [file.month, e.outcome === "billed" ? e.costUsd : 0, e.outcome === "uncertain" ? e.costUsd : 0],
      );
      await client.query("COMMIT");
      written++;
      if (e.outcome === "billed") addedSpent += e.costUsd;
      if (e.outcome === "uncertain") addedUncertain += e.costUsd;
    }

    console.log("");
    if (dryRun) {
      console.log(`Dry run. ${file.entries.length - skipped} row(s) would be written, ${skipped} skipped. Nothing was changed.`);
    } else {
      console.log(`Wrote ${written} row(s), skipped ${skipped}.`);
      console.log(`Restored $${addedSpent.toFixed(6)} of recorded spend and $${addedUncertain.toFixed(6)} still held as uncertain.`);
      console.log("The uncertain charges are back unreconciled, which is what they were. Closing them needs the provider's usage record.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
