import { Pool } from "pg";
import type {
  BudgetSnapshot,
  CallOutcome,
  CloseOpenResult,
  MeterConfig,
  OpenReservation,
  OpenResolution,
  Reservation,
  ReserveResult,
  UncertainCharge,
  UsageStore,
} from "./UsageMeter";

// Shared across every instance of the application, which is what makes the cap
// real. Each limit is enforced by a single conditional UPDATE, so two
// concurrent requests cannot both see room that only one of them can have:
// Postgres serialises the row update and re-evaluates the WHERE clause against
// the committed row, so the loser matches zero rows and is refused.

// Schema changes are applied as ordered, idempotent steps inside one
// transaction, so a fresh database and one created by an earlier version end up
// identical and a half-applied upgrade cannot be left behind.
//
// Order matters. `CREATE TABLE IF NOT EXISTS` does nothing to a table that
// already exists, so every column added after v1 needs its own `ADD COLUMN IF
// NOT EXISTS`, and indexes that reference those columns come last.
const MIGRATIONS: string[] = [
  // v1 shape. On an existing database every one of these is a no-op.
  `CREATE TABLE IF NOT EXISTS assistant_budget (
     month           TEXT PRIMARY KEY,
     reserved_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
     spent_usd       NUMERIC(12,6) NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS assistant_session (
     session_id      TEXT PRIMARY KEY,
     turns           INTEGER NOT NULL DEFAULT 0,
     first_seen      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS assistant_usage (
     id              BIGSERIAL PRIMARY KEY,
     reservation_id  TEXT UNIQUE NOT NULL,
     month           TEXT NOT NULL,
     session_id      TEXT NOT NULL,
     model           TEXT,
     input_tokens    INTEGER NOT NULL DEFAULT 0,
     output_tokens   INTEGER NOT NULL DEFAULT 0,
     cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
     settled_at      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS assistant_usage_month_idx ON assistant_usage (month)`,

  // v2: uncertain charges, per-client limits, outcome classification.
  `CREATE TABLE IF NOT EXISTS assistant_client (
     client_key      TEXT NOT NULL,
     hour_bucket     TEXT NOT NULL,
     requests        INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (client_key, hour_bucket)
   )`,
  `ALTER TABLE assistant_budget ADD COLUMN IF NOT EXISTS uncertain_usd NUMERIC(12,6) NOT NULL DEFAULT 0`,
  // Existing rows predate the billed/not_billed/uncertain distinction, so they
  // are marked 'legacy' rather than assigned an outcome we cannot know. Their
  // recorded cost is untouched, and 'legacy' is never treated as uncertain, so
  // an upgrade neither loses money already spent nor invents a held charge.
  `ALTER TABLE assistant_usage ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'legacy'`,
  `ALTER TABLE assistant_usage ADD COLUMN IF NOT EXISTS reason TEXT`,
  `ALTER TABLE assistant_usage ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS assistant_usage_uncertain_idx ON assistant_usage (month, outcome) WHERE reconciled_at IS NULL`,
];

// An operator-closed reservation is marked by a reason this code writes and a
// reconciled_at stamp. Distinguishing it from a normal settlement is what lets
// a late outcome correct the books instead of being dropped as a duplicate.
const OPERATOR_CLOSE_MARKERS = ["No outcome was ever recorded for this request.", "Closed by an operator against the provider's record"];

