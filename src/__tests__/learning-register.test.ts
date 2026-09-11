import { describe, expect, it } from "vitest";
import { METRIC_PANELS, SOURCES } from "@/domain/learning/metrics";
import { DEMO_ENTRIES } from "@/domain/learning/demo";
import {
  EVIDENCE_SOURCES,
  MAX_REGISTER_BYTES,
  isMeasured,
  newId,
  parseRegister,
  registerSummary,
  serialiseRegister,
  sortEntries,
  validateEntry,
  type LearningEntry,
} from "@/domain/learning/register";

/**
 * The owner's register, and the rules that keep a note from reading as data.
 *
 * The dashboard has one section with real content and four with none. These
 * checks are mostly about the line between them: an observation is not a
 * finding, a hunch cannot carry a sample size, and an unmeasured question shows
 * no figure rather than a zero.
 */

const entry = (over: Partial<LearningEntry> = {}): LearningEntry => ({
  id: "L-1",
  observation: "Two people went straight to the chips.",
  evidence: { source: "usability_session" },
  proposedChange: "Try naming what each pick is best at on the card.",
  status: "open",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("an entry says where it came from", () => {
  it("needs an observation, a proposed change, a known source and a status", () => {
    expect(validateEntry(entry())).toEqual([]);
    expect(validateEntry({ ...entry(), observation: "  " }).map((p) => p.field)).toContain("observation");
    expect(validateEntry({ ...entry(), proposedChange: "" }).map((p) => p.field)).toContain("proposedChange");
    expect(validateEntry({ ...entry(), status: "finished" as never }).map((p) => p.field)).toContain("status");
    expect(validateEntry({ ...entry(), evidence: { source: "a friend said" as never } }).map((p) => p.field)).toContain("evidence.source");
  });

  it("refuses a sample size or a date range on a source that measures nothing", () => {
    // The rule the whole register turns on. A hunch with "12 sessions" beside
    // it reads as data, and once it reads as data somebody quotes it.
    const withSample = validateEntry(entry({ evidence: { source: "owner_observation", sample: "12 sessions" } }));
    expect(withSample.map((p) => p.field)).toContain("evidence.sample");
    expect(withSample.find((p) => p.field === "evidence.sample")!.message).toContain("read as data it is not");

    const withDates = validateEntry(entry({ evidence: { source: "reasoning", dateRange: "1 to 14 September" } }));
    expect(withDates.map((p) => p.field)).toContain("evidence.dateRange");

    // A reference is fine on anything: it says where to look, not how much was seen.
    expect(validateEntry(entry({ evidence: { source: "owner_observation", reference: "docs/LAUNCH-READINESS.md" } }))).toEqual([]);
  });

  it("accepts both on a source that does measure something", () => {
    expect(validateEntry(entry({ evidence: { source: "search_console", sample: "412 impressions", dateRange: "September" } }))).toEqual([]);
    expect(isMeasured("search_console")).toBe(true);
    expect(isMeasured("owner_observation")).toBe(false);
  });

  it("refuses an outcome on an entry where nothing was done yet", () => {
    for (const status of ["open", "planned", "doing"] as const) {
      const problems = validateEntry(entry({ status, outcome: "It worked." }));
      expect(problems.map((p) => p.field), status).toContain("outcome");
    }
    expect(validateEntry(entry({ status: "done", outcome: "Changed, and the chip now stays." }))).toEqual([]);
    expect(validateEntry(entry({ status: "dropped", outcome: "Decided against: it would need accounts." }))).toEqual([]);
  });

  it("bounds what a field can hold", () => {
    expect(validateEntry(entry({ observation: "x".repeat(2001) }).valueOf() as LearningEntry).map((p) => p.field)).toContain("observation");
  });
});

describe("saving and loading the register", () => {
  it("round-trips through a file unchanged", () => {
    const entries = [entry(), entry({ id: "L-2", status: "done", outcome: "Changed." })];
    const back = parseRegister(serialiseRegister(entries));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.entries).toEqual(entries);
      expect(back.notes).toEqual([]);
    }
  });

  it("leaves out an entry that does not validate, and says which", () => {
    // A backup that quietly repairs itself on the way back in is not a backup.
    const file = JSON.stringify({ version: 1, exportedAt: "2026-09-11T00:00:00.000Z", entries: [entry(), { ...entry({ id: "L-bad" }), observation: "" }] });
    const back = parseRegister(file);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.entries.length).toBe(1);
      expect(back.notes.length).toBe(1);
      expect(back.notes[0]).toContain("Entry 2 was left out");
    }
  });

  it("refuses a file it did not write", () => {
    expect(parseRegister("not json").ok).toBe(false);
    expect(parseRegister(JSON.stringify({ version: 2, entries: [] })).ok).toBe(false);
    expect(parseRegister(JSON.stringify({ version: 1 })).ok).toBe(false);
    const huge = parseRegister(JSON.stringify({ version: 1, entries: [] }) + " ".repeat(MAX_REGISTER_BYTES));
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.reason).toContain("notes, not a database");
  });

  it("gives an entry an id if a hand-edited file dropped it", () => {
    const file = JSON.stringify({ version: 1, entries: [{ ...entry(), id: "" }] });
    const back = parseRegister(file);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.entries[0].id).toMatch(/^L-\d{4}-\d{2}-\d{2}-/);
    expect(newId(new Date("2026-09-11T00:00:00Z"), () => 0.5)).toMatch(/^L-2026-09-11-/);
  });
});

