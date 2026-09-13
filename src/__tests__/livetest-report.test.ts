import { describe, expect, it } from "vitest";
import { buildReport, passCount, reportStamp, type CaseRecord, type LedgerSnapshot } from "@/domain/livetest-report";

// The report is the only part of a paid run that survives the container. A
// refactor deleted the call that recorded each case and the run of 21:37 wrote
// one row and the line "12 of 1" while the console had all fifteen. These tests
// count rows and check that replies are kept.

function record(over: Partial<CaseRecord> = {}): CaseRecord {
  return { category: "red-light", note: "a case", text: "under $700", reply: "I have read that as price of $700 or less.", problems: [], shown: 3, ...over };
}

const ledger = (over: Partial<LedgerSnapshot> = {}): LedgerSnapshot => ({
  spentUsd: 0,
  uncertainUsd: 0,
  store: "postgres",
  credential: { mode: "proxy" },
  uncertainCharges: [],
  ...over,
});

function rowsOf(report: string): string[] {
  return report
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| ---") && !l.startsWith("| Category") && !l.startsWith("| Reservation"));
}

function quotedReplies(report: string): string[] {
  return report.split("\n").filter((l) => l.startsWith("> "));
}

describe("a complete run", () => {
  const records = [
    record({ note: "budget", problems: [] }),
    record({ note: "coverage", problems: [] }),
    record({ note: "negation", problems: ["missing hard caffeine_mg"] }),
    record({ note: "chiller", reply: "I could not read that reliably. Could you say it another way?", problems: ["the reply could not be used (unreadable_reply); nothing was extracted"] }),
    record({ note: "per serving", problems: ["missing soft function"] }),
  ];

  const report = buildReport({
    records,
    plannedCases: 5,
    before: ledger({ spentUsd: 0.009 }),
    after: ledger({ spentUsd: 0.0145 }),
    now: new Date("2026-09-08T22:00:00Z"),
  });

  it("writes one row per case, passing and failing alike", () => {
    expect(rowsOf(report)).toHaveLength(5);
  });

  it("counts the passes against the number of cases that ran", () => {
    expect(passCount(records)).toBe(2);
    expect(report).toContain("2 of 5 cases matched");
    // The defect that shipped: a denominator that was not the case count.
    expect(report).not.toMatch(/of 1 cases/);
  });

  it("keeps every reply, including the ones that passed", () => {
    const replies = quotedReplies(report);
    expect(replies).toHaveLength(5);
    expect(replies.filter((r) => r.includes("I have read that as"))).toHaveLength(4);
  });

  it("keeps the unreadable reply verbatim rather than dropping the row", () => {
    expect(report).toContain("> I could not read that reliably. Could you say it another way?");
    expect(report).toContain("the reply could not be used (unreadable_reply)");
  });

  it("marks passing cases ok and failing cases with their problems", () => {
    const rows = rowsOf(report);
    expect(rows.filter((r) => r.includes("| ok |"))).toHaveLength(2);
    expect(rows.some((r) => r.includes("missing hard caffeine_mg"))).toBe(true);
    expect(rows.some((r) => r.includes("missing soft function"))).toBe(true);
  });

  it("reports the measured spend and the per-conversation figure", () => {
    expect(report).toContain("Measured spend for 5 single-turn conversations: **$0.0055**");
    expect(report).toContain("Observed cost per conversation: **$0.00110**");
  });

  it("says nothing about stopping early", () => {
    expect(report).not.toMatch(/stopped early/i);
  });
});

describe("a run that stopped early", () => {
  const records = [record({ note: "first" }), record({ note: "second", problems: ["missing hard price"] })];
  const report = buildReport({
    records,
    plannedCases: 15,
    before: ledger({ spentUsd: 0.009, uncertainUsd: 0.00312, uncertainCharges: [{ reservationId: "r_old", reason: "403", heldUsd: 0.00156 }] }),
    after: ledger({
      spentUsd: 0.0098,
      uncertainUsd: 0.00468,
      uncertainCharges: [
        { reservationId: "r_old", reason: "403", heldUsd: 0.00156 },
        { reservationId: "r_new", reason: "The provider returned 502.", heldUsd: 0.00156 },
      ],
    }),
    stoppedEarly: { reason: "a charge could not be measured" },
    now: new Date("2026-09-08T22:00:00Z"),
  });

  it("says so, and says how far it got", () => {
    expect(report).toMatch(/This run stopped early: a charge could not be measured/);
    expect(report).toContain("2 of 15 cases ran");
  });

  it("still writes a row and a reply for every case that ran", () => {
    expect(rowsOf(report).filter((r) => !r.includes("r_old") && !r.includes("r_new"))).toHaveLength(2);
    expect(quotedReplies(report)).toHaveLength(2);
  });

  it("does not rescale the score to the cases it never reached", () => {
    expect(report).toContain("1 of 2 cases matched");
    expect(report).toContain("15 were planned");
  });

  it("lists only the charge this run created", () => {
    expect(report).toContain("`r_new`");
    expect(report).not.toMatch(/\| `r_old` \|/);
    expect(report).toMatch(/1 call\(s\) ended without a confirmed cost/);
  });
});

describe("edge cases", () => {
  it("handles a run where nothing completed", () => {
    const report = buildReport({
      records: [],
      plannedCases: 15,
      before: ledger(),
      after: ledger(),
      stoppedEarly: { reason: "the endpoint was not live" },
      now: new Date("2026-09-08T22:00:00Z"),
    });
    expect(rowsOf(report)).toHaveLength(0);
    expect(quotedReplies(report)).toHaveLength(0);
    expect(report).toContain("0 of 15 cases ran");
    expect(report).toContain("No conversation completed.");
  });

  it("says when cost could not be measured at all", () => {
    const report = buildReport({ records: [record()], plannedCases: 1, before: null, after: null, now: new Date("2026-09-08T22:00:00Z") });
    expect(report).toContain("Not measured: no admin key was available");
    expect(quotedReplies(report)).toHaveLength(1);
  });

  it("names a file that sorts by time and carries no colons", () => {
    const stamp = reportStamp(new Date("2026-09-08T22:03:00Z"));
    expect(stamp).toBe("2026-09-08T22-03");
    expect(stamp).not.toContain(":");
  });
});
