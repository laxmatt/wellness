/** Explicit, consented shopping events only. Never pass shopper text or link URLs. */
export const CONSENT_KEY = 'wfc.measurement-consent.v2';
export const CONSENT_EVENT = 'wfc:analytics-consent';
export const MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || 'AW-18455839726';
export const ADS_ID = 'AW-18455839726';
export const ADS_CONVERSION_LABEL = process.env.NEXT_PUBLIC_ADS_RETAILER_CONVERSION_LABEL ?? '';
export type TrafficEvent = 'filter_used' | 'comparison_opened' | 'retailer_handoff';
export type Consent = 'granted' | 'denied';
let activeMeasurementId = '';
type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag; }
}
export function validMeasurementId(id: string) { return /^(?:G-[A-Z0-9]+|AW-[0-9]+)$/.test(id); }
export function readConsent(): Consent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch { return null; }
}
/** Fixed page classes avoid leaking arbitrary path segments or search parameters. */
export function safePage(raw: string) {
  const url = new URL(raw);
  const path = url.pathname;
  const page = path === '/' ? '/' : path === '/saunas' || path.startsWith('/saunas/') ? '/saunas'
    : path.startsWith('/products/') ? '/products' : path === '/compare' ? '/compare' : '/other';
  const safe = new URL(page, url.origin);
  if (url.searchParams.get('utm_campaign') === 'sauna_search_pilot_v1'
    && url.searchParams.get('utm_source') === 'google' && url.searchParams.get('utm_medium') === 'cpc') {
    safe.searchParams.set('utm_source', 'google');
    safe.searchParams.set('utm_medium', 'cpc');
    safe.searchParams.set('utm_campaign', 'sauna_search_pilot_v1');
  }
  // Preserve only Google's click identifiers for consented ad attribution.
  for (const key of ['gclid', 'gbraid', 'wbraid']) {
    const value = url.searchParams.get(key);
    if (value && /^[A-Za-z0-9._~-]{1,512}$/.test(value)) safe.searchParams.set(key, value);
  }
  return { page_location: safe.href, page_title: `Wellness Fit Check: ${page}` };
}
export function referrerOrigin(raw: string) {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) ? u.origin : ''; } catch { return ''; }
}
export function initializeAnalytics(id: string) {
  if (!validMeasurementId(id) || readConsent() !== 'granted' || window.gtag) return;
  activeMeasurementId = id;
  (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = false;
  window.dataLayer = window.dataLayer ?? [];
  // gtag uses the canonical Arguments object queue documented by Google.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = function () { window.dataLayer!.push(arguments); };
  window.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  window.gtag('consent', 'update', { analytics_storage: id.startsWith('G-') ? 'granted' : 'denied', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied' });
  window.gtag('js', new Date());
  window.gtag('config', id, { send_page_view: false, allow_google_signals: false,
    allow_ad_personalization_signals: false, cookie_expires: 86400, cookie_update: false,
    ...safePage(location.href), page_referrer: referrerOrigin(document.referrer) });
  if (id !== ADS_ID) window.gtag('config', ADS_ID, { allow_ad_personalization_signals: false, ...safePage(location.href), page_referrer: referrerOrigin(document.referrer) });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
  script.dataset.wfcAnalytics = 'true';
  document.head.appendChild(script);
}
export function trackTraffic(event: TrafficEvent, categoryId?: string) {
  if (typeof window === 'undefined' || readConsent() !== 'granted' || !window.gtag) return;
  if (!['filter_used', 'comparison_opened', 'retailer_handoff'].includes(event)) return;
  // Category is a controlled enum; no filter values, product selections or shopper text.
  const category = ['saunas', 'cold-plunge', 'red-light', 'wellness-drinks'].includes(categoryId ?? '') ? categoryId : 'unspecified';
  if (!activeMeasurementId.startsWith('G-')) return;
  window.gtag('event', event, { send_to: activeMeasurementId, category_id: category, ...safePage(location.href), page_referrer: referrerOrigin(document.referrer) });
}
export function trackRetailerConversion(label = ADS_CONVERSION_LABEL) {
  if (typeof window === 'undefined' || readConsent() !== 'granted' || !window.gtag || !/^[A-Za-z0-9_-]+$/.test(label)) return;
  window.gtag('event', 'conversion', { send_to: `${ADS_ID}/${label}`, ...safePage(location.href), page_referrer: referrerOrigin(document.referrer) });
}
export function saveConsent(consent: Consent, id: string) {
  try { localStorage.setItem(CONSENT_KEY, consent); } catch { return false; }
  if (consent === 'denied') {
    window.gtag?.('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    // Disable before reload. Remove only our GA cookies, including parent-domain variants.
    (window as unknown as Record<string, unknown>)[`ga-disable-${id}`] = true;
    for (const pair of document.cookie.split(';')) {
      const name = pair.trim().split('=')[0];
      if (!/^(?:_ga(?:_|$)|_gcl_)/.test(name)) continue;
      const base = `${name}=; Max-Age=0; path=/`;
      document.cookie = base;
      const parts = location.hostname.split('.');
      for (let i = 0; i < parts.length - 1; i++) document.cookie = `${base}; domain=.${parts.slice(i).join('.')}`;
    }
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
  return true;
}
