import { Pool } from "pg";

// A suite that drops or writes ledger tables must never reach the application's
// database. Comparing TEST_DATABASE_URL to DATABASE_URL as text does not prevent
// it: two different strings reach the same database through a host alias, a
// different user, an added option or a socket instead of TCP. So identity is
// established from inside the database instead, by a table only a throwaway
// database is given. The application's own database will never have one,
// whatever the connection string says.
//
// The database permissions are the real barrier and this is the second one. The
// test role should have no CONNECT privilege on the application database at
// all; see docs/ASSISTANT.md.
//
// One definition, used by every suite that touches a real ledger. It was three
// copies, and a barrier that exists in three places is one that can be weakened
// in two of them without anybody noticing.
export const DISPOSABLE_MARKER = "disposable_test_database";

export async function assertDisposable(url: string): Promise<void> {
  const probe = new Pool({ connectionString: url, max: 1 });
  try {
    const r = await probe.query<{ present: boolean }>(`SELECT to_regclass($1) IS NOT NULL AS present`, [DISPOSABLE_MARKER]);
    if (!r.rows[0]?.present) {
      const named = await probe.query<{ db: string }>("SELECT current_database() AS db");
      throw new Error(
        `Refusing to run: database "${named.rows[0]?.db}" has no ${DISPOSABLE_MARKER} table, so it is not marked disposable. ` +
          `This suite writes to or drops ledger tables. Create the marker only in a throwaway database:\n` +
          `  CREATE TABLE ${DISPOSABLE_MARKER} (note TEXT);`,
      );
    }
  } finally {
    await probe.end();
  }
}
