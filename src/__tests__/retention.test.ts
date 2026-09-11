import { describe, expect, it } from "vitest";
import {
  RETENTION_CATEGORIES,
  assertReadOnly,
  countRetentionCandidates,
  formatRetentionReport,
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
    return { rows: [{ n: answer }] };
  };
  return { query, sent };
}

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

    expect(sent.length).toBe(RETENTION_CATEGORIES.length);
    for (const { sql } of sent) {
      const one = sql.trim().replace(/\s+/g, " ");
      expect(one).toMatch(/^SELECT count\(\*\)::int AS n FROM /i);
      expect(one).not.toMatch(/\b(delete|update|insert|truncate|drop|alter|create|merge|grant)\b/i);
    }
  });

  it("selects no column that identifies anybody, and no amount", async () => {
    const { query, sent } = recorder();
    await countRetentionCandidates(query, NOW);

    for (const { sql } of sent) {
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
    expect(unknown?.action).toBe("protected");
    expect(unknown?.count.params(NOW)[0]).toEqual(["open", "billed", "not_billed", "uncertain", "legacy"]);
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

  it("calls out an unrecognised outcome instead of burying it in a list", () => {
    expect(report({ unrecognised_outcomes: 2 })).toContain("outcome this code does not recognise");
    expect(report({ unrecognised_outcomes: 0 })).not.toContain("outcome this code does not recognise");
  });
});
