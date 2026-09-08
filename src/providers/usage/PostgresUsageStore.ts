import { Pool } from "pg";
import type { BudgetSnapshot, MeterConfig, Reservation, ReserveResult, UsageStore } from "./UsageMeter";

// Shared across every instance of the application, which is what makes the cap
// real. Both limits are enforced by a single conditional UPDATE, so two
// concurrent requests cannot both see room that only one of them can have:
// Postgres serialises the row update, and the WHERE clause is re-evaluated
// against the committed row, so the loser matches zero rows and is refused.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS assistant_budget (
  month           TEXT PRIMARY KEY,
  reserved_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
  spent_usd       NUMERIC(12,6) NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assistant_session (
  session_id      TEXT PRIMARY KEY,
  turns           INTEGER NOT NULL DEFAULT 0,
  first_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assistant_usage (
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
CREATE INDEX IF NOT EXISTS assistant_usage_month_idx ON assistant_usage (month);
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

  async reserve(sessionId: string, month: string, estimateUsd: number, config: MeterConfig): Promise<ReserveResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Session limit first: cheaper to refuse, and it needs no budget.
      const session = await client.query<{ turns: number }>(
        `INSERT INTO assistant_session (session_id, turns) VALUES ($1, 1)
         ON CONFLICT (session_id) DO UPDATE SET turns = assistant_session.turns + 1
         WHERE assistant_session.turns < $2
         RETURNING turns`,
        [sessionId, config.sessionTurnLimit],
      );
      if (session.rowCount === 0) {
        await client.query("ROLLBACK");
        return {
          ok: false,
          kind: "session_limit",
          reason: `This conversation reached its limit of ${config.sessionTurnLimit} replies.`,
        };
      }

      await client.query(`INSERT INTO assistant_budget (month) VALUES ($1) ON CONFLICT (month) DO NOTHING`, [month]);

      // Reserved plus already spent must stay within the cap. A concurrent
      // request that got here first is included in reserved_usd, so the
      // arithmetic sees it even though it has not settled.
      const budget = await client.query(
        `UPDATE assistant_budget
            SET reserved_usd = reserved_usd + $2
          WHERE month = $1 AND reserved_usd + spent_usd + $2 <= $3
          RETURNING reserved_usd, spent_usd`,
        [month, estimateUsd, config.monthlyCapUsd],
      );
      if (budget.rowCount === 0) {
        await client.query("ROLLBACK");
        return { ok: false, kind: "monthly_cap", reason: "The assistant is at its budget for this month." };
      }

      const id = `r_${month}_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await client.query("COMMIT");
      return { ok: true, reservation: { id, month, sessionId, estimateUsd } };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async settle(reservation: Reservation, actualUsd: number, model: string, inputTokens: number, outputTokens: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Unique reservation_id makes this idempotent: a retry records nothing
      // twice and never releases the same reservation twice.
      const inserted = await client.query(
        `INSERT INTO assistant_usage (reservation_id, month, session_id, model, input_tokens, output_tokens, cost_usd)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (reservation_id) DO NOTHING`,
        [reservation.id, reservation.month, reservation.sessionId, model, inputTokens, outputTokens, actualUsd],
      );
      if (inserted.rowCount === 1) {
        await client.query(
          `UPDATE assistant_budget
              SET reserved_usd = GREATEST(0, reserved_usd - $2),
                  spent_usd    = spent_usd + $3
            WHERE month = $1`,
          [reservation.month, reservation.estimateUsd, actualUsd],
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
    const b = await this.pool.query<{ reserved_usd: string; spent_usd: string }>(
      `SELECT reserved_usd, spent_usd FROM assistant_budget WHERE month = $1`,
      [month],
    );
    const s = await this.pool.query<{ turns: number }>(`SELECT turns FROM assistant_session WHERE session_id = $1`, [sessionId]);
    return {
      month,
      spentUsd: Number(b.rows[0]?.spent_usd ?? 0),
      reservedUsd: Number(b.rows[0]?.reserved_usd ?? 0),
      capUsd: config.monthlyCapUsd,
      sessionTurns: Number(s.rows[0]?.turns ?? 0),
      sessionTurnLimit: config.sessionTurnLimit,
    };
  }

  async close() {
    await this.pool.end();
  }
}
