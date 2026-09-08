import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresUsageStore } from "@/providers/usage/PostgresUsageStore";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, monthKey, type MeterConfig } from "@/providers/usage/UsageMeter";

// A reservation with no outcome is not a free request. It may have reached the
// provider and been charged; nobody in this process can say. These tests pin
// what happens to the money in every ordering, including the ones where an
// operator and a late settlement act on the same reservation.

const URL = process.env.TEST_DATABASE_URL;
export const DISPOSABLE_MARKER = "disposable_test_database";

const config: MeterConfig = {
  monthlyCapUsd: 25,
  sessionTurnLimit: 50,
  clientHourlyLimit: 500,
  inputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  maxInputTokens: 6000,
  maxOutputTokens: 500,
  estimateSafetyFactor: 1.3,
};

describe("in-process store", () => {
  it("holds the estimate as uncertain rather than releasing it", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s1", "c1");
    if (!r.ok) throw new Error("reserve failed");

    const closed = await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0);
    expect(closed).toMatchObject({ ok: true, movedTo: "uncertain" });

    const snap = await meter.snapshot("s1");
    expect(snap.reservedUsd).toBe(0);
    expect(snap.uncertainUsd).toBeCloseTo(r.reservation.estimateUsd, 9);
    // Reconcilable afterwards, like any other uncertain charge.
    expect((await meter.listUncertain()).map((u) => u.reservationId)).toContain(r.reservation.id);
  });

  it("records a confirmed amount as spend when an operator has one", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s2", "c2");
    if (!r.ok) throw new Error("reserve failed");

    const closed = await meter.closeOpen(r.reservation.id, { kind: "confirmed", actualUsd: 0.0004 }, 0);
    expect(closed).toMatchObject({ ok: true, movedTo: "billed", amountUsd: 0.0004 });

    const snap = await meter.snapshot("s2");
    expect(snap.reservedUsd).toBe(0);
    expect(snap.uncertainUsd).toBe(0);
    expect(snap.spentUsd).toBeCloseTo(0.0004, 9);
  });

  it("refuses to close a reservation young enough to still be in flight", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s3", "c3");
    if (!r.ok) throw new Error("reserve failed");

    expect(await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 10 * 60 * 1000)).toEqual({ ok: false, reason: "too_recent" });
    const snap = await meter.snapshot("s3");
    expect(snap.reservedUsd).toBeGreaterThan(0);
  });

  it("refuses an id that already settled, and one that never existed", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s4", "c4");
    if (!r.ok) throw new Error("reserve failed");
    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 10, outputTokens: 5 });

    expect(await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0)).toEqual({ ok: false, reason: "already_settled" });
    expect(await meter.closeOpen("r_nonexistent", { kind: "unknown" }, 0)).toEqual({ ok: false, reason: "not_found" });
  });

  it("a crash after inference, settled late, replaces the held estimate with the real cost", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s5", "c5");
    if (!r.ok) throw new Error("reserve failed");

    // Operator gives up on it: held, not forgiven.
    await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0);
    const held = await meter.snapshot("s5");
    expect(held.uncertainUsd).toBeCloseTo(r.reservation.estimateUsd, 9);

    // The call had in fact reached the provider, and its outcome arrives late.
    await meter.settle(r.reservation, { kind: "billed", model: "gpt-4o-mini", inputTokens: 1500, outputTokens: 120 });

    const after = await meter.snapshot("s5");
    const realCost = meter.costOf(1500, 120);
    expect(after.uncertainUsd).toBeCloseTo(0, 9);
    expect(after.spentUsd).toBeCloseTo(realCost, 9);
    // Not double counted: the held estimate is gone, not added to.
    expect(after.spentUsd).toBeLessThan(r.reservation.estimateUsd + realCost);
  });

  it("a late settlement after a confirmed close corrects the confirmed figure", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s6", "c6");
    if (!r.ok) throw new Error("reserve failed");

    await meter.closeOpen(r.reservation.id, { kind: "confirmed", actualUsd: 0.01 }, 0);
    expect((await meter.snapshot("s6")).spentUsd).toBeCloseTo(0.01, 9);

    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 1000, outputTokens: 100 });
    const real = meter.costOf(1000, 100);
    expect((await meter.snapshot("s6")).spentUsd).toBeCloseTo(real, 9);
  });

  it("a late settlement that is itself uncertain stays held, at its own figure", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s7", "c7");
    if (!r.ok) throw new Error("reserve failed");

    await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0);
    await meter.settle(r.reservation, { kind: "uncertain", reason: "timed out" });

    const snap = await meter.snapshot("s7");
    expect(snap.uncertainUsd).toBeCloseTo(r.reservation.estimateUsd, 9);
    expect(snap.spentUsd).toBe(0);
  });

  it("an ordinary settlement is still idempotent", async () => {
    const store = new MemoryUsageStore();
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s8", "c8");
    if (!r.ok) throw new Error("reserve failed");

    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 100, outputTokens: 10 });
    const once = await meter.snapshot("s8");
    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 100, outputTokens: 10 });
    expect((await meter.snapshot("s8")).spentUsd).toBeCloseTo(once.spentUsd, 9);
  });
});

