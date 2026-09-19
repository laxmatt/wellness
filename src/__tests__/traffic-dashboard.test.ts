import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventInput, summarize, type JourneyEvent } from '@/lib/traffic/model';
vi.mock('@/lib/traffic/store', () => ({ recordEvent: vi.fn(), readEvents: vi.fn() }));
import { recordEvent, readEvents } from '@/lib/traffic/store';
import { POST } from '@/app/api/traffic/route';
import { GET } from '@/app/api/admin/traffic/route';
const event = { id: '5c1882c7-70b7-43c6-8ec0-7f5a888386ef', session: '2c1882c7-70b7-43c6-8ec0-7f5a888386ef', event: 'page_view' as const, page: '/saunas' as const, source: 'chatgpt_ads' as const, test: false };
beforeEach(() => { vi.clearAllMocks(); process.env.ADMIN_ACCESS_KEY = 'local-test-only'; });
describe('traffic reports', () => {
  it('counts unique visits and retailer clicks separately, retaining ordered steps', () => {
    const rows: JourneyEvent[] = [
      { ...event, at: '2026-09-18T12:00:00Z' },
      { ...event, id: '2', event: 'retailer_handoff', retailer: 'Select Saunas', product: 'cascade', name: 'Cascade', at: '2026-09-18T12:02:00Z' },
      { ...event, id: '3', event: 'filter_used', at: '2026-09-18T12:01:00Z' },
      { ...event, id: '4', event: 'retailer_handoff', retailer: 'Select Saunas', product: 'cascade', name: 'Cascade', at: '2026-09-18T12:03:00Z' },
    ];
    const report = summarize(rows);
    expect(report).toMatchObject({ visits: 1, engaged: 1, handoffs: 1, retailerClicks: 2 });
    expect(report.journeys[0].steps.map(e => e.event)).toEqual(['page_view','filter_used','retailer_handoff','retailer_handoff']);
    expect(report.retailers[0].clicks).toBe(2);
  });
  it('rejects arbitrary URLs and extra visitor data', () => {
    expect(EventInput.safeParse({ ...event, page: '/products/private-query' }).success).toBe(false);
    expect(EventInput.safeParse({ ...event, email: 'private@example.com' }).success).toBe(false);
  });
  it('blocks cross-origin collection before storage', async () => {
    const res = await POST(new Request('https://wellnessfitcheck.com/api/traffic', { method: 'POST', headers: { origin: 'https://elsewhere.com', 'content-type': 'application/json' }, body: JSON.stringify(event) }));
    expect(res.status).toBe(403); expect(recordEvent).not.toHaveBeenCalled();
  });
  it('stores validated events', async () => {
    const res = await POST(new Request('https://wellnessfitcheck.com/api/traffic', { method: 'POST', headers: { origin: 'https://wellnessfitcheck.com', 'content-type': 'application/json' }, body: JSON.stringify(event) }));
    expect(res.status).toBe(204); expect(recordEvent).toHaveBeenCalledWith(event);
  });
  it('never returns report data without admin authentication', async () => {
    expect((await GET(new Request('https://wellnessfitcheck.com/api/admin/traffic'))).status).toBe(401);
    expect(readEvents).not.toHaveBeenCalled();
  });
  it('excludes tests by default and prevents caching', async () => {
    vi.mocked(readEvents).mockResolvedValue({ events: [], start: 'start', end: 'end', first: null });
    const res = await GET(new Request('https://wellnessfitcheck.com/api/admin/traffic?range=24h', { headers: { 'x-admin-key': 'local-test-only' } }));
    expect(readEvents).toHaveBeenCalledWith('24h', false);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('shows storage failure rather than false zero counts', async () => {
    vi.mocked(readEvents).mockRejectedValue(new Error('offline'));
    const res = await GET(new Request('https://wellnessfitcheck.com/api/admin/traffic', { headers: { 'x-admin-key': 'local-test-only' } }));
    expect(res.status).toBe(503); expect(await res.json()).not.toHaveProperty('visits');
  });
});
