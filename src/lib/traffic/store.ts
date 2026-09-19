import { Pool } from 'pg';
import { type JourneyEvent } from './model';

let pool: Pool | undefined;
let ready: Promise<unknown> | undefined;
export async function trafficDb() {
  const url = process.env.TRAFFIC_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Traffic storage is not configured.');
  pool ??= new Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  ready ??= pool.query(`CREATE TABLE IF NOT EXISTS wfc_traffic_events (
    id UUID PRIMARY KEY, session UUID NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
    event TEXT NOT NULL, page TEXT NOT NULL, source TEXT NOT NULL, test BOOLEAN NOT NULL,
    product TEXT, retailer TEXT, name TEXT
  ); CREATE INDEX IF NOT EXISTS wfc_traffic_at ON wfc_traffic_events(at);
  CREATE INDEX IF NOT EXISTS wfc_traffic_session ON wfc_traffic_events(session, at);`).catch(e => { ready = undefined; throw e; });
  await ready;
  return pool;
}
export async function recordEvent(e: Omit<JourneyEvent, 'at'>) {
  const db = await trafficDb();
  // One insert transaction per session prevents concurrent requests bypassing the event cap.
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [e.session]);
    await client.query(`INSERT INTO wfc_traffic_events(id,session,event,page,source,test,product,retailer,name)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE
      (SELECT count(*) FROM wfc_traffic_events WHERE session=$2 AND at > now()-interval '1 day') < 300
      ON CONFLICT(id) DO NOTHING`, [e.id,e.session,e.event,e.page,e.source,e.test,e.product ?? null,e.retailer ?? null,e.name ?? null]);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }
}

export async function readEvents(range: string, includeTests: boolean) {
  const db = await trafficDb();
  // Date boundaries are evaluated in Pacific time, including daylight-saving transitions.
  const start = range === 'today' ? "date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles'"
    : range === 'yesterday' ? "(date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') - interval '1 day') AT TIME ZONE 'America/Los_Angeles'"
    : range === '7d' ? "now()-interval '7 days'" : "now()-interval '24 hours'";
  const end = range === 'yesterday' ? "date_trunc('day', now() AT TIME ZONE 'America/Los_Angeles') AT TIME ZONE 'America/Los_Angeles'" : 'now()';
  // Select complete visits that had activity in the range, capped explicitly in the response.
  const result = await db.query(`WITH selected AS (
      SELECT session FROM wfc_traffic_events WHERE at >= ${start} AND at < ${end} AND ($1 OR NOT test)
      GROUP BY session ORDER BY max(at) DESC LIMIT 501
    ) SELECT e.* FROM wfc_traffic_events e JOIN selected s USING(session)
    WHERE e.at > now()-interval '90 days' AND e.at < ${end} AND ($1 OR NOT e.test) ORDER BY e.at, e.id`, [includeTests]);
  const bounds = await db.query(`SELECT ${start} AS start, ${end} AS "end", min(at) AS first FROM wfc_traffic_events`);
  return { events: result.rows.map(r => ({ ...r, at: r.at.toISOString() })) as JourneyEvent[],
    start: bounds.rows[0].start.toISOString(), end: bounds.rows[0].end.toISOString(), first: bounds.rows[0].first?.toISOString() ?? null };
}