// The shared store is where the race actually matters, because two processes
// can reach the same row. Runs only against a database marked disposable.
const suite = URL ? describe : describe.skip;

suite("shared postgres store", () => {
  let admin: Pool;
  const stores: PostgresUsageStore[] = [];
  const store = () => {
    const s = new PostgresUsageStore(URL!);
    stores.push(s);
    return s;
  };

  beforeAll(async () => {
    const probe = new Pool({ connectionString: URL, max: 1 });
    try {
      const r = await probe.query<{ present: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS present`, [DISPOSABLE_MARKER]);
      if (!r.rows[0]?.present) throw new Error(`Refusing to run: no ${DISPOSABLE_MARKER} table. This suite drops ledger tables.`);
    } finally {
      await probe.end();
    }
    admin = new Pool({ connectionString: URL, max: 2 });
  });

  afterEach(async () => {
    await admin.query("DROP TABLE IF EXISTS assistant_usage, assistant_budget, assistant_session, assistant_client CASCADE");
  });

  afterAll(async () => {
    await Promise.all(stores.map((s) => s.close()));
    await admin.end();
  });

  it("closing an orphan moves reserved into uncertain, in the same row", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg1", "c_pg1");
    if (!r.ok) throw new Error("reserve failed");

    expect(await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0)).toMatchObject({ ok: true, movedTo: "uncertain" });

    const snap = await meter.snapshot("s_pg1");
    expect(snap.reservedUsd).toBeCloseTo(0, 9);
    expect(snap.uncertainUsd).toBeCloseTo(r.reservation.estimateUsd, 9);

    const rows = await admin.query<{ outcome: string; cost_usd: string }>("SELECT outcome, cost_usd FROM assistant_usage WHERE reservation_id = $1", [
      r.reservation.id,
    ]);
    expect(rows.rows[0].outcome).toBe("uncertain");
    expect(Number(rows.rows[0].cost_usd)).toBeCloseTo(r.reservation.estimateUsd, 9);
  });

  it("refuses to close a reservation that is still young", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg2", "c_pg2");
    if (!r.ok) throw new Error("reserve failed");
    expect(await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 60_000)).toEqual({ ok: false, reason: "too_recent" });
    expect((await meter.snapshot("s_pg2")).reservedUsd).toBeGreaterThan(0);
  });

  it("crash after inference: a late settlement replaces the held estimate", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg3", "c_pg3");
    if (!r.ok) throw new Error("reserve failed");

    await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0);
    await meter.settle(r.reservation, { kind: "billed", model: "gpt-4o-mini", inputTokens: 1500, outputTokens: 120 });

    const snap = await meter.snapshot("s_pg3");
    expect(snap.uncertainUsd).toBeCloseTo(0, 9);
    expect(snap.spentUsd).toBeCloseTo(meter.costOf(1500, 120), 9);

    const row = await admin.query<{ outcome: string; reason: string }>("SELECT outcome, reason FROM assistant_usage WHERE reservation_id = $1", [
      r.reservation.id,
    ]);
    expect(row.rows[0].outcome).toBe("billed");
    expect(row.rows[0].reason).toMatch(/after an operator had closed it/i);
  });

  it("a settlement and a close racing each other leave one consistent result", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg4", "c_pg4");
    if (!r.ok) throw new Error("reserve failed");

    // Both hit the same row at once. The row lock serialises them; whichever
    // lands second must correct rather than double count.
    await Promise.all([
      meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 1000, outputTokens: 100 }),
      meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0),
    ]);

    const snap = await meter.snapshot("s_pg4");
    const real = meter.costOf(1000, 100);
    expect(snap.reservedUsd).toBeCloseTo(0, 9);
    // Either the settlement won outright, or the close held the estimate and
    // the settlement corrected it. Both end at the real cost, never at both.
    expect(snap.spentUsd + snap.uncertainUsd).toBeCloseTo(real, 6);

    const rows = await admin.query<{ n: string }>("SELECT count(*) AS n FROM assistant_usage WHERE reservation_id = $1", [r.reservation.id]);
    expect(Number(rows.rows[0].n)).toBe(1);
  });

  it("two operators closing the same reservation only move the money once", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg5", "c_pg5");
    if (!r.ok) throw new Error("reserve failed");

    const [a, b] = await Promise.all([
      meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0),
      meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect((await meter.snapshot("s_pg5")).uncertainUsd).toBeCloseTo(r.reservation.estimateUsd, 9);
  });

  it("a late settlement corrects an operator's confirmed amount", async () => {
    // The confirmed close writes outcome 'billed'. A guard that skipped billed
    // rows skipped exactly this case, so the operator's guess stood and the
    // provider's own figures were dropped.
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg7", "c_pg7");
    if (!r.ok) throw new Error("reserve failed");

    await meter.closeOpen(r.reservation.id, { kind: "confirmed", actualUsd: 0.01 }, 0);
    expect((await meter.snapshot("s_pg7")).spentUsd).toBeCloseTo(0.01, 9);

    await meter.settle(r.reservation, { kind: "billed", model: "gpt-4o-mini", inputTokens: 1000, outputTokens: 100 });

    const real = meter.costOf(1000, 100);
    const snap = await meter.snapshot("s_pg7");
    expect(snap.spentUsd).toBeCloseTo(real, 9);
    expect(snap.spentUsd).not.toBeCloseTo(0.01 + real, 9);

    const row = await admin.query<{ outcome: string; reason: string; cost_usd: string }>(
      "SELECT outcome, reason, cost_usd FROM assistant_usage WHERE reservation_id = $1",
      [r.reservation.id],
    );
    expect(row.rows[0].outcome).toBe("billed");
    expect(Number(row.rows[0].cost_usd)).toBeCloseTo(real, 9);
    expect(row.rows[0].reason).toMatch(/after an operator had closed it/i);
  });

  it("an ordinary duplicate settlement is still a no-op", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg8", "c_pg8");
    if (!r.ok) throw new Error("reserve failed");

    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 1000, outputTokens: 100 });
    const once = await meter.snapshot("s_pg8");
    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 1000, outputTokens: 100 });
    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 9999, outputTokens: 9999 });

    const twice = await meter.snapshot("s_pg8");
    expect(twice.spentUsd).toBeCloseTo(once.spentUsd, 9);
    expect(twice.uncertainUsd).toBeCloseTo(once.uncertainUsd, 9);
  });

  it("a late uncertain settlement stays reconcilable, end to end", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg9", "c_pg9");
    if (!r.ok) throw new Error("reserve failed");
    const estimate = r.reservation.estimateUsd;

    // 1. Operator gives up on it: the estimate is held, not forgiven.
    expect(await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0)).toMatchObject({ ok: true, movedTo: "uncertain" });
    expect((await meter.listUncertain()).map((u) => u.reservationId)).toContain(r.reservation.id);

    // 2. The outcome turns up late, and it is itself uncertain: the call went
    // dark rather than reporting anything. Nothing has been settled with the
    // provider, so it must not be stamped as reconciled.
    await meter.settle(r.reservation, { kind: "uncertain", reason: "The provider returned 502." });

    const held = await meter.snapshot("s_pg9");
    expect(held.uncertainUsd).toBeCloseTo(estimate, 9);
    expect(held.spentUsd).toBeCloseTo(0, 9);

    // 3. It is still listed, which is what makes it closable at all.
    const listed = await meter.listUncertain();
    expect(listed.map((u) => u.reservationId)).toContain(r.reservation.id);
    expect(listed.find((u) => u.reservationId === r.reservation.id)?.reason).toMatch(/502/);

    const stamped = await admin.query<{ reconciled_at: Date | null }>("SELECT reconciled_at FROM assistant_usage WHERE reservation_id = $1", [
      r.reservation.id,
    ]);
    expect(stamped.rows[0].reconciled_at).toBeNull();

    // 4. The operator reads the provider's record: it was charged $0.0004.
    expect(await meter.reconcile(r.reservation.id, 0.0004)).toBe(true);

    // 5. The held estimate is gone and the real figure is spend.
    const after = await meter.snapshot("s_pg9");
    expect(after.uncertainUsd).toBeCloseTo(0, 9);
    expect(after.spentUsd).toBeCloseTo(0.0004, 9);
    expect((await meter.listUncertain()).map((u) => u.reservationId)).not.toContain(r.reservation.id);
    // Reconciling twice changes nothing.
    expect(await meter.reconcile(r.reservation.id, 0.0004)).toBe(false);
  });

  it("a late billed settlement is stamped reconciled, because it is resolved", async () => {
    const meter = new UsageMeter(store(), config);
    const r = await meter.reserve("s_pg10", "c_pg10");
    if (!r.ok) throw new Error("reserve failed");

    await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0);
    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 500, outputTokens: 50 });

    const stamped = await admin.query<{ reconciled_at: Date | null }>("SELECT reconciled_at FROM assistant_usage WHERE reservation_id = $1", [
      r.reservation.id,
    ]);
    expect(stamped.rows[0].reconciled_at).not.toBeNull();
    expect((await meter.listUncertain()).map((u) => u.reservationId)).not.toContain(r.reservation.id);
  });

  it("lists an open reservation only once it is older than the filter", async () => {
    const s = store();
    const meter = new UsageMeter(s, config);
    const r = await meter.reserve("s_pg6", "c_pg6");
    if (!r.ok) throw new Error("reserve failed");

    expect(await s.listOpen(monthKey(), 60_000)).toHaveLength(0);
    expect(await s.listOpen(monthKey(), 0)).toHaveLength(1);
  });
});
