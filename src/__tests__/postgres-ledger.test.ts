import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresUsageStore } from "@/providers/usage/PostgresUsageStore";
import { UsageMeter, monthKey, type MeterConfig } from "@/providers/usage/UsageMeter";

// These run against a real Postgres. The in-memory store cannot show that the
// conditional UPDATE actually serialises, nor that an upgrade from the previous
// schema keeps existing rows. Set TEST_DATABASE_URL to enable them.
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

const config: MeterConfig = {
  monthlyCapUsd: 25,
  sessionTurnLimit: 3,
  clientHourlyLimit: 100,
  inputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  maxInputTokens: 6000,
  maxOutputTokens: 500,
  estimateSafetyFactor: 1.3,
};

// Exactly the schema the previous released version created, so the upgrade
// path is tested against the real thing rather than an approximation of it.
const V1_SCHEMA = `
CREATE TABLE assistant_budget (
  month           TEXT PRIMARY KEY,
  reserved_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
  spent_usd       NUMERIC(12,6) NOT NULL DEFAULT 0
);
CREATE TABLE assistant_session (
  session_id      TEXT PRIMARY KEY,
  turns           INTEGER NOT NULL DEFAULT 0,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE assistant_usage (
  id              BIGSERIAL PRIMARY KEY,
  reservation_id  TEXT UNIQUE NOT NULL,
  month           TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  model           TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
  settled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX assistant_usage_month_idx ON assistant_usage (month);
`;

