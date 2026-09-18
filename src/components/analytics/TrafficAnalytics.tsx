'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { initializeOpenAIMeasurement, trackOpenAIRetailerClick } from '@/lib/traffic-analytics';
import { CONSENT_EVENT, MEASUREMENT_ID, initializeAnalytics, readConsent, referrerOrigin, safePage, saveConsent, trackTraffic, trackRetailerConversion, validMeasurementId, type Consent } from '@/lib/traffic-analytics';

export function TrafficAnalytics({ measurementId = MEASUREMENT_ID }: { measurementId?: string }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  const lastPage = useRef('');
  const enabled = validMeasurementId(measurementId);
  useEffect(() => {
    const sync = () => { setConsent(readConsent()); setReady(true); };
    sync();
    window.addEventListener(CONSENT_EVENT, sync);
    const external = () => {
      if (window.gtag && readConsent() !== 'granted') {
        saveConsent('denied', measurementId); location.reload();
      } else sync();
    };
    window.addEventListener('storage', external);
    return () => { window.removeEventListener(CONSENT_EVENT, sync); window.removeEventListener('storage', external); };
  }, [measurementId]);
  useEffect(() => {
    if (!enabled || consent !== 'granted') return;
    initializeAnalytics(measurementId);
    initializeOpenAIMeasurement();
    if (lastPage.current !== pathname) {
      lastPage.current = pathname;
      const page = { ...safePage(location.href), page_referrer: referrerOrigin(document.referrer) };
      window.gtag?.('set', page);
      if (measurementId.startsWith('G-')) window.gtag?.('event', 'page_view', { ...page, send_to: measurementId });
    }
    const click = (event: MouseEvent) => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[data-shop-link]') : null;
      if (anchor) { trackTraffic('retailer_handoff', undefined, { product_id: anchor.getAttribute('data-product-id') ?? undefined, product_name: anchor.getAttribute('data-product-name') ?? undefined, retailer_name: anchor.getAttribute('data-retailer-name') ?? undefined }); trackRetailerConversion(); trackOpenAIRetailerClick(); }
    };
    document.addEventListener('click', click);
    document.addEventListener('auxclick', click);
    return () => { document.removeEventListener('click', click); document.removeEventListener('auxclick', click); };
  }, [consent, enabled, pathname, measurementId]);
  if (!enabled || !ready) return null;
  const choose = (choice: Consent) => {
    if (!saveConsent(choice, measurementId)) { setError(true); return; }
    setEditing(false);
    if (choice === 'denied' && consent === 'granted') location.reload();
  };
  return <>
    <div className="mx-auto w-full max-w-7xl px-4 py-3 text-sm">
      <button className="underline" onClick={() => setEditing(true)}>Analytics preferences</button>
    </div>
    {(consent === null || editing) && <section aria-label="Analytics preferences" className="fixed inset-x-3 top-3 z-50 mx-auto max-w-xl rounded-card border border-edge bg-surface-raised p-5 shadow-float">
      <h2 className="font-semibold">Help us improve this site?</h2>
      <p className="mt-2 text-sm">With your permission, Google and OpenAI use cookies and browser information to measure ad performance and clicks to retailers. We opt our measurement events out of advertising personalization. You can change your choice below the footer.</p>
      <Link href="/privacy" className="mt-2 inline-block text-sm underline">How analytics works</Link>
      <div className="mt-3 flex flex-wrap gap-3">
        <button className="tap rounded-pill border border-edge-strong px-4 py-2" onClick={() => choose('denied')}>No thanks</button>
        <button className="tap rounded-pill border border-edge-strong px-4 py-2" onClick={() => choose('granted')}>Allow analytics</button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm">Your browser could not save this choice. Analytics remains off.</p>}
    </section>}
  </>;
}
