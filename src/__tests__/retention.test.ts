import { describe, expect, it } from "vitest";
import {
  BEGIN_READ_ONLY,
  END_READ_ONLY,
  RETENTION_CATEGORIES,
  assertReadOnly,
  countRetentionCandidates,
  formatRetentionReport,
  parseRetentionArgs,
  resolveCutoff,
  type RetentionQuery,
} from "@/domain/retention";

const NOW = new Date("2026-09-11T12:00:00.000Z");

// Every statement the counting layer sends, recorded. Nothing executes: the
// point is to inspect the SQL itself, which is the only place a retention
// report could start deleting or start reading personal data.
function recorder(answer = 0): { query: RetentionQuery; sent: { sql: string; params: unknown[] }[] } {
  const sent: { sql: string; params: unknown[] }[] = [];
  const query: RetentionQuery = async (sql, params) => {
    sent.push({ sql, params });
    return { rows: sql === BEGIN_READ_ONLY || sql === END_READ_ONLY ? [] : [{ n: answer }] };
  };
  return { query, sent };
}

/** Just the counting statements, without the transaction control around them. */
const counting = (sent: { sql: string; params: unknown[] }[]) => sent.filter((s) => s.sql !== BEGIN_READ_ONLY && s.sql !== END_READ_ONLY);