suite("postgres ledger", () => {
  let admin: Pool;
  const stores: PostgresUsageStore[] = [];

  const store = () => {
    const s = new PostgresUsageStore(URL!);
    stores.push(s);
    return s;
  };

  beforeAll(() => {
    admin = new Pool({ connectionString: URL, max: 2 });
  });

  afterEach(async () => {
    await admin.query("DROP TABLE IF EXISTS assistant_usage, assistant_budget, assistant_session, assistant_client CASCADE");
  });

  afterAll(async () => {
    await Promise.all(stores.map((s) => s.close()));
    await admin.end();
  });

  async function columns(table: string): Promise<string[]> {
    const r = await admin.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
      [table],
    );
    return r.rows.map((x) => x.column_name);
  }

  describe("fresh database", () => {
    it("creates every table and column the code uses", async () => {
      await store().init();
      expect(await columns("assistant_budget")).toEqual(["month", "reserved_usd", "spent_usd", "uncertain_usd"]);
      expect(await columns("assistant_client")).toEqual(["client_key", "hour_bucket", "requests"].sort());
      const usage = await columns("assistant_usage");
      for (const c of ["outcome", "reason", "reconciled_at", "cost_usd", "reservation_id"]) expect(usage).toContain(c);
    });

    it("is safe to run twice, and by two instances at once", async () => {
      await Promise.all([store().init(), store().init(), store().init()]);
      await expect(store().init()).resolves.toBeUndefined();
    });
  });

  describe("upgrade from the previous schema", () => {
    it("adds the new columns and keeps existing records", async () => {
      await admin.query(V1_SCHEMA);
      const month = monthKey();
      await admin.query(`INSERT INTO assistant_budget (month, reserved_usd, spent_usd) VALUES ($1, 0, 1.234567)`, [month]);
      await admin.query(
        `INSERT INTO assistant_usage (reservation_id, month, session_id, model, input_tokens, output_tokens, cost_usd)
         VALUES ('r_old_1', $1, 's_old', 'gpt-4o-mini', 1000, 100, 0.00021), ('r_old_2', $1, 's_old', NULL, 0, 0, 0)`,
        [month],
      );
      await admin.query(`INSERT INTO assistant_session (session_id, turns) VALUES ('s_old', 2)`);

      const s = store();
      await s.init();

      // Nothing lost.
      const rows = await admin.query<{ reservation_id: string; cost_usd: string; outcome: string; reason: string | null }>(
        `SELECT reservation_id, cost_usd, outcome, reason FROM assistant_usage ORDER BY reservation_id`,
      );
      expect(rows.rows).toHaveLength(2);
      expect(Number(rows.rows[0].cost_usd)).toBeCloseTo(0.00021, 6);
      // Rows written before the distinction existed are marked, not guessed at.
      expect(rows.rows[0].outcome).toBe("legacy");
      expect(rows.rows[0].reason).toBeNull();

      const snap = await s.snapshot("s_old", month, config);
      expect(snap.spentUsd).toBeCloseTo(1.234567, 6);
      expect(snap.uncertainUsd).toBe(0);
      expect(snap.sessionTurns).toBe(2);
    });

    it("does not treat legacy rows as uncertain charges", async () => {
      await admin.query(V1_SCHEMA);
      await admin.query(
        `INSERT INTO assistant_usage (reservation_id, month, session_id, cost_usd) VALUES ('r_old_zero', $1, 's_old', 0)`,
        [monthKey()],
      );
      const s = store();
      await s.init();
      expect(await s.listUncertain(monthKey())).toEqual([]);
      expect(await s.reconcile("r_old_zero", 0.5)).toBe(false);
    });

    it("the upgraded database then works exactly like a fresh one", async () => {
      await admin.query(V1_SCHEMA);
      const s = store();
      await s.init();
      const r = await s.reserve("s_new", "c_new", monthKey(), "2026-09-08T10", 0.001, config);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      await s.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 10, outputTokens: 10 }, 0.0002);
      const snap = await s.snapshot("s_new", monthKey(), config);
      expect(snap.spentUsd).toBeCloseTo(0.0002, 6);
      expect(snap.reservedUsd).toBe(0);
    });
  });

  describe("real transactions", () => {
    it("concurrent reservations cannot both take the last of the budget", async () => {
      const s = store();
      await s.init();
      const meter = new UsageMeter(s, { ...config, monthlyCapUsd: 0, sessionTurnLimit: 100 });
      const cap = meter.worstCaseUsd * 2;
      const bounded = new UsageMeter(s, { ...config, monthlyCapUsd: cap, sessionTurnLimit: 100 });

      // Twenty concurrent transactions against one row.
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => bounded.reserve(`s${i}`, `c${i}`)));
      expect(results.filter((r) => r.ok).length).toBe(2);
      for (const r of results) if (!r.ok) expect(r.kind).toBe("monthly_cap");

      const snap = await bounded.snapshot("s0");
      expect(snap.reservedUsd).toBeLessThanOrEqual(cap + 1e-9);
    });

    it("the per-client hourly limit holds under concurrency", async () => {
      const s = store();
      await s.init();
      const meter = new UsageMeter(s, { ...config, clientHourlyLimit: 3, sessionTurnLimit: 100 });
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => meter.reserve(`fresh-${i}`, "one-client")));
      expect(results.filter((r) => r.ok).length).toBe(3);
      for (const r of results) if (!r.ok) expect(r.kind).toBe("client_limit");
    });

    it("a refused reservation leaves no counter incremented", async () => {
      const s = store();
      await s.init();
      const meter = new UsageMeter(s, { ...config, monthlyCapUsd: 0, sessionTurnLimit: 100 });
      const r = await meter.reserve("s1", "c1");
      expect(r.ok).toBe(false);
      // The client and session rows are written before the budget check, so a
      // rollback is the only thing keeping them honest.
      const client = await admin.query(`SELECT requests FROM assistant_client`);
      const session = await admin.query(`SELECT turns FROM assistant_session`);
      expect(client.rowCount).toBe(0);
      expect(session.rowCount).toBe(0);
    });

    it("settling the same reservation twice records and charges once", async () => {
      const s = store();
      await s.init();
      const meter = new UsageMeter(s, { ...config, sessionTurnLimit: 100 });
      const r = await meter.reserve("s1", "c1");
      if (!r.ok) throw new Error("expected a reservation");
      const outcome = { kind: "billed" as const, model: "m", inputTokens: 1000, outputTokens: 100 };
      await Promise.all([meter.settle(r.reservation, outcome), meter.settle(r.reservation, outcome)]);
      const rows = await admin.query(`SELECT 1 FROM assistant_usage WHERE reservation_id = $1`, [r.reservation.id]);
      expect(rows.rowCount).toBe(1);
      const snap = await meter.snapshot("s1");
      expect(snap.spentUsd).toBeCloseTo(meter.costOf(1000, 100), 6);
      expect(snap.reservedUsd).toBe(0);
    });

    it("holds an uncertain charge against the cap, then reconciles it once", async () => {
      const s = store();
      await s.init();
      const probe = new UsageMeter(s, config);
      const meter = new UsageMeter(s, { ...config, monthlyCapUsd: probe.worstCaseUsd, sessionTurnLimit: 100 });
      const r = await meter.reserve("s1", "c1");
      if (!r.ok) throw new Error("expected a reservation");
      await meter.settle(r.reservation, { kind: "uncertain", reason: "The request timed out." });

      let snap = await meter.snapshot("s1");
      expect(snap.uncertainUsd).toBeCloseTo(meter.worstCaseUsd, 6);
      expect(snap.spentUsd).toBe(0);
      // Still occupying the budget.
      const blocked = await meter.reserve("s2", "c2");
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.kind).toBe("monthly_cap");

      const held = await meter.listUncertain();
      expect(held).toHaveLength(1);
      expect(held[0].reason).toBe("The request timed out.");

      expect(await meter.reconcile(r.reservation.id, 0.0003)).toBe(true);
      expect(await meter.reconcile(r.reservation.id, 0.0003)).toBe(false);
      snap = await meter.snapshot("s1");
      expect(snap.uncertainUsd).toBe(0);
      expect(snap.spentUsd).toBeCloseTo(0.0003, 6);
      expect(await meter.listUncertain()).toEqual([]);
    });

    it("a not_billed outcome returns the whole reservation", async () => {
      const s = store();
      await s.init();
      const meter = new UsageMeter(s, { ...config, sessionTurnLimit: 100 });
      const r = await meter.reserve("s1", "c1");
      if (!r.ok) throw new Error("expected a reservation");
      await meter.settle(r.reservation, { kind: "not_billed", reason: "The provider returned 400." });
      const snap = await meter.snapshot("s1");
      expect(snap.spentUsd).toBe(0);
      expect(snap.uncertainUsd).toBe(0);
      expect(snap.reservedUsd).toBe(0);
    });
  });
});
