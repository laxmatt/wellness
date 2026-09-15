/**
 * What a retention run could touch, what it must never touch, and what nobody
 * has decided yet.
 *
 * There is no retention policy in this repository and this file does not invent
 * one. It has no default window: a caller states a cutoff or gets an error. The
 * period is the owner's decision and a number chosen here would end up in a
 * published notice as though somebody had decided it.
 *
 * Nothing here deletes. It counts, so a policy can be chosen against real
 * figures instead of guesses, and so the shape of the eventual job is reviewable
 * before it is written.
 *
 * Three different things are needed, and calling all of them "deletion" is how
 * accounting and rate limits get destroyed by a privacy job:
 *
 *   PRUNE       the row exists only to enforce a limit, and once it is past the
 *               window it enforces nothing. Deleting it loses nothing else.
 *   ANONYMISE   the row is financial and has to survive, but its link to a
 *               session does not. The money stays; the identifier goes.
 *   PROTECTED   an operator still has work to do on the row, at any age.
 *
 * And a fourth state that is not an action at all: UNRESOLVED. A question about
 * the row has no answer in this codebase, so nothing may act on it. Sitting in
 * that list is the honest position, not a stalling one: the alternative is a
 * job that deletes rows on a rule nobody has justified.
 */

// The hourly bucket key, as the meter writes it. Imported rather than rewritten
// because a bucket comparison built from a second copy of the format would read
// the wrong rows the moment either copy changed.
import { hourKey } from "@/providers/usage/UsageMeter";

export type RetentionAction = "prune" | "anonymise" | "protected" | "unresolved";

/**
 * Outcomes this application writes. Anything else in the column was written by
 * something else, and is counted separately rather than assumed finished.
 */
export const KNOWN_OUTCOMES = ["open", "billed", "not_billed", "uncertain", "legacy"] as const;

/**
 * Outcomes that mean the accounting on a row is finished. Deliberately an
 * allowlist: a row carrying an outcome nobody here recognises is left alone and
 * reported, rather than swept in by a "not open, not uncertain" predicate.
 * `uncertain` is finished only once `reconciled_at` is set, so it is handled in
 * the predicate rather than listed here.
 */
const SETTLED_OUTCOMES = ["billed", "not_billed", "legacy"] as const;

export type RetentionCategory = {
  id: string;
  table: string;
  action: RetentionAction;
  /** What the row is, in one line. */
  what: string;
  /** Why this action is the right one for it. */
  why: string;
  /** For `unresolved` only: what has to be answered before anything may act. */
  question?: string;
  /**
   * A read-only count. A `prune` or `anonymise` count answers "how many rows
   * would this cutoff reach". A `protected` or `unresolved` count answers "how
   * many rows are there", ignores the cutoff, and is never an eligibility
   * figure.
   */
  count: { sql: string; params: (cutoff: Date) => unknown[] };
};