async function wasClosedByOperator(client: { query: (q: string, v: unknown[]) => Promise<{ rows: { reason: string | null }[] }> }, reservationId: string): Promise<boolean> {
  const r = await client.query(`SELECT reason FROM assistant_usage WHERE reservation_id = $1`, [reservationId]);
  const reason = r.rows[0]?.reason ?? "";
  return OPERATOR_CLOSE_MARKERS.some((m) => reason.startsWith(m));
}

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
    this.ready ??= this.migrate();
    return this.ready;
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // A lock so two instances starting together do not both run the DDL and
      // deadlock against each other. The number is arbitrary but fixed.
      await client.query("SELECT pg_advisory_xact_lock(4820193)");
      for (const step of MIGRATIONS) await client.query(step);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      // Let the next call try again rather than caching the failure forever.
      this.ready = null;
      throw e;
    } finally {
      client.release();
    }
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

      // The reservation is written down before the call, in the same
      // transaction that took the budget. Without this a crash between
      // reserving and settling left reserved_usd raised against an id that
      // existed only in a dead process: budget held forever, with nothing for
      // an operator to reconcile. An `open` row is that record.
      await client.query(
        `INSERT INTO assistant_usage (reservation_id, month, session_id, outcome, cost_usd)
         VALUES ($1, $2, $3, 'open', $4) ON CONFLICT (reservation_id) DO NOTHING`,
        [id, month, sessionId, estimateUsd],
      );

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

      // Lock the row first, so a settlement and an operator closing the same
      // reservation cannot both reach the budget. Whichever arrives second sees
      // what the first did and corrects rather than double-counts.
      const current = await client.query<{ outcome: string; cost_usd: string; month: string }>(
        `SELECT outcome, cost_usd, month FROM assistant_usage WHERE reservation_id = $1 FOR UPDATE`,
        [reservation.id],
      );

      if (current.rowCount === 0) {
        // No reservation row: an older schema, or a hand-recovered ledger.
        // Record the outcome so it is not lost.
        await client.query(
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
        await client.query(
          `UPDATE assistant_budget
              SET reserved_usd  = GREATEST(0, reserved_usd - $2),
                  spent_usd     = spent_usd + $3,
                  uncertain_usd = uncertain_usd + $4
            WHERE month = $1`,
          [reservation.month, reservation.estimateUsd, outcome.kind === "uncertain" ? 0 : costUsd, outcome.kind === "uncertain" ? costUsd : 0],
        );
        await client.query("COMMIT");
        return;
      }

      const row = current.rows[0];

      if (row.outcome === "open") {
        await client.query(
          `UPDATE assistant_usage
              SET outcome = $2, reason = $3, model = $4, input_tokens = $5, output_tokens = $6, cost_usd = $7, settled_at = now()
            WHERE reservation_id = $1`,
          [
            reservation.id,
            outcome.kind,
            outcome.kind === "billed" ? null : outcome.reason,
            outcome.kind === "billed" ? outcome.model : null,
            outcome.kind === "billed" ? outcome.inputTokens : 0,
            outcome.kind === "billed" ? outcome.outputTokens : 0,
            costUsd,
          ],
        );
        await client.query(
          `UPDATE assistant_budget
              SET reserved_usd  = GREATEST(0, reserved_usd - $2),
                  spent_usd     = spent_usd + $3,
                  uncertain_usd = uncertain_usd + $4
            WHERE month = $1`,
          [reservation.month, reservation.estimateUsd, outcome.kind === "uncertain" ? 0 : costUsd, outcome.kind === "uncertain" ? costUsd : 0],
        );
        await client.query("COMMIT");
        return;
      }

      // The reservation was already closed. Either it settled once already, in
      // which case a retry must change nothing, or an operator closed it as
      // abandoned and the real outcome has now turned up late. A late outcome
      // is the better information and must not vanish: it replaces the
      // operator's estimate and the budget is corrected by the difference.
      const closedByOperator = row.outcome !== "billed" && row.outcome !== "not_billed" ? await wasClosedByOperator(client, reservation.id) : false;
      if (!closedByOperator) {
        await client.query("COMMIT");
        return;
      }

      const previouslyHeld = Number(row.cost_usd);
      const wasUncertain = row.outcome === "uncertain";
      await client.query(
        `UPDATE assistant_usage
            SET outcome = $2,
                reason = $3,
                model = $4, input_tokens = $5, output_tokens = $6, cost_usd = $7,
                settled_at = now(), reconciled_at = now()
          WHERE reservation_id = $1`,
        [
          reservation.id,
          outcome.kind,
          `Settled after an operator had closed it as abandoned. ${outcome.kind === "billed" ? "The provider's own figures replace the held estimate." : outcome.reason}`,
          outcome.kind === "billed" ? outcome.model : null,
          outcome.kind === "billed" ? outcome.inputTokens : 0,
          outcome.kind === "billed" ? outcome.outputTokens : 0,
          costUsd,
        ],
      );
      await client.query(
        `UPDATE assistant_budget
            SET uncertain_usd = GREATEST(0, uncertain_usd - $2),
                spent_usd     = GREATEST(0, spent_usd - $3) + $4
          WHERE month = $1`,
        [
          reservation.month,
          wasUncertain ? previouslyHeld : 0,
          wasUncertain ? 0 : previouslyHeld,
          outcome.kind === "uncertain" ? 0 : costUsd,
        ],
      );
      if (outcome.kind === "uncertain") {
        await client.query(`UPDATE assistant_budget SET uncertain_usd = uncertain_usd + $2 WHERE month = $1`, [reservation.month, costUsd]);
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

  async listOpen(month: string, olderThanMs = 0): Promise<OpenReservation[]> {
    const r = await this.pool.query<{ reservation_id: string; month: string; session_id: string; cost_usd: string; settled_at: Date }>(
      `SELECT reservation_id, month, session_id, cost_usd, settled_at
         FROM assistant_usage
        WHERE month = $1 AND outcome = 'open' AND settled_at < now() - make_interval(secs => $2)
        ORDER BY settled_at`,
      [month, olderThanMs / 1000],
    );
    return r.rows.map((x) => ({
      reservationId: x.reservation_id,
      month: x.month,
      sessionId: x.session_id,
      heldUsd: Number(x.cost_usd),
      at: new Date(x.settled_at).toISOString(),
    }));
  }

  async closeOpen(reservationId: string, resolution: OpenResolution, minAgeMs = 0): Promise<CloseOpenResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Locked for the whole decision. A settlement arriving at the same moment
      // waits here rather than racing this to the budget row.
      const held = await client.query<{ month: string; cost_usd: string; age_ms: string }>(
        `SELECT month, cost_usd, EXTRACT(EPOCH FROM (now() - settled_at)) * 1000 AS age_ms
           FROM assistant_usage
          WHERE reservation_id = $1 AND outcome = 'open'
          FOR UPDATE`,
        [reservationId],
      );
      if (held.rowCount === 0) {
        // Either no such reservation, or it settled normally. Both are refusals,
        // distinguished so an operator is told which.
        const any = await client.query("SELECT 1 FROM assistant_usage WHERE reservation_id = $1", [reservationId]);
        await client.query("ROLLBACK");
        return { ok: false, reason: (any.rowCount ?? 0) > 0 ? "already_settled" : "not_found" };
      }
      if (Number(held.rows[0].age_ms) < minAgeMs) {
        // Still young enough to be a live request. Closing it would take the
        // accounting out from under a call that is about to settle itself.
        await client.query("ROLLBACK");
        return { ok: false, reason: "too_recent" };
      }

      const { month } = held.rows[0];
      const estimate = Number(held.rows[0].cost_usd);

      if (resolution.kind === "confirmed") {
        // An amount somebody actually read from the provider's record. Zero is
        // allowed, but only as a statement, never as an assumption.
        await client.query(
          `UPDATE assistant_usage
              SET outcome = 'billed', cost_usd = $2, reason = $3, reconciled_at = now()
            WHERE reservation_id = $1`,
          [reservationId, resolution.actualUsd, "Closed by an operator against the provider's record; no outcome was reported by the request itself."],
        );
        await client.query(
          `UPDATE assistant_budget SET reserved_usd = GREATEST(0, reserved_usd - $2), spent_usd = spent_usd + $3 WHERE month = $1`,
          [month, estimate, resolution.actualUsd],
        );
        await client.query("COMMIT");
        return { ok: true, movedTo: "billed", amountUsd: resolution.actualUsd };
      }

      // Unknown. The request may have reached the provider and been charged, so
      // the estimate is held rather than released: the same conservative rule a
      // timeout gets, and reconcilable by the same endpoint afterwards.
      await client.query(
        `UPDATE assistant_usage
            SET outcome = 'uncertain', cost_usd = $2, reason = $3
          WHERE reservation_id = $1`,
        [reservationId, estimate, "No outcome was ever recorded for this request. Held at the reservation estimate until the provider's record is checked."],
      );
      await client.query(
        `UPDATE assistant_budget SET reserved_usd = GREATEST(0, reserved_usd - $2), uncertain_usd = uncertain_usd + $2 WHERE month = $1`,
        [month, estimate],
      );
      await client.query("COMMIT");
      return { ok: true, movedTo: "uncertain", amountUsd: estimate };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
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