describe("what the register says about itself", () => {
  it("counts measured and unmeasured entries apart, and publishes no score", () => {
    const s = registerSummary([entry(), entry({ id: "2", evidence: { source: "search_console" }, status: "done", outcome: "x" }), entry({ id: "3", status: "dropped" })]);
    expect(s.total).toBe(3);
    expect(s.measured).toBe(1);
    expect(s.unmeasured).toBe(2);
    expect(s.byStatus.open).toBe(1);
    expect(s.byStatus.done).toBe(1);
    expect(s.byStatus.dropped).toBe(1);
    // Nothing resembling a rating, health figure or percentage.
    expect(Object.keys(s)).toEqual(["total", "demo", "byStatus", "measured", "unmeasured"]);
  });

  it("counts example entries apart from the owner's own", () => {
    const s = registerSummary([entry(), ...DEMO_ENTRIES]);
    expect(s.total).toBe(1);
    expect(s.demo).toBe(DEMO_ENTRIES.length);
  });

  it("puts what is still open before what is settled", () => {
    const order = sortEntries([entry({ id: "a", status: "done", outcome: "x" }), entry({ id: "b", status: "open" }), entry({ id: "c", status: "planned" })]).map((e) => e.id);
    expect(order).toEqual(["b", "c", "a"]);
  });
});

describe("the example entries", () => {
  it("are all marked, all valid, and all say they are examples", () => {
    for (const e of DEMO_ENTRIES) {
      expect(e.demo, e.id).toBe(true);
      expect(validateEntry(e), e.id).toEqual([]);
      expect(e.evidence.reference, e.id).toContain("Example entry");
    }
  });

  it("claim no measurement, because this project has none to draw on", () => {
    for (const e of DEMO_ENTRIES) {
      expect(isMeasured(e.evidence.source), e.id).toBe(false);
      expect(e.evidence.sample, e.id).toBeUndefined();
      expect(e.evidence.dateRange, e.id).toBeUndefined();
    }
  });
});

describe("the four questions with no figures", () => {
  it("are all unconnected, because nothing in this project records anything", () => {
    for (const panel of METRIC_PANELS) {
      expect(panel.status, panel.id).toBe("not_connected");
      expect(panel.why.length, panel.id).toBeGreaterThan(0);
      expect(panel.toConnect.length, panel.id).toBeGreaterThan(0);
      expect(panel.neverStored.length, panel.id).toBeGreaterThan(0);
    }
    for (const source of SOURCES) expect(source.connected, source.id).toBe(false);
  });

  it("names a real event contract wherever it names one at all", () => {
    // The events exist in src/domain/analytics.ts; nothing emits them. A panel
    // citing an event this project does not define would be inventing the
    // groundwork as well as the figure.
    const analytics = new Set([
      "category_viewed",
      "filter_selected",
      "matcher_submitted",
      "preferences_extracted",
      "product_recommended",
      "recommendation_overridden",
      "product_compared",
      "retailer_clicked",
      "comparison_saved",
    ]);
    for (const panel of METRIC_PANELS) {
      if (!panel.contract) continue;
      for (const name of panel.contract.split(",").map((s) => s.trim().replace(/\s*\(.*\)$/, ""))) {
        expect(analytics.has(name), `${panel.id} cites ${name}`).toBe(true);
      }
    }
  });

  it("never promises to keep anything a visitor typed, or a purchase", () => {
    const clickouts = METRIC_PANELS.find((p) => p.id === "clickouts")!;
    expect(clickouts.neverStored.join(" ")).toContain("must never be presented as a sale");
    const friction = METRIC_PANELS.find((p) => p.id === "friction")!;
    expect(friction.neverStored.join(" ")).toContain("What anybody typed");
    expect(friction.wouldComeFrom).toContain("Counts only");
  });
});

describe("the vocabularies the page offers", () => {
  it("offers no source the validator would refuse", () => {
    for (const s of EVIDENCE_SOURCES) {
      expect(validateEntry(entry({ evidence: { source: s.id } })), s.id).toEqual([]);
    }
  });
});
