'use client';
import { useRef, useState } from 'react';
import { EVENT_NAMES, SOURCE_NAMES, summarize } from '@/lib/traffic/model';
import { clearJourney, TEST_KEY } from '@/lib/traffic/client';
type Report = ReturnType<typeof summarize> & { start: string; end: string; first: string | null; updated: string; truncated: boolean };
const time = (s: string) => new Date(s).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export default function TrafficDashboard() {
  const [key, setKey] = useState('');
  const [range, setRange] = useState('24h');
  const [tests, setTests] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testNotice, setTestNotice] = useState('');
  const generation = useRef(0);
  async function load() {
    const request = ++generation.current;
    setBusy(true); setError(''); setReport(null);
    try {
      const res = await fetch(`/api/admin/traffic?range=${range}&tests=${tests ? '1' : '0'}`, { headers: { 'x-admin-key': key }, cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load traffic.');
      if (request === generation.current) setReport(data);
    } catch (e) { if (request === generation.current) setError(e instanceof Error ? e.message : 'Could not load traffic.'); }
    finally { if (request === generation.current) setBusy(false); }
  }
  function invalidate() { generation.current++; setReport(null); setBusy(false); setError(''); }
  const box = 'rounded-2xl border border-edge bg-surface-raised p-5';
  return <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8">
    <header><a href="/admin" className="text-sm underline">Wellness Fit Check / Admin</a><h1 className="mt-4 font-display text-4xl">Traffic &amp; conversions</h1><p className="mt-3 max-w-3xl text-fg-soft">See how recorded visits move from browsing to a retailer. Only visitors who allow analytics appear here. Retailer clicks are not purchases.</p></header>
    <form className={`${box} flex flex-wrap items-end gap-4`} onSubmit={e => { e.preventDefault(); void load(); }}>
      <label className="grid gap-2 text-sm">Admin access key<input type="password" autoComplete="off" value={key} required onChange={e => { invalidate(); setKey(e.target.value); }} className="rounded-lg border border-edge bg-surface p-2" /></label>
      <label className="grid gap-2 text-sm">Period<select value={range} onChange={e => { invalidate(); setRange(e.target.value); }} className="rounded-lg border border-edge bg-surface p-2"><option value="24h">Last 24 hours</option><option value="today">Today</option><option value="yesterday">Yesterday</option><option value="7d">Last 7 days</option></select></label>
      <label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" checked={tests} onChange={e => { invalidate(); setTests(e.target.checked); }} />Include test visits</label>
      <button disabled={busy} className="rounded-full bg-fg px-6 py-2 text-surface disabled:opacity-50">{busy ? 'Loading…' : 'Load report'}</button>
      <p className="w-full text-xs text-fg-soft">The key stays in this page’s memory. Dates use Pacific time; last 24 hours is a rolling window.</p>
    </form>
    {error && <p role="alert" className={`${box} border-red-400`}>{error}</p>}
    {!report && !error && !busy && <section className={box}><h2 className="text-xl font-semibold">Ready to connect</h2><p className="mt-2">Enter your admin key to load recorded visits. This report does not import past Google Analytics activity or ad-platform click counts.</p></section>}
    {report && <>
      <div className="text-sm text-fg-soft"><p>{time(report.start)} – {time(report.end)} Pacific · Updated {time(report.updated)}</p><p>{tests ? 'Includes test visits.' : 'Marked test visits excluded.'} {report.first ? `First stored event: ${time(report.first)}.` : 'No events have been stored yet.'}</p></div>
      {report.truncated && <p role="status" className={box}>This report is capped at the 501 most recently active visits. Totals describe that sample; 500 journeys are displayed.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Recorded visits',report.visits],['Visits with an action',report.engaged],['Visits with retailer click',report.handoffs],['Retailer clicks',report.retailerClicks]].map(([label,value]) => <section className={box} key={label}><p className="text-sm text-fg-soft">{label}</p><p className="mt-2 text-4xl font-semibold">{value}</p></section>)}</div>
      <section className={box}><h2 className="text-xl font-semibold">Visit outcomes</h2><p className="mt-2 text-sm text-fg-soft">Visits active in the selected period, with their earlier steps included. These are visit-level outcomes, not a required sequence. An action means a filter, comparison, or retailer click.</p><div className="mt-4 space-y-3">{[['Any recorded activity',report.visits],['Shopping action',report.engaged],['Retailer click',report.handoffs]].map(([label,n]) => { const pct = report.visits ? Number(n)/report.visits*100 : 0; return <div key={label}><div className="flex justify-between text-sm"><span>{label}</span><span>{n} · {pct.toFixed(1)}%</span></div><div className="mt-1 h-3 overflow-hidden rounded-full bg-edge"><div className="h-full bg-emerald-700" style={{width:`${pct}%`}} /></div></div>; })}</div></section>
      <div className="grid gap-4 lg:grid-cols-2"><section className={box}><h2 className="text-xl font-semibold">Where visits came from</h2><ul className="mt-4 divide-y divide-edge">{report.sources.map(s => <li className="flex justify-between py-3" key={s.label}><span>{s.label}</span><strong>{s.visits}</strong></li>)}</ul><p className="mt-3 text-xs text-fg-soft">Source comes from the first recorded page’s campaign tags or referrer. Missing tags may appear as Direct / unknown. This is not platform-verified attribution.</p></section>
      <section className={box}><h2 className="text-xl font-semibold">Retailers &amp; saunas clicked</h2>{!report.retailers.length ? <p className="mt-4 text-fg-soft">No retailer clicks recorded in these visits.</p> : <ul className="mt-4 max-h-96 overflow-auto divide-y divide-edge">{report.retailers.map((r,i) => <li key={i} className="py-3"><div className="flex justify-between gap-4"><strong>{r.retailer}</strong><span>{r.clicks} clicks</span></div><p className="text-sm text-fg-soft">{r.product}</p></li>)}</ul>}</section></div>
      <section className={box}><h2 className="text-xl font-semibold">Anonymous visitor journeys</h2><p className="mt-2 text-sm text-fg-soft">Each visit is one browser tab, ending after 30 minutes of inactivity. No names, email addresses, or IP addresses are stored. Steps before analytics consent are unavailable.</p>{!report.journeys.length && <p className="mt-5">No recorded visits for this period. This does not mean the site had no visitors.</p>}<div className="mt-4 divide-y divide-edge">{report.journeys.map((j,i) => <details className="py-4" key={j.id}><summary className="cursor-pointer"><strong>Visit {i+1}</strong> · {SOURCE_NAMES[j.steps[0].source]} · {time(j.steps[0].at)} · {j.steps.length} steps {j.steps.some(e=>e.test) ? '· TEST' : ''}</summary><ol className="ml-4 mt-4 space-y-3 border-l border-edge pl-4">{j.steps.map(e => <li key={e.id}><span className="text-xs text-fg-soft">{time(e.at)} · </span>{EVENT_NAMES[e.event]} {e.event === 'page_view' ? e.page : ''}{e.event === 'retailer_handoff' && <span> — {e.retailer ?? 'Unknown retailer'}<span className="block text-sm text-fg-soft">{e.name ?? e.product ?? 'Unknown product'}</span></span>}</li>)}</ol></details>)}</div></section>
    </>}
    <section className={box}><h2 className="font-semibold">Keep your own browsing separate</h2><p className="mt-2 text-sm text-fg-soft">Mark future visits from this browser as tests before checking shopping links. This affects this dashboard, not Google or ChatGPT’s reporting.</p><div className="mt-3 flex flex-wrap gap-3"><button className="rounded-full border border-edge px-4 py-2 text-sm" onClick={() => { try { localStorage.setItem(TEST_KEY,'1'); clearJourney(); setTestNotice('Future visits from this browser are marked as tests.'); } catch { setTestNotice('Browser storage is unavailable.'); } }}>Mark this browser as test</button><button className="rounded-full border border-edge px-4 py-2 text-sm" onClick={() => { try { localStorage.removeItem(TEST_KEY); clearJourney(); setTestNotice('Future visits from this browser are no longer marked as tests.'); } catch { setTestNotice('Browser storage is unavailable.'); } }}>Stop marking tests</button></div><p role="status" className="mt-2 text-sm">{testNotice}</p></section>
  </main>;
}
