import { z } from 'zod';

export const EventInput = z.object({
  id: z.string().uuid(), session: z.string().uuid(),
  event: z.enum(['page_view', 'filter_used', 'comparison_opened', 'retailer_handoff']),
  page: z.enum(['/', '/saunas', '/products', '/compare', '/other']),
  source: z.enum(['google_ads', 'chatgpt_ads', 'organic', 'referral', 'direct']),
  test: z.boolean(), sequence: z.number().int().min(1).max(1000000).optional(),
  product: z.string().max(160).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  retailer: z.string().max(100).regex(/^[^<>\x00-\x1f]+$/).optional(),
  name: z.string().max(200).regex(/^[^<>\x00-\x1f]+$/).optional(),
}).strict();
export type JourneyEvent = z.infer<typeof EventInput> & { at: string };
export const SOURCE_NAMES = { google_ads: 'Google ads', chatgpt_ads: 'ChatGPT ads', organic: 'Organic search', referral: 'Referral', direct: 'Direct / unknown' };
export const EVENT_NAMES = { page_view: 'Viewed', filter_used: 'Used a filter', comparison_opened: 'Opened comparison', retailer_handoff: 'Visited retailer' };

export function summarize(events: JourneyEvent[]) {
  const sessions = new Map<string, JourneyEvent[]>();
  for (const event of events) sessions.set(event.session, [...(sessions.get(event.session) ?? []), event]);
  const journeys = Array.from(sessions, ([id, steps]) => ({ id, steps: steps.sort((a, b) => (a.sequence && b.sequence ? a.sequence - b.sequence : a.at.localeCompare(b.at))) }));
  const engaged = journeys.filter(j => j.steps.some(e => e.event !== 'page_view')).length;
  const handoffs = journeys.filter(j => j.steps.some(e => e.event === 'retailer_handoff')).length;
  const retailers = new Map<string, { retailer: string; product: string; clicks: number }>();
  for (const e of events.filter(e => e.event === 'retailer_handoff')) {
    const key = JSON.stringify([e.retailer, e.product]);
    const row = retailers.get(key) ?? { retailer: e.retailer ?? 'Unknown retailer', product: e.name ?? e.product ?? 'Unknown product', clicks: 0 };
    row.clicks++; retailers.set(key, row);
  }
  return { visits: journeys.length, engaged, handoffs,
    retailerClicks: events.filter(e => e.event === 'retailer_handoff').length,
    sources: Object.entries(SOURCE_NAMES).map(([key, label]) => ({ label, visits: journeys.filter(j => j.steps[0].source === key).length })),
    retailers: [...retailers.values()].sort((a, b) => b.clicks - a.clicks),
    journeys: journeys.sort((a, b) => b.steps.at(-1)!.at.localeCompare(a.steps.at(-1)!.at)),
  };
}
