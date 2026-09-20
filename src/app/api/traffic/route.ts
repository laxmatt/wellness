import { EventInput } from '@/lib/traffic/model';
import { recordEvent } from '@/lib/traffic/store';
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  if (req.headers.get('origin') !== new URL(req.url).origin) return new Response(null, { status: 403, headers });
  if (!req.headers.get('content-type')?.startsWith('application/json')) return new Response(null, { status: 415, headers });
  if (Number(req.headers.get('content-length') ?? 0) > 2048) return new Response(null, { status: 413, headers });
  try {
    const text = await req.text();
    if (text.length > 2048) return new Response(null, { status: 413, headers });
    const parsed = EventInput.safeParse(JSON.parse(text));
    if (!parsed.success) return new Response(null, { status: 400, headers });
    // Browser events are observations, not verified sales or billing records.
    await recordEvent(parsed.data);
    return new Response(null, { status: 204, headers });
  } catch { return new Response(null, { status: 503, headers }); }
}
