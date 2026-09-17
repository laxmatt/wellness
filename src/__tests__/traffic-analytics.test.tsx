// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TrafficAnalytics } from '@/components/analytics/TrafficAnalytics';
import { CONSENT_KEY, initializeAnalytics, initializeOpenAIMeasurement, trackOpenAIRetailerClick, referrerOrigin, safePage, saveConsent, trackTraffic, trackRetailerConversion } from '@/lib/traffic-analytics';
vi.mock('next/navigation', () => ({ usePathname: () => '/saunas' }));
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a> }));
beforeEach(() => {
  cleanup(); localStorage.clear(); delete window.gtag; delete window.dataLayer; delete window.oaiq;
  document.querySelectorAll('script[data-wfc-analytics],script[data-wfc-openai]').forEach(el => el.remove());
});
const commands = () => (window.dataLayer ?? []).map(value => Array.from(value as ArrayLike<unknown>));
describe('optional traffic measurement', () => {
  it('makes no Google request before consent or after declining', () => {
    render(<TrafficAnalytics measurementId="G-TEST123" />);
    expect(document.querySelector('script[data-wfc-analytics]')).toBeNull();
    fireEvent.click(screen.getByText('No thanks'));
    initializeAnalytics('G-TEST123');
    trackTraffic('retailer_handoff');
    expect(window.dataLayer).toBeUndefined();
    expect(document.querySelector('script[data-wfc-analytics]')).toBeNull();
  });
  it('loads one tag and page view after allowing, then counts a retailer click once', () => {
    render(<><TrafficAnalytics measurementId="G-TEST123" /><a href="https://retailer.example/?private=secret" data-shop-link="">Visit retailer</a></>);
    fireEvent.click(screen.getByText('Allow analytics'));
    initializeAnalytics('G-TEST123');
    expect(document.querySelectorAll('script[data-wfc-analytics]')).toHaveLength(1);
    expect(commands().filter(x => x[1] === 'page_view')).toHaveLength(1);
    expect(commands().filter(x => x[1] === 'conversion')).toHaveLength(0);
    fireEvent.click(screen.getByText('Visit retailer'));
    expect(commands().filter(x => x[1] === 'retailer_handoff')).toHaveLength(1);
    expect(commands().filter(x => x[1] === 'conversion')).toHaveLength(1);
    expect(commands().find(x => x[1] === 'conversion')?.[2]).toMatchObject({ send_to: 'AW-18455839726/L5m_CMSpifocEO6Ht-BE' });
    expect(commands().find(x => x[1] === 'conversion')?.[2]).not.toHaveProperty('value');
    expect(JSON.stringify(commands())).not.toContain('private=secret');
    expect(commands().find(x => x[0] === 'config')?.[2]).toMatchObject({ send_page_view: false, allow_google_signals: false });
  });
  it('removes GA cookies and blocks new events on withdrawal', () => {
    localStorage.setItem(CONSENT_KEY, 'granted'); initializeAnalytics('G-TEST123');
    document.cookie = '_ga=sample; path=/';
    saveConsent('denied', 'G-TEST123'); const count = commands().length;
    trackTraffic('retailer_handoff');
    expect(commands()).toHaveLength(count); expect(document.cookie).not.toContain('_ga=');
    expect((window as unknown as Record<string, unknown>)['ga-disable-G-TEST123']).toBe(true);
  });
  it('does not expose a banner or tag when deployment has no valid ID', () => {
    render(<TrafficAnalytics measurementId="" />);
    expect(screen.queryByText('Allow analytics')).toBeNull();
    localStorage.setItem(CONSENT_KEY, 'granted'); initializeAnalytics('bad-id');
    expect(window.gtag).toBeUndefined();
  });
  it('configures Ads after consent and requires a label for retailer conversions', () => {
    initializeAnalytics('AW-18455839726');
    expect(window.gtag).toBeUndefined();
    localStorage.setItem(CONSENT_KEY, 'granted');
    initializeAnalytics('AW-18455839726');
    expect(commands().some(x => x[0] === 'config' && x[1] === 'AW-18455839726')).toBe(true);
    trackRetailerConversion('');
    expect(commands().filter(x => x[1] === 'conversion')).toHaveLength(0);
    trackRetailerConversion('test_label');
    expect(commands().filter(x => x[1] === 'conversion')).toHaveLength(1);
    expect(commands().find(x => x[1] === 'conversion')?.[2]).toMatchObject({ send_to: 'AW-18455839726/test_label' });
    document.cookie = '_gcl_aw=test; path=/';
    saveConsent('denied', 'AW-18455839726');
    trackRetailerConversion('test_label');
    expect(commands().filter(x => x[1] === 'conversion')).toHaveLength(1);
    expect(document.cookie).not.toContain('_gcl_aw=');
  });
  it('retains ad attribution identifiers without arbitrary query fields', () => {
    expect(safePage('https://wellnessfitcheck.com/saunas?gclid=Abc-123&email=private').page_location).toBe('https://wellnessfitcheck.com/saunas?gclid=Abc-123');
  });
  it('removes arbitrary URL data while retaining the exact pilot campaign', () => {
    const page = safePage('https://wellnessfitcheck.com/saunas?utm_source=google&utm_medium=cpc&utm_campaign=sauna_search_pilot_v1&email=private&text=health#gclid');
    expect(page.page_location).toBe('https://wellnessfitcheck.com/saunas?utm_source=google&utm_medium=cpc&utm_campaign=sauna_search_pilot_v1');
    expect(safePage('https://wellnessfitcheck.com/products/private-text?ids=private').page_location).toBe('https://wellnessfitcheck.com/products');
    expect(referrerOrigin('https://example.com/search?q=health')).toBe('https://example.com');
    expect(referrerOrigin('javascript:secret')).toBe('');
  });
});

describe('OpenAI retailer measurement', () => {
  it('loads only after consent and sends a handoff without retailer URL or purchase value', () => {
    initializeOpenAIMeasurement();
    expect(window.oaiq).toBeUndefined();
    localStorage.setItem(CONSENT_KEY, 'granted');
    initializeOpenAIMeasurement(); initializeOpenAIMeasurement();
    expect(document.querySelectorAll('script[data-wfc-openai]')).toHaveLength(1);
    trackOpenAIRetailerClick();
    expect(window.oaiq?.q).toContainEqual(['measure', 'custom', {type: 'custom'}, {custom_event_name: 'retailer_handoff', opt_out: true}]);
    document.cookie = '__oppref=test; path=/';
    saveConsent('denied', 'AW-18455839726');
    const count = window.oaiq?.q.length;
    trackOpenAIRetailerClick();
    expect(window.oaiq?.q.length).toBe(count);
    expect(window.oaiq?.q.at(-1)).toEqual(['consent', false]);
    expect(document.cookie).not.toContain('__oppref=');
  });
  it('does not treat earlier Google-only consent as approval for OpenAI', () => {
    localStorage.setItem('wfc.measurement-consent.v2', 'granted');
    initializeOpenAIMeasurement();
    expect(window.oaiq).toBeUndefined();
  });
});
