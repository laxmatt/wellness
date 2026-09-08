import { Pool } from "pg";
import type { BudgetSnapshot, CallOutcome, MeterConfig, Reservation, ReserveResult, UncertainCharge, UsageStore } from "./UsageMeter";

// Shared across every instance of the application, which is what makes the cap
// real. Each limit is enforced by a single conditional UPDATE, so two
// concurrent requests cannot both see room that only one of them can have:
// Postgres serialises the row update and re-evaluates the WHERE clause against
// the committed row, so the loser matches zero rows and is refused.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assistant_budget (
  month           TEXT PRIMARY KEY,
  reserved_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
  spent_usd       NUMERIC(12,6) NOT NULL DEFAULT 0,
  uncertain_usd   NUMERIC(12,6) NOT NULL DEFAULT 0
);
ALTER TABLE assistant_budget ADD COLUMN IF NOT EXISTS uncertain_usd NUMERIC(12,6) NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS assistant_session (
  session_id      TEXT PRIMARY KEY,
  turns           INTEGER NOT NULL DEFAULT 0,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assistant_client (
  client_key      TEXT NOT NULL,
  hour_bucket     TEXT NOT NULL,
  requests        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (client_key, hour_bucket)
);
CREATE TABLE IF NOT EXISTS assistant_usage (
  id              BIGSERIAL PRIMARY KEY,
  reservation_id  TEXT UNIQUE NOT NULL,
  month           TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  reason          TEXT,
  model           TEXT,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
  reconciled_at   TIMESTAMPTZ,
  settled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assistant_usage_month_idx ON assistant_usage (month);
CREATE INDEX IF NOT EXISTS assistant_usage_uncertain_idx ON assistant_usage (month, outcome) WHERE reconciled_at IS NULL;
`;

export class PostgresUsageStore implements UsageStore {
  readonly name = "postgres";
  readonly isShared = true;
  private pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(connectionString = process.env.DATABASE_URL ?? "") {
    if (!connectionString) throw new Error("PostgresUsageStore needs DATABASE_URL");
    this.pool = new Pool({ connectionString, max: 4 });
  }

  async init(): Promise<void> {
    this.ready ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.ready;
  }

  async reserve(sessionId: string, clientKey: string, month: string, hourBucket: string, estimateUsd: number, config: MeterConfig): Promise<ReserveResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Per-client first: it is the limit that actually bounds abuse, since a
      // caller does not choose their own client key.
      const perClient = await client.query(
        `INSERT INTO assistant_client (client_key, hour_bucket, requests) VALUES ($1, $2, 1)
         ON CONFLICT (client_key, hour_bucket) DO UPDATE SET requests = assistant_client.requests + 1
         WHERE assistant_client.requests < $3
         RETURNING requests`,
        [clientKey, hourBucket, config.clientHourlyLimit],
      );
      if (perClient.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, kind: "client_limit", reason: "Too many assistant requests from this connection in the last hour." };
      }

      const session = await client.query(
        `INSERT INTO assistant_session (session_id, turns) VALUES ($1, 1)
         ON CONFLICT (session_id) DO UPDATE SET turns = assistant_session.turns + 1
         WHERE assistant_session.turns < $2
         RETURNING turns`,
        [sessionId, config.sessionTurnLimit],
      );
      if (session.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, kind: "session_limit", reason: `This conversation reached its limit of ${config.sessionTurnLimit} replies.` };
      }

      await client.query(`INSERT INTO assistant_budget (month) VALUES ($1) ON CONFLICT (month) DO NOTHING`, [month]);

      // Reserved, spent and unreconciled uncertain charges all count against
      // the cap. A concurrent request that got here first is in reserved_usd,
      // so the arithmetic sees it even though it has not settled.
      const budget = await client.query(
        `UPDATE assistant_budget
            SET reserved_usd = reserved_usd + $2
          WHERE month = $1 AND reserved_usd + spent_usd + uncertain_usd + $2 <= $3
          RETURNING reserved_usd`,
        [month, estimateUsd, config.monthlyCapUsd],
      );
      if (budget.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, kind: "monthly_cap", reason: "The assistant is at its budget for this month." };
      }

      const id = `r_${month}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await client.query("COMMIT");
      return { ok: true, reservation: { id, month, sessionId, estimateUsd } };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async settle(reservation: Reservation, outcome: CallOutcome, costUsd: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Unique reservation_id makes this idempotent: a retry records nothing
      // twice and never releases the same reservation twice.
      const inserted = await client.query(
        `INSERT INTO assistant_usage (reservation_id, month, session_id, outcome, reason, model, input_tokens, output_tokens, cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (reservation_id) DO NOTHING`,
        [
          reservation.id,
          reservation.month,
          reservation.sessionId,
          outcome.kind,
          outcome.kind === "billed" ? null : outcome.reason,
          outcome.kind === "billed" ? outcome.model : null,
          outcome.kind === "billed" ? outcome.inputTokens : 0,
          outcome.kind === "billed" ? outcome.outputTokens : 0,
          costUsd,
        ],
      );
      if (inserted.rowCount === 1) {
        // An uncertain charge is held rather than spent: it keeps counting
        // against the cap until an operator confirms it against the provider.
        await client.query(
          `UPDATE assistant_budget
              SET reserved_usd  = GREATEST(0, reserved_usd - $2),
                  spent_usd     = spent_usd + $3,
                  uncertain_usd = uncertain_usd + $4
            WHERE month = $1`,
          [reservation.month, reservation.estimateUsd, outcome.kind === "uncertain" ? 0 : costUsd, outcome.kind === "uncertain" ? costUsd : 0],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async snapshot(sessionId: string, month: string, config: MeterConfig): Promise<BudgetSnapshot> {
    const b = await this.pool.query<{ reserved_usd: string; spent_usd: string; uncertain_usd: string }>(
      `SELECT reserved_usd, spent_usd, uncertain_usd FROM assistant_budget WHERE month = $1`,
      [month],
    );
    const s = await this.pool.query<{ turns: number }>(`SELECT turns FROM assistant_session WHERE session_id = $1`, [sessionId]);
    return {
      month,
      spentUsd: Number(b.rows[0]?.spent_usd ?? 0),
      reservedUsd: Number(b.rows[0]?.reserved_usd ?? 0),
      uncertainUsd: Number(b.rows[0]?.uncertain_usd ?? 0),
      capUsd: config.monthlyCapUsd,
      sessionTurns: Number(s.rows[0]?.turns ?? 0),
      sessionTurnLimit: config.sessionTurnLimit,
    };
  }

  async listUncertain(month: string): Promise<UncertainCharge[]> {
    const r = await this.pool.query<{ reservation_id: string; month: string; session_id: string; reason: string; cost_usd: string; settled_at: Date }>(
      `SELECT reservation_id, month, session_id, reason, cost_usd, settled_at
         FROM assistant_usage
        WHERE month = $1 AND outcome = 'uncertain' AND reconciled_at IS NULL
        ORDER BY settled_at DESC`,
      [month],
    );
    return r.rows.map((row) => ({
      reservationId: row.reservation_id,
      month: row.month,
      sessionId: row.session_id,
      reason: row.reason,
      heldUsd: Number(row.cost_usd),
      at: row.settled_at.toISOString(),
    }));
  }

  async reconcile(reservationId: string, actualUsd: number): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Lock and read the held amount first. Reading it back out of the same
      // UPDATE would depend on statement snapshot behaviour, which is not
      // something an accounting figure should rest on.
      const held = await client.query<{ month: string; cost_usd: string }>(
        `SELECT month, cost_usd FROM assistant_usage
          WHERE reservation_id = $1 AND outcome = 'uncertain' AND reconciled_at IS NULL
          FOR UPDATE`,
        [reservationId],
      );
      if (held.rowCount === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      const { month, cost_usd } = held.rows[0];
      await client.query(`UPDATE assistant_usage SET reconciled_at = now(), cost_usd = $2 WHERE reservation_id = $1`, [reservationId, actualUsd]);
      await client.query(
        `UPDATE assistant_budget
            SET uncertain_usd = GREATEST(0, uncertain_usd - $2),
                spent_usd     = spent_usd + $3
          WHERE month = $1`,
        [month, Number(cost_usd), actualUsd],
      );
      await client.query("COMMIT");
      return true;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}
