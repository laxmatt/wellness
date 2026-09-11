/**
 * Count what a retention policy would reach. Delete nothing.
 *
 *   npm run retention:report -- --retain-days=90
 *   npm run retention:report -- --before=2026-06-30
 *
 * There is no retention policy in this repository, no scheduled job, and no
 * deletion code. This exists so a policy can be chosen against real figures.
 *
 * What it will not do:
 *   - delete, update or anonymise anything. Every statement it sends is a
 *     `SELECT count(*)`, and `assertReadOnly` refuses any that is not.
 *   - print a session id, a client key, an amount or a row. Counts only.
 *   - assume a retention period. With no --before or --retain-days it exits
 *     with an error, because the period is the site owner's decision and a
 *     default here would become a number in a published notice that nobody
 *     chose.
 *   - touch open reservations, unreconciled uncertain charges or the monthly
 *     budget totals. Those are reported in full and never treated as eligible.
 */

import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { countRetentionCandidates, formatRetentionReport, resolveCutoff } from "../src/domain/retention";

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

function flag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

async function main() {
  loadEnvLocal();
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !a.startsWith("--before=") && !a.startsWith("--retain-days="));
  if (unknown.length > 0) {
    console.error(`Unrecognised argument: ${unknown[0]}`);
    console.error("Usage: npm run retention:report -- --retain-days=N | --before=YYYY-MM-DD");
    process.exit(2);
  }

  const cutoff = resolveCutoff({ before: flag(args, "before"), retainDays: flag(args, "retain-days") }, new Date());
  if (!cutoff.ok) {
    console.error(cutoff.reason);
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. This reads the application's ledger, so it must be named explicitly.");
    process.exit(2);
  }

  const pool = new Pool({ connectionString: url, max: 2 });
  const client = await pool.connect();
  try {
    const present = await client.query<{ present: boolean }>("SELECT to_regclass('assistant_usage') IS NOT NULL AS present");
    if (!present.rows[0]?.present) {
      console.error("This database has no assistant_usage table. Start the application once so it migrates, then run this again.");
      process.exit(3);
    }

    const counts = await countRetentionCandidates((sql, params) => client.query(sql, params), cutoff.cutoff);
    console.log(
      formatRetentionReport({
        cutoff: `${cutoff.cutoff.toISOString()}  (${cutoff.stated})`,
        generatedAt: new Date().toISOString(),
        store: "postgres",
        counts,
      }),
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