export const RETENTION_CATEGORIES: RetentionCategory[] = [
  {
    id: "client_buckets",
    table: "assistant_client",
    action: "prune",
    what: "One row per salted IP hash per hour, with a request count.",
    why:
      "It exists to enforce an hourly request limit and nothing else, and the hour it enforces is part of its own key. `reserve` only ever reads the bucket for the hour in progress, so a bucket for an hour that has passed can never be read again. The comparison is strictly less than the cutoff's own hour, so the hour in progress is outside it at every permitted window. This is also the only table holding anything derived from an IP address.",
    // hour_bucket is TEXT in the fixed-width form YYYY-MM-DDTHH, so a string
    // comparison orders it correctly. That is only true because the width is
    // fixed; see hourKey.
    count: {
      sql: "SELECT count(*)::int AS n FROM assistant_client WHERE hour_bucket < $1",
      params: (cutoff) => [hourKey(cutoff)],
    },
  },
  {
    id: "usage_session_link",
    table: "assistant_usage",
    action: "anonymise",
    what: "The session_id column on a settled, reconciled accounting row.",
    why:
      "The row is the ledger and has to survive: it carries the model, the tokens, the cost and the outcome, and deleting it would silently change what the site has spent. The session id is the only part that points at a visitor. Nothing enforcing a limit reads it: the turn limit and the snapshot both read assistant_session.turns, and the only reader of assistant_usage.session_id is listUncertain, whose rows this count excludes. This is the one place where deleting the row would be the wrong answer and dropping a column is the right one.",
    count: {
      sql: `SELECT count(*)::int AS n FROM assistant_usage
             WHERE settled_at < $1
               AND session_id <> ''
               AND (outcome = ANY($2::text[]) OR (outcome = 'uncertain' AND reconciled_at IS NOT NULL))`,
      params: (cutoff) => [cutoff.toISOString(), [...SETTLED_OUTCOMES]],
    },
  },
  {
    id: "open_reservations",
    table: "assistant_usage",
    action: "protected",
    what: "Reservations taken and never settled (outcome 'open').",
    why:
      "Budget is held against them and no outcome was ever recorded. An operator has to close each one against the provider's record, and the session id is part of what identifies it. Age is not a reason to touch one: an old open reservation is more in need of attention, not less.",
    count: {
      sql: "SELECT count(*)::int AS n FROM assistant_usage WHERE outcome = 'open'",
      params: () => [],
    },
  },
  {
    id: "uncertain_charges",
    table: "assistant_usage",
    action: "protected",
    what: "Charges held as uncertain and not yet reconciled (outcome 'uncertain', reconciled_at IS NULL).",
    why:
      "The provider may have billed for these and nobody has checked. They count against the cap until somebody does. Anonymising or pruning one would remove the trail an operator needs to reconcile it.",
    count: {
      sql: "SELECT count(*)::int AS n FROM assistant_usage WHERE outcome = 'uncertain' AND reconciled_at IS NULL",
      params: () => [],
    },
  },
  {
    id: "budget_totals",
    table: "assistant_budget",
    action: "protected",
    what: "Monthly reserved, spent and uncertain totals.",
    why:
      "Aggregates only, with no personal data in them at all, and they are the financial history. Nothing in a retention job has any reason to touch this table.",
    count: {
      sql: "SELECT count(*)::int AS n FROM assistant_budget",
      params: () => [],
    },
  },
  {
    id: "sessions",
    table: "assistant_session",
    action: "unresolved",
    what: "One row per browser-generated session id, with a turn count and a first-seen time.",
    why:
      "A session does not expire. `reserve` increments turns on the existing row whenever the same session_id is presented, with no TTL and no reference to first_seen, and first_seen is written once and read by nothing that enforces anything. So an old row is not evidence of an ended conversation, and deleting one hands its session_id a fresh turn allowance. A first_seen cutoff looks like an age rule and is really a way to reset the limit it is supposed to leave alone. Counted here in full so the size of the table is visible; not classified as eligible for anything.",
    question:
      "When does a session end? Nothing in this codebase says. A last-seen column, an expiry on the row, or a limit keyed on something that does expire would each answer it, and each is a change to how the limit works rather than a retention rule. That decision comes first; this is not it.",
    count: {
      sql: "SELECT count(*)::int AS n FROM assistant_session",
      params: () => [],
    },
  },
  {
    id: "unrecognised_outcomes",
    table: "assistant_usage",
    action: "unresolved",
    what: "Accounting rows carrying an outcome this code does not know.",
    why:
      "Nothing here can say whether such a row is finished, so it is left alone and shown as its own figure. A count above zero means the classification is out of date and these categories should be reviewed before any job is written, not that these rows are safe to sweep up.",
    question: "What wrote this outcome, and is the accounting on the row finished?",
    count: {
      sql: "SELECT count(*)::int AS n FROM assistant_usage WHERE NOT (outcome = ANY($1::text[]))",
      params: () => [[...KNOWN_OUTCOMES]],
    },
  },
];

export type RetentionCounts = Record<string, number>;

export type RetentionReport = {
  cutoff: string;
  generatedAt: string;
  store: string;
  counts: RetentionCounts;
};

// A date earlier than anything this application could have written, and late
// enough that a typo like 1026-06-30 is caught rather than silently counting
// every row. Not a policy: a sanity bound on an argument.
const EARLIEST_CUTOFF_ISO = "2000-01-01";
// ~100 years. Large enough that no real window hits it, small enough that the
// arithmetic stays inside the range a Date can hold.
const MAX_RETAIN_DAYS = 36_500;

export type CutoffResult = { ok: true; cutoff: Date; stated: string } | { ok: false; reason: string };

/**
 * The cutoff, stated explicitly or not at all.
 *
 * Accepts a date, `2026-06-30`, or a number of days to keep, `--retain-days=90`.
 * Rejects everything else, including an absent value, because a retention job
 * that runs with a default is a policy nobody chose.
 */
