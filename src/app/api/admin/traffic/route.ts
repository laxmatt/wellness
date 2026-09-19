import { authorizeAdmin } from '@/domain/admin-auth';
import { readEvents } from '@/lib/traffic/store';
import { summarize } from '@/lib/traffic/model';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const headers = { 'Cache-Control': 'no-store, private' };
  const auth = authorizeAdmin(req.headers, req.url);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status, headers });
  const url = new URL(req.url);
  const range = url.searchParams.get('range') ?? '24h';
  if (!['24h', 'today', 'yesterday', '7d'].includes(range)) return Response.json({ error: 'Invalid date range.' }, { status: 400, headers });
  try {
    const data = await readEvents(range, url.searchParams.get('tests') === '1');
    const report = summarize(data.events);
    return Response.json({ ...report, journeys: report.journeys.slice(0, 500), truncated: report.visits > 500,
      start: data.start, end: data.end, first: data.first, updated: new Date().toISOString() }, { headers });
  } catch { return Response.json({ error: 'Traffic storage is unavailable. Configure TRAFFIC_DATABASE_URL or DATABASE_URL and check database connectivity. No zero-traffic claim can be made.' }, { status: 503, headers }); }
}
