import type { JourneyEvent } from './model';
const KEY = 'wfc.journey.v1';
export const TEST_KEY = 'wfc.traffic-test';
type Session = { id: string; touched: number; source: JourneyEvent['source']; test: boolean };
export function clearJourney() { try { sessionStorage.removeItem(KEY); } catch {} }
export function sendJourney(event: JourneyEvent['event'], page: JourneyEvent['page'], item?: { product_id?: string; product_name?: string; retailer_name?: string }) {
  if (typeof window === 'undefined' || location.pathname.startsWith('/admin')) return;
  try {
    // Kept independent of third-party script availability; uses the same explicit consent.
    if (localStorage.getItem('wfc.measurement-consent.v3') !== 'granted') return;
    const now = Date.now();
    const params = new URL(location.href).searchParams;
    const test = localStorage.getItem(TEST_KEY) === '1' || location.hostname === 'localhost' || location.hostname === '127.0.0.1' || params.get('utm_content') === 'tracking_test';
    let session: Session | null = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    if (!session || now - session.touched > 30 * 60 * 1000 || session.test !== test) {
      let source: Session['source'] = 'direct';
      if ((params.get('utm_source') === 'google' && params.get('utm_medium') === 'cpc') || ['gclid','gbraid','wbraid'].some(k => params.has(k))) source = 'google_ads';
      else if (params.get('utm_source') === 'chatgpt' && params.get('utm_medium') === 'paid') source = 'chatgpt_ads';
      else if (document.referrer) {
        const ref = new URL(document.referrer);
        if (ref.origin !== location.origin) source = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com)$/.test(ref.hostname) ? 'organic' : 'referral';
      }
      session = { id: crypto.randomUUID(), touched: now, source, test };
    }
    session.touched = now;
    sessionStorage.setItem(KEY, JSON.stringify(session));
    const details = event === 'retailer_handoff' ? {
      product: item?.product_id?.slice(0,160), name: item?.product_name?.slice(0,200), retailer: item?.retailer_name?.slice(0,100),
    } : {};
    void fetch('/api/traffic', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: crypto.randomUUID(), session: session.id, event, page, source: session.source, test: session.test, ...details }),
      keepalive: true, credentials: 'same-origin',
    }).catch(() => {});
  } catch { /* Storage restrictions and tracking failures must never break shopping. */ }
}
