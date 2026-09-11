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
 *   - write. Every count runs inside one `BEGIN TRANSACTION ISOLATION LEVEL
 *     REPEATABLE READ, READ ONLY`, which is rolled back on every path. Postgres
 *     refuses a write inside it whatever this code intends. `assertReadOnly` is
 *     a second, weaker check in front of that, for a reviewer's benefit.
 *   - print a session id, a client key, an amount or a row. Counts only.
 *   - print a driver error. Those name hosts, ports, users and certificates, so
 *     a failure here is reported as a fixed sentence and a SQLSTATE code.
 *   - assume a retention period. With no --before or --retain-days it exits
 *     with an error, because the period is the site owner's decision and a
 *     default here would become a number in a published notice that nobody
 *     chose.
 *   - touch open reservations, unreconciled uncertain charges or the monthly
 *     budget totals, and it classifies nothing whose expiry nobody has defined.
 */

import { readFileSync } from "node:fs";
import { Pool, type PoolClient } from "pg";
import { RetentionError, countRetentionCandidates, formatRetentionReport, parseRetentionArgs } from "../src/domain/retention";

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

/**
 * A driver error, said safely. `e.message` from `pg` carries the host, the port,
 * the user or a certificate subject depending on what failed, and this output is
 * the kind of thing that gets pasted into an issue. A SQLSTATE code says what
 * went wrong without saying where.
 */
function operationalMessage(e: unknown): string {
  const code = typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "";
  if (/^(ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET|EPIPE|EAI_AGAIN|CERT_|DEPTH_ZERO|SELF_SIGNED)/.test(code)) {
    return "Could not connect to the database named by DATABASE_URL. Nothing was read and nothing was changed.";
  }
  if (/^[0-9A-Z]{5}$/.test(code)) {
    return `The database refused a statement (SQLSTATE ${code}). Nothing was written: this command only ever counts.`;
  }
  return "The retention report failed while reading the database. Nothing was changed.";
}

async function main() {
  loadEnvLocal();

  const cutoff = parseRetentionArgs(process.argv.slice(2), new Date());
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
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    const present = await client.query<{ present: boolean }>("SELECT to_regclass('assistant_usage') IS NOT NULL AS present");
    if (!present.rows[0]?.present) {
      console.error("This database has no assistant_usage table. Start the application once so it migrates, then run this again.");
      process.exitCode = 3;
      return;
    }

    // Bound to this one connection, because the transaction is.
    const held = client;
    const counts = await countRetentionCandidates((sql, params) => held.query(sql, params), cutoff.cutoff);

    console.log(
      formatRetentionReport({
        cutoff: `${cutoff.cutoff.toISOString()}  (${cutoff.stated})`,
        generatedAt: new Date().toISOString(),
        store: "postgres",
        counts,
      }),
    );
  } catch (e) {
    // A RetentionError is this repository's own complaint about its own
    // contract and says nothing about the connection. Anything else came from
    // the driver.
    console.error(e instanceof RetentionError ? e.message : operationalMessage(e));
    process.exitCode = 1;
  } finally {
    client?.release();
    await pool.end().catch(() => {});
  }
}

main().catch(() => {
  console.error("The retention report failed before it reached the database. Nothing was changed.");
  process.exitCode = 1;
});