export function resolveCutoff(input: { before?: string; retainDays?: string }, now: Date): CutoffResult {
  const both = input.before !== undefined && input.retainDays !== undefined;
  if (both) return { ok: false, reason: "Give --before or --retain-days, not both. They are two ways to say one thing and disagreeing about it is not something this should guess at." };

  if (input.before !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.before)) return { ok: false, reason: `--before must be a date like 2026-06-30, not "${input.before}".` };
    const cutoff = new Date(`${input.before}T00:00:00.000Z`);
    if (Number.isNaN(cutoff.getTime())) return { ok: false, reason: `"${input.before}" is not a real date.` };
    // A Date rolls a day that does not exist forward: 2026-02-30 becomes March
    // 2nd, silently moving the cutoff two days and changing which rows a figure
    // describes. Round-tripping is what catches it.
    if (cutoff.toISOString().slice(0, 10) !== input.before) {
      return { ok: false, reason: `There is no ${input.before} in the calendar. A date like that shifts forward into the next month instead of failing, so it is refused rather than silently used.` };
    }
    if (cutoff.getTime() > now.getTime()) return { ok: false, reason: "That cutoff is in the future, which would count every row as eligible. Refusing rather than reporting that." };
    if (input.before < EARLIEST_CUTOFF_ISO) {
      return { ok: false, reason: `A cutoff before ${EARLIEST_CUTOFF_ISO} is earlier than anything this application could have written, so it is more likely a typo than a window. Refusing it.` };
    }
    return { ok: true, cutoff, stated: `before ${input.before}` };
  }

  if (input.retainDays !== undefined) {
    if (!/^\d{1,7}$/.test(input.retainDays)) return { ok: false, reason: `--retain-days must be a whole number of days, not "${input.retainDays}".` };
    const days = Number(input.retainDays);
    if (!Number.isSafeInteger(days)) return { ok: false, reason: `--retain-days must be a whole number of days, not "${input.retainDays}".` };
    if (days < 1) return { ok: false, reason: "--retain-days must be at least 1. Zero would make everything eligible the moment it was written." };
    // Past this the subtraction leaves the range a Date can hold and produces an
    // Invalid Date, which would reach SQL as the string "Invalid Date" or as
    // null rather than as an error.
    if (days > MAX_RETAIN_DAYS) return { ok: false, reason: `--retain-days must be ${MAX_RETAIN_DAYS} or fewer. A window longer than that is not a window.` };
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    if (Number.isNaN(cutoff.getTime())) return { ok: false, reason: `--retain-days=${input.retainDays} does not land on a real date.` };
    return { ok: true, cutoff, stated: `keeping ${days} ${days === 1 ? "day" : "days"}` };
  }

  return {
    ok: false,
    reason:
      "No cutoff given. This has no default on purpose: the retention period is the site owner's decision, and a number invented here would end up in a published notice as though somebody had chosen it. Pass --before=YYYY-MM-DD or --retain-days=N.",
  };
}

const USAGE = "Usage: npm run retention:report -- --retain-days=N | --before=YYYY-MM-DD";

/**
 * The command line. Kept here rather than in the script so that every rule about
 * what an operator may say has a test against it.
 *
 * A repeated flag is an error, not a first-wins or last-wins guess: somebody
 * typing two windows has not decided which one they mean, and a report headed
 * with the wrong one is worse than no report.
 */
export function parseRetentionArgs(argv: string[], now: Date): CutoffResult {
  const values: Record<string, string[]> = { before: [], "retain-days": [] };
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.replace(/^--/, "") : arg.slice(2, eq);
    if (!arg.startsWith("--") || !(name in values)) {
      return { ok: false, reason: `Unrecognised argument: ${arg}\n${USAGE}` };
    }
    if (eq === -1) return { ok: false, reason: `--${name} needs a value, as --${name}=<value>.\n${USAGE}` };
    values[name].push(arg.slice(eq + 1));
  }
  for (const [name, given] of Object.entries(values)) {
    if (given.length > 1) {
      return { ok: false, reason: `--${name} was given ${given.length} times. Say the window once: two of them is not a window anybody chose.` };
    }
  }
  return resolveCutoff({ before: values.before[0], retainDays: values["retain-days"][0] }, now);
}

/**
 * The narrowest thing this needs from a database client.
 *
 * It must be bound to ONE connection. The counts run inside a transaction, and a
 * function that hands each statement to a different pooled connection would put
 * the BEGIN on one connection and the counts on others, where nothing is
 * read-only and nothing is a consistent snapshot.
 */
