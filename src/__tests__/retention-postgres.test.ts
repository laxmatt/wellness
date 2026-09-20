import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PostgresUsageStore } from "@/providers/usage/PostgresUsageStore";
import { BEGIN_READ_ONLY, END_READ_ONLY, countRetentionCandidates } from "@/domain/retention";
import { assertDisposable } from "./support/disposable-db";

// The predicates are the whole point of the counting layer, and a fake query
// executor cannot show that `hour_bucket < $1` reads the right buckets or that
// an unreconciled uncertain charge falls outside the anonymise count. Those
// need real SQL against the real schema. Set TEST_DATABASE_URL to enable them.
//
// This suite writes fixture rows and drops the ledger tables afterwards, so it
// runs only against a database marked disposable. It never touches the
// application's ledger and there is no path here that writes to one.
const URL = process.env.TEST_DATABASE_URL;
const suite = URL ? describe : describe.skip;

const CUTOFF = new Date("2026-06-01T00:00:00.000Z");

suite("retention counts, against a real ledger", () => {
  let admin: Pool;
  let store: PostgresUsageStore;

  beforeAll(async () => {
    await assertDisposable(URL!);
    admin = new Pool({ connectionString: URL, max: 2 });
  });

  afterEach(async () => {
    await admin.query("DROP TABLE IF EXISTS assistant_usage, assistant_budget, assistant_session, assistant_client CASCADE");
  });

  afterAll(async () => {
    await store?.close();
    await admin.end();
  });

  async function fixtures() {
    store = new PostgresUsageStore(URL!);
    await store.init();

    // Two buckets before the cutoff hour, one after.
    await admin.query(`INSERT INTO assistant_client (client_key, hour_bucket, requests) VALUES
      ('hash-a', '2026-05-30T09', 3), ('hash-b', '2026-05-31T23', 1), ('hash-c', '2026-06-02T08', 7)`);

    await admin.query(`INSERT INTO assistant_session (session_id, turns, first_seen) VALUES
      ('sess-old', 4, '2026-05-01T00:00:00Z'), ('sess-new', 2, '2026-08-01T00:00:00Z')`);

    await admin.query(`INSERT INTO assistant_usage
        (reservation_id, month, session_id, model, cost_usd, settled_at, outcome, reconciled_at) VALUES
      -- eligible: settled long ago, accounting finished
      ('r-billed-old',      '2026-05', 'sess-old', 'm', 0.001, '2026-05-02T00:00:00Z', 'billed',    NULL),
      ('r-notbilled-old',   '2026-05', 'sess-old', NULL,     0, '2026-05-03T00:00:00Z', 'not_billed', NULL),
      ('r-legacy-old',      '2026-05', 'sess-old', NULL, 0.002, '2026-05-04T00:00:00Z', 'legacy',    NULL),
      ('r-uncertain-done',  '2026-05', 'sess-old', NULL, 0.003, '2026-05-05T00:00:00Z', 'uncertain', '2026-05-20T00:00:00Z'),
      -- not eligible: too recent
      ('r-billed-new',      '2026-08', 'sess-new', 'm', 0.001, '2026-08-02T00:00:00Z', 'billed',    NULL),
      -- never eligible: an operator still has work to do on these
      ('r-open-old',        '2026-05', 'sess-old', NULL,     0, '2026-05-06T00:00:00Z', 'open',      NULL),
      ('r-uncertain-open',  '2026-05', 'sess-old', NULL, 0.004, '2026-05-07T00:00:00Z', 'uncertain', NULL),
      -- already anonymised, so not counted again
      ('r-anonymised',      '2026-05', '',         NULL, 0.001, '2026-05-08T00:00:00Z', 'billed',    NULL),
      -- an outcome this code does not know
      ('r-strange',         '2026-05', 'sess-old', NULL, 0.001, '2026-05-09T00:00:00Z', 'abandoned', NULL)`);

    await admin.query(`INSERT INTO assistant_budget (month, spent_usd, uncertain_usd) VALUES ('2026-05', 0.012, 0.004)`);
  }

  const run = () => countRetentionCandidates((sql, params) => admin.query(sql, params), CUTOFF);

  it("counts only what the cutoff reaches, and only what is finished", async () => {
    await fixtures();
    const counts = await run();

    expect(counts.client_buckets).toBe(2);
    // billed, not_billed, legacy and a reconciled uncertain charge. Not the
    // recent row, not the open reservation, not the unreconciled charge, not
    // the row already anonymised, not the unrecognised outcome.
    expect(counts.usage_session_link).toBe(4);
  });

  it("reports the protected rows in full and never as eligible", async () => {
    await fixtures();
    const counts = await run();

    expect(counts.open_reservations).toBe(1);
    expect(counts.uncertain_charges).toBe(1);
    expect(counts.budget_totals).toBe(1);
  });

  it("counts sessions in full and does not date-classify them", async () => {
    await fixtures();
    const counts = await run();
    // Both rows, the old one included. A session has no expiry in this codebase,
    // so there is no age at which one becomes eligible for anything.
    expect(counts.sessions).toBe(2);
    expect(counts.unrecognised_outcomes).toBe(1);
  });

  it("is refused by Postgres if it ever tries to write, whatever this code intends", async () => {
    await fixtures();
    // The regex guard in retention.ts is a review aid. This is the boundary:
    // 25006 is read_only_sql_transaction, raised by Postgres itself. One
    // statement per transaction, because the first refusal aborts it.
    for (const write of ["DELETE FROM assistant_client", "UPDATE assistant_usage SET session_id = ''", "TRUNCATE assistant_session", "DROP TABLE assistant_budget"]) {
      const client = await admin.connect();
      try {
        await client.query(BEGIN_READ_ONLY);
        await expect(client.query(write), write).rejects.toMatchObject({ code: "25006" });
      } finally {
        await client.query(END_READ_ONLY).catch(() => {});
        client.release();
      }
    }
    const left = await admin.query<{ n: string }>("SELECT count(*) AS n FROM assistant_client");
    expect(left.rows[0].n).toBe("3");
  });

  it("changes nothing it reads", async () => {
    await fixtures();
    const census = async () => {
      const r = await admin.query<{ c: string; s: string; u: string; b: string; ids: string }>(`SELECT
        (SELECT count(*) FROM assistant_client)  AS c,
        (SELECT count(*) FROM assistant_session) AS s,
        (SELECT count(*) FROM assistant_usage)   AS u,
        (SELECT count(*) FROM assistant_budget)  AS b,
        (SELECT string_agg(reservation_id || ':' || session_id || ':' || outcome || ':' || cost_usd, ',' ORDER BY reservation_id) FROM assistant_usage) AS ids`);
      return r.rows[0];
    };

    const before = await census();
    await run();
    expect(await census()).toEqual(before);
  });
});
