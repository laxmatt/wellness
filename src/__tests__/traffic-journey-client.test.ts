// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { sendJourney } from '@/lib/traffic/client';
const fetchMock = vi.fn().mockResolvedValue({ ok: true });
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); history.replaceState({}, '', '/saunas?utm_source=chatgpt&utm_medium=paid'); });
afterEach(() => vi.unstubAllGlobals());
it('does not collect before consent or after withdrawal', () => {
  sendJourney('page_view','/saunas'); expect(fetchMock).not.toHaveBeenCalled();
  localStorage.setItem('wfc.measurement-consent.v3','denied');
  sendJourney('filter_used','/saunas'); expect(fetchMock).not.toHaveBeenCalled();
});
it('preserves campaign source and session across page changes without forwarding URLs', () => {
  localStorage.setItem('wfc.measurement-consent.v3','granted');
  sendJourney('page_view','/saunas');
  history.replaceState({}, '', '/compare?private=value');
  sendJourney('retailer_handoff','/compare',{product_id:'cascade',product_name:'Cascade',retailer_name:'Select Saunas'});
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  const last = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(last.session).toBe(first.session); expect(last.source).toBe('chatgpt_ads');
  expect(last.retailer).toBe('Select Saunas'); expect(JSON.stringify(last)).not.toContain('private');
});
it('separates test mode into a new visit and avoids admin collection', () => {
  localStorage.setItem('wfc.measurement-consent.v3','granted');
  sendJourney('page_view','/saunas');
  history.replaceState({}, '', '/admin/traffic');
  sendJourney('page_view','/other'); expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('keeps tagged tests excluded after navigation and assigns stable step order', () => {
  localStorage.setItem('wfc.measurement-consent.v3','granted');
  vi.stubGlobal('location', new URL('https://wellnessfitcheck.com/saunas?utm_content=tracking_test'));
  sendJourney('page_view','/saunas');
  vi.stubGlobal('location', new URL('https://wellnessfitcheck.com/compare'));
  sendJourney('comparison_opened','/compare');
  const a = JSON.parse(fetchMock.mock.calls[0][1].body);
  const b = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(b.session).toBe(a.session);
  expect(b.test).toBe(true);
  expect([a.sequence,b.sequence]).toEqual([1,2]);
});