export type RetentionQuery = (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * The counts run inside this. It is what actually stops a write: Postgres
 * refuses INSERT, UPDATE, DELETE, TRUNCATE and DDL inside a read-only
 * transaction, whatever this file's own checks do or fail to do. REPEATABLE
 * READ additionally means every figure in one report describes one instant,
 * rather than seven counts of a ledger that moved underneath them.
 */
export const BEGIN_READ_ONLY = "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY";
export const END_READ_ONLY = "ROLLBACK";

/**
 * An error this module raised about its own contract, safe to show an operator.
 * Anything else reaching a caller came from the database driver and may name a
 * host, a port, a user or a certificate, so a caller prints a fixed message for
 * those instead.
 */
export class RetentionError extends Error {}

// Anything that changes a row. This is a REVIEW GUARD, not the security
// boundary: it catches a statement that should never have been added to the
// list above, in the place where a reviewer will see it. The boundary is the
// read-only transaction, which is enforced by the database.
const FORBIDDEN = /\b(delete|update|insert|truncate|drop|alter|create|merge|grant)\b/i;

export function assertReadOnly(sql: string): void {
  const normalised = sql.trim().replace(/\s+/g, " ");
  if (!/^select count\(\*\)/i.test(normalised)) {
    throw new RetentionError(`Retention statements may only count rows. Refusing: ${normalised.slice(0, 80)}`);
  }
  if (FORBIDDEN.test(normalised)) {
    throw new RetentionError(`Retention statements may not modify anything. Refusing: ${normalised.slice(0, 80)}`);
  }
}

function readCount(result: { rows: Record<string, unknown>[] } | undefined, id: string): number {
  const rows = result?.rows;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new RetentionError(`Counting ${id} returned ${rows?.length ?? "no"} rows instead of one.`);
  }
  const n = rows[0]?.n;
  // Not defaulted to zero. A count that could not be read and a count of zero
  // are different claims, and the second one is the one that ends up in a
  // decision about what to delete.
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new RetentionError(`Counting ${id} did not return a whole number. Refusing to report it as zero.`);
  }
  return n;
}

/**
 * Count what each category holds. Reads only, and reads only counts: no
 * statement here selects a session id, a client key, an amount or a row.
 *
 * Every count runs inside one read-only repeatable-read transaction, which is
 * rolled back whether or not the counts succeed. There is no commit path.
 */
export async function countRetentionCandidates(query: RetentionQuery, cutoff: Date): Promise<RetentionCounts> {
  await query(BEGIN_READ_ONLY, []);
  try {
    const counts: RetentionCounts = {};
    for (const category of RETENTION_CATEGORIES) {
      assertReadOnly(category.count.sql);
      counts[category.id] = readCount(await query(category.count.sql, category.count.params(cutoff)), category.id);
    }
    return counts;
  } finally {
    // A failed rollback does not change the outcome: the transaction wrote
    // nothing, and the connection is discarded by the caller either way.
    await query(END_READ_ONLY, []).catch(() => {});
  }
}

const HEADINGS: Record<RetentionAction, string> = {
  prune: "Older than the cutoff. A retention job, if one existed, would delete these",
  anonymise: "Older than the cutoff. A job would keep the row and drop the session link",
  protected: "Held whatever the cutoff, because an operator still has work to do on them",
  unresolved: "Not classified, and not eligible for anything. A question has to be answered first",
};

/** The report, as text. Counts only: no identifier, no amount, no row. */
export function formatRetentionReport(report: RetentionReport): string {
  const lines: string[] = [];
  const at = (id: string) => report.counts[id] ?? 0;

  lines.push("Retention dry run. Nothing was deleted, changed or anonymised.");
  lines.push("");
  lines.push(`Store      ${report.store}`);
  lines.push(`Cutoff     ${report.cutoff}`);
  lines.push(`Run at     ${report.generatedAt}`);
  lines.push("");

  for (const action of ["prune", "anonymise", "protected", "unresolved"] as const) {
    const group = RETENTION_CATEGORIES.filter((c) => c.action === action);
    if (group.length === 0) continue;
    lines.push(HEADINGS[action]);
    for (const c of group) {
      lines.push(`  ${String(at(c.id)).padStart(8)}  ${c.table}.${c.id}`);
      lines.push(`            ${c.what}`);
      if (c.question) lines.push(`            Open question: ${c.question}`);
    }
    lines.push("");
  }

  lines.push("No retention job exists. This command reports and does nothing else.");
  lines.push("The period is not set here: it is the site owner's to choose, and this");
  lines.push("run used only the cutoff given on the command line.");
  return lines.join("\n");
}