describe("the cutoff has to be stated", () => {
  it("refuses with no cutoff at all, and says why there is no default", () => {
    const r = resolveCutoff({}, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("owner's decision");
  });

  it("refuses both forms at once rather than picking one", () => {
    const r = resolveCutoff({ before: "2026-06-30", retainDays: "90" }, NOW);
    expect(r.ok).toBe(false);
  });

  it("refuses a cutoff in the future, which would make everything eligible", () => {
    const r = resolveCutoff({ before: "2027-01-01" }, NOW);
    expect(r.ok).toBe(false);
  });

  it("refuses text that is not a date or a whole number of days", () => {
    expect(resolveCutoff({ before: "last June" }, NOW).ok).toBe(false);
    expect(resolveCutoff({ before: "2026-6-3" }, NOW).ok).toBe(false);
    expect(resolveCutoff({ retainDays: "ninety" }, NOW).ok).toBe(false);
    expect(resolveCutoff({ retainDays: "-5" }, NOW).ok).toBe(false);
    expect(resolveCutoff({ retainDays: "0" }, NOW).ok).toBe(false);
  });

  it("accepts an explicit date and an explicit number of days", () => {
    const byDate = resolveCutoff({ before: "2026-06-30" }, NOW);
    expect(byDate.ok).toBe(true);
    if (byDate.ok) expect(byDate.cutoff.toISOString()).toBe("2026-06-30T00:00:00.000Z");

    const byDays = resolveCutoff({ retainDays: "90" }, NOW);
    expect(byDays.ok).toBe(true);
    if (byDays.ok) expect(byDays.cutoff.toISOString()).toBe("2026-06-13T12:00:00.000Z");
  });
});

describe("the report cannot change anything", () => {
  it("sends nothing but counts", async () => {
    const { query, sent } = recorder();
    await countRetentionCandidates(query, NOW);

    expect(counting(sent).length).toBe(RETENTION_CATEGORIES.length);
    for (const { sql } of counting(sent)) {
      const one = sql.trim().replace(/\s+/g, " ");
      expect(one).toMatch(/^SELECT count\(\*\)::int AS n FROM /i);
      expect(one).not.toMatch(/\b(delete|update|insert|truncate|drop|alter|create|merge|grant)\b/i);
    }
  });

  it("selects no column that identifies anybody, and no amount", async () => {
    const { query, sent } = recorder();
    await countRetentionCandidates(query, NOW);

    for (const { sql } of counting(sent)) {
      // The select list is everything before the first FROM. A session id or a
      // client key may appear in a WHERE clause; neither may be returned.
      const selectList = sql.trim().replace(/\s+/g, " ").split(/ FROM /i)[0];
      expect(selectList).toBe("SELECT count(*)::int AS n");
      expect(sql).not.toMatch(/\bcost_usd\b|\bspent_usd\b|\buncertain_usd\b|\breason\b/);
    }
  });

  it("refuses a statement that is not a count, whoever wrote it", () => {
    expect(() => assertReadOnly("DELETE FROM assistant_client WHERE hour_bucket < $1")).toThrow(/only count rows/i);
    expect(() => assertReadOnly("SELECT session_id FROM assistant_usage")).toThrow(/only count rows/i);
    expect(() => assertReadOnly("SELECT count(*) FROM assistant_usage; DROP TABLE assistant_budget")).toThrow(/may not modify/i);
    expect(() => assertReadOnly("SELECT count(*)::int AS n FROM assistant_budget")).not.toThrow();
  });
});

describe("what a policy may reach, and what it may not", () => {
  it("protects open reservations, unreconciled uncertain charges and the budget totals", () => {
    const protectedIds = RETENTION_CATEGORIES.filter((c) => c.action === "protected").map((c) => c.id);
    expect(protectedIds).toContain("open_reservations");
    expect(protectedIds).toContain("uncertain_charges");
    expect(protectedIds).toContain("budget_totals");
  });

  it("counts protected rows in full, ignoring the cutoff, so their figure is never an eligibility figure", () => {
    const early = new Date("2020-01-01T00:00:00.000Z");
    const late = new Date("2026-09-01T00:00:00.000Z");
    for (const c of RETENTION_CATEGORIES.filter((c) => c.action === "protected")) {
      // Two cutoffs five years apart, the same parameters: the date is not an
      // input to a protected count, so its figure can never be read as "this
      // many rows are now eligible".
      expect(c.count.params(early)).toEqual(c.count.params(late));
      for (const p of c.count.params(early)) expect(JSON.stringify(p)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("never proposes deleting or anonymising a row in the financial totals table", () => {
    for (const c of RETENTION_CATEGORIES.filter((c) => c.action !== "protected")) {
      expect(c.count.sql).not.toContain("assistant_budget");
    }
  });

  it("leaves the ledger row alone and takes only the session link", () => {
    const usage = RETENTION_CATEGORIES.find((c) => c.id === "usage_session_link");
    expect(usage?.action).toBe("anonymise");
    // An open reservation or an uncertain charge nobody has reconciled must not
    // be reachable by this count, at any age.
    expect(usage?.count.sql).toContain("outcome = ANY($2::text[])");
    expect(usage?.count.sql).toContain("reconciled_at IS NOT NULL");
    expect(usage?.count.params(NOW)[1]).toEqual(["billed", "not_billed", "legacy"]);
  });

  it("holds back an accounting row whose outcome it does not recognise", () => {
    const unknown = RETENTION_CATEGORIES.find((c) => c.id === "unrecognised_outcomes");
    expect(unknown?.action).toBe("unresolved");
    expect(unknown?.question).toBeTruthy();
    expect(unknown?.count.params(NOW)[0]).toEqual(["open", "billed", "not_billed", "uncertain", "legacy"]);
  });

  // reserve() increments assistant_session.turns on the existing row whenever
  // the same session_id is presented, with no TTL, and reads nothing from
  // first_seen. So an old row is not an ended conversation, and deleting one
  // gives its session_id a fresh turn allowance. An earlier version of this
  // module pruned on first_seen; that was a rate limit reset wearing a
  // retention rule's clothes.
  it("will not date-classify a session, because nothing in the code says when one ends", () => {
    const sessions = RETENTION_CATEGORIES.find((c) => c.id === "sessions");
    expect(sessions?.action).toBe("unresolved");
    expect(sessions?.question).toBeTruthy();
    expect(sessions?.count.sql).not.toContain("first_seen");
    expect(sessions?.count.params(new Date("2001-01-01T00:00:00.000Z"))).toEqual(sessions?.count.params(NOW));
  });

  it("proposes nothing at all against the session table", () => {
    for (const c of RETENTION_CATEGORIES.filter((c) => c.action === "prune" || c.action === "anonymise")) {
      expect(c.count.sql).not.toContain("assistant_session");
    }
  });

  // The bucket key carries its own hour and reserve only ever reads the hour in
  // progress, so a strict comparison is what keeps the live bucket out at the
  // shortest window anybody can ask for.
  it("never reaches the hour in progress, even at the shortest window", () => {
    const now = new Date("2026-09-11T20:45:00.000Z");
    const shortest = resolveCutoff({ retainDays: "1" }, now);
    expect(shortest.ok).toBe(true);
    if (!shortest.ok) return;
    const buckets = RETENTION_CATEGORIES.find((c) => c.id === "client_buckets");
    expect(buckets?.count.sql).toContain("hour_bucket < $1");
    expect(buckets?.count.params(shortest.cutoff)).toEqual(["2026-09-10T20"]);
  });

  it("reaches client buckets by the hour key the meter actually writes", () => {
    const buckets = RETENTION_CATEGORIES.find((c) => c.id === "client_buckets");
    expect(buckets?.count.params(new Date("2026-06-30T07:31:00.000Z"))).toEqual(["2026-06-30T07"]);
  });
});

describe("the printed report", () => {
  const report = (counts: Record<string, number>) =>
    formatRetentionReport({ cutoff: "2026-06-13T12:00:00.000Z  (keeping 90 days)", generatedAt: NOW.toISOString(), store: "postgres", counts });

  it("says plainly that it did nothing", () => {
    const text = report({ client_buckets: 4 });
    expect(text).toContain("Nothing was deleted, changed or anonymised.");
    expect(text).toContain("No retention job exists.");
  });

  it("prints a figure for every category and nothing else about any row", () => {
    const counts = Object.fromEntries(RETENTION_CATEGORIES.map((c, i) => [c.id, i + 1]));
    const text = report(counts);
    for (const c of RETENTION_CATEGORIES) expect(text).toContain(c.table);
    // No row content can reach the output: the formatter is given counts only,
    // and this is the type that says so.
    expect(Object.values(counts).every((v) => typeof v === "number")).toBe(true);
  });

  it("prints the open question beside anything it refused to classify", () => {
    const text = report({});
    expect(text).toContain("Not classified, and not eligible for anything");
    expect(text).toContain("Open question: When does a session end?");
    // And says which figures are eligibility figures and which are not.
    expect(text).toContain("Older than the cutoff.");
    expect(text).toContain("Held whatever the cutoff");
  });
});

describe("cutoff boundaries", () => {
  it("refuses a date that is not in the calendar, rather than rolling it forward", () => {
    // new Date("2026-02-30T00:00:00Z") is March 2nd. Accepting it would move the
    // cutoff two days and describe different rows than the operator asked about.
    for (const bad of ["2026-02-30", "2026-06-31", "2026-04-31", "2027-02-29"]) {
      const r = resolveCutoff({ before: bad }, new Date("2028-01-01T00:00:00.000Z"));
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason).toContain("calendar");
    }
  });

  it("accepts the real end of a month, including a leap day", () => {
    for (const good of ["2026-02-28", "2024-02-29", "2026-06-30", "2026-12-31"]) {
      const r = resolveCutoff({ before: good }, new Date("2028-01-01T00:00:00.000Z"));
      expect(r.ok, good).toBe(true);
      if (r.ok) expect(r.cutoff.toISOString().slice(0, 10)).toBe(good);
    }
  });

  it("refuses a date so early it is a typo rather than a window", () => {
    expect(resolveCutoff({ before: "1026-06-30" }, NOW).ok).toBe(false);
    expect(resolveCutoff({ before: "0001-01-01" }, NOW).ok).toBe(false);
    expect(resolveCutoff({ before: "2000-01-01" }, NOW).ok).toBe(true);
  });

  it("refuses a retention window that leaves the range a date can hold", () => {
    // Date.now() - 1e12 * 86400000 is an Invalid Date, which reaches SQL as a
    // string or a null rather than as an error.
    for (const bad of ["999999999999", "100000000", "99999999"]) {
      const r = resolveCutoff({ retainDays: bad }, NOW);
      expect(r.ok, bad).toBe(false);
    }
    const max = resolveCutoff({ retainDays: "36500" }, NOW);
    expect(max.ok).toBe(true);
    if (max.ok) expect(Number.isNaN(max.cutoff.getTime())).toBe(false);
    expect(resolveCutoff({ retainDays: "36501" }, NOW).ok).toBe(false);
  });

  it("never returns an invalid date as a success", () => {
    for (const days of ["1", "90", "365", "36500"]) {
      const r = resolveCutoff({ retainDays: days }, NOW);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.cutoff.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

describe("the command line", () => {
  it("refuses a window stated twice instead of quietly using one of them", () => {
    const r = parseRetentionArgs(["--retain-days=90", "--retain-days=5"], NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("given 2 times");

    expect(parseRetentionArgs(["--before=2026-06-30", "--before=2026-06-30"], NOW).ok).toBe(false);
  });

  it("refuses an unrecognised argument and a flag with no value", () => {
    expect(parseRetentionArgs(["--purge"], NOW).ok).toBe(false);
    expect(parseRetentionArgs(["--retain-days"], NOW).ok).toBe(false);
    expect(parseRetentionArgs(["90"], NOW).ok).toBe(false);
    expect(parseRetentionArgs(["--force", "--retain-days=90"], NOW).ok).toBe(false);
  });

  it("refuses both forms together, and accepts either alone", () => {
    expect(parseRetentionArgs(["--before=2026-06-30", "--retain-days=90"], NOW).ok).toBe(false);
    expect(parseRetentionArgs([], NOW).ok).toBe(false);
    expect(parseRetentionArgs(["--retain-days=90"], NOW).ok).toBe(true);
    expect(parseRetentionArgs(["--before=2026-06-30"], NOW).ok).toBe(true);
  });
});

describe("the counts run in a transaction that cannot write", () => {
  it("opens read-only and repeatable-read, and rolls back", async () => {
    const { query, sent } = recorder();
    await countRetentionCandidates(query, NOW);

    expect(sent[0].sql).toBe(BEGIN_READ_ONLY);
    expect(sent[0].sql).toContain("READ ONLY");
    expect(sent[0].sql).toContain("REPEATABLE READ");
    expect(sent.at(-1)?.sql).toBe(END_READ_ONLY);
    // There is no commit path at all.
    expect(sent.some((s) => /commit/i.test(s.sql))).toBe(false);
  });

  it("rolls back when a count fails, instead of leaving the transaction open", async () => {
    const sent: string[] = [];
    const query: RetentionQuery = async (sql) => {
      sent.push(sql);
      if (sql.includes("assistant_client")) throw new Error("boom");
      return { rows: [{ n: 0 }] };
    };
    await expect(countRetentionCandidates(query, NOW)).rejects.toThrow("boom");
    expect(sent.at(-1)).toBe(END_READ_ONLY);
  });

  it("still reports the count failure when the rollback also fails", async () => {
    const query: RetentionQuery = async (sql) => {
      if (sql === BEGIN_READ_ONLY) return { rows: [] };
      throw new Error(sql === END_READ_ONLY ? "connection gone" : "count failed");
    };
    await expect(countRetentionCandidates(query, NOW)).rejects.toThrow("count failed");
  });
});

describe("a count that could not be read is not a zero", () => {
  const withRows = (rows: Record<string, unknown>[]): RetentionQuery => async (sql) =>
    sql === BEGIN_READ_ONLY || sql === END_READ_ONLY ? { rows: [] } : { rows };

  it("refuses an empty result rather than reporting nothing eligible", async () => {
    await expect(countRetentionCandidates(withRows([]), NOW)).rejects.toThrow(/instead of one/);
  });

  it("refuses a null, a string or a fraction where a count belongs", async () => {
    await expect(countRetentionCandidates(withRows([{ n: null }]), NOW)).rejects.toThrow(/whole number/);
    await expect(countRetentionCandidates(withRows([{ n: "12" }]), NOW)).rejects.toThrow(/whole number/);
    await expect(countRetentionCandidates(withRows([{ n: 1.5 }]), NOW)).rejects.toThrow(/whole number/);
    await expect(countRetentionCandidates(withRows([{ n: -1 }]), NOW)).rejects.toThrow(/whole number/);
    await expect(countRetentionCandidates(withRows([{}]), NOW)).rejects.toThrow(/whole number/);
  });

  it("accepts a real zero", async () => {
    const counts = await countRetentionCandidates(withRows([{ n: 0 }]), NOW);
    expect(Object.values(counts).every((v) => v === 0)).toBe(true);
    expect(Object.keys(counts).length).toBe(RETENTION_CATEGORIES.length);
  });
});
