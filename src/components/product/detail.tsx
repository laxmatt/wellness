import Link from "next/link";
import { isUsable } from "@/domain/provenance";
import { VerificationTag } from "@/components/ui/VerificationTag";
import { buttonStyles } from "@/components/ui/Button";
import type { CategoryDefinition } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import type { Insight } from "@/domain/recommend";
import type { Provenance, Verification } from "@/domain/provenance";
import { displayOfferPrice, type OfferView, type ProductView } from "@/domain/view";
import { cn } from "@/lib/cn";

// What the shopper is told about the link they are about to follow, per
// offer. `unknown` means the record does not say, and it keeps meaning that:
// reading it as "no commission" would quietly answer for an imported offer
// nobody has checked. The site-wide fact, that no programme exists at all, is
// stated once above the list where it belongs, by whoever can confirm it.
const affiliateCopy: Record<OfferView["affiliateStatus"], string> = {
  affiliate: "Affiliate link. We may earn a commission.",
  non_affiliate: "Ordinary link. No commission.",
  unknown: "Affiliate status not recorded for this offer.",
};

const availabilityCopy: Record<OfferView["availability"], string> = {
  in_stock: "In stock",
  backorder: "Backorder",
  preorder: "Preorder",
  out_of_stock: "Out of stock",
  unknown: "Availability not confirmed",
  discontinued: "Discontinued",
};

function shortDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function OfferList({ view }: { view: ProductView }) {
  if (view.offers.length === 0) {
    return (
      <div className="rounded-card border border-edge bg-surface-raised p-5 text-sm text-fg-soft">
        {view.price.isDemo
          ? "No retailer listed yet, and the reference price on file is prototype data rather than a quote, so no amount is shown."
          : `No retailer listed yet. Reference price ${formatMoney(view.price.money)} from the maker, checked ${shortDate(view.price.checkedAt)}.`}
      </div>
    );
  }
  return (
    <>
      {/* One statement, at the top, about the site rather than about a record:
          nothing here is an affiliate link today. Per-offer status stays as
          whatever each record actually says. */}
      <p className="mb-2 text-xs text-fg-muted">
        No affiliate programme is in place for this site, so none of these links earns a commission.{" "}
        <Link href="/disclosure" className="underline-offset-2 hover:underline">
          How this site is paid
        </Link>
        .
      </p>
      <ul className="divide-y divide-edge overflow-hidden rounded-card border border-edge bg-surface-raised">
      {view.offers.map((o, i) => (
        <li key={o.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{o.merchant.name}</p>
              {i === 0 && view.offers.length > 1 ? <span className="rounded-pill bg-positive-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-positive">Lowest</span> : null}
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">
              {availabilityCopy[o.availability]} · checked {shortDate(o.lastChecked)} · {affiliateCopy[o.affiliateStatus]}
            </p>
            {o.discountCodes.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {o.discountCodes.map((d) => (
                  <li key={d.code} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-edge-strong bg-surface px-2.5 py-1 text-xs">
                    <code className="font-semibold">{d.code}</code>
                    <span className="text-fg-soft">{d.description}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="text-right">
              <p className={o.priceIsDemo ? "text-sm font-semibold" : "tabular text-xl font-semibold"}>{displayOfferPrice(o)}</p>
              {!o.priceIsDemo && o.listPrice && o.listPrice.amountMinor > o.price.amountMinor ? (
                <p className="tabular text-xs text-fg-muted line-through">{formatMoney(o.listPrice)}</p>
              ) : null}
            </div>
            <a href={o.url} target="_blank" rel="sponsored nofollow noopener" className={buttonStyles("primary", "md")}>
              Visit {o.merchant.name.replace(/\s*\(direct\)$/, "")}
            </a>
          </div>
        </li>
      ))}
      </ul>
    </>
  );
}

const groupAccent = ["bg-accent", "bg-secondary", "bg-warm", "bg-positive", "bg-tertiary"];

function SpecBlock({ label, value, verification, muted = false }: { label: string; value: string; verification?: Verification; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fg-muted">{label}</p>
      <p className={cn("mt-0.5 flex flex-wrap items-center gap-1.5 text-base", muted ? "text-fg-muted" : "font-semibold text-fg")}>
        <span className="tabular">{value}</span>
        {verification ? <VerificationTag verification={verification} /> : null}
      </p>
    </div>
  );
}

// Specs read as labeled facts grouped under a titled card, not as rows in a
// ledger. Each group gets an accent mark; footnotes collect at the end.
export function SpecGroups({ view, cat }: { view: ProductView; cat: CategoryDefinition }) {
  const footnotes = cat.attributeDefinitions.filter((d) => d.tooltip && view.attributes[d.key] !== undefined);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {cat.compareGroups.map((g, gi) => {
          const specs = g.keys.map((k) => view.specs.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => s !== undefined);
          return (
            <section key={g.label} className="rounded-card bg-surface-raised p-5 shadow-card">
              <div className="flex items-center gap-2.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", groupAccent[gi % groupAccent.length])} aria-hidden />
                <h3 className="font-display text-xl">{g.label}</h3>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
                {specs.map((s) => {
                  const missing = s.raw === undefined;
                  const showTag = !missing && s.provenance && (s.alwaysShowVerification || !isUsable(s.provenance.verification));
                  return <SpecBlock key={s.key} label={s.shortLabel} value={s.formatted} verification={showTag ? s.provenance?.verification : undefined} muted={missing} />;
                })}
              </div>
            </section>
          );
        })}
        {view.dimensions || view.weight ? (
          <section className="rounded-card bg-surface-raised p-5 shadow-card">
            <div className="flex items-center gap-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-fg-muted" aria-hidden />
              <h3 className="font-display text-xl">Size and weight</h3>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4">
              {view.dimensions ? (
                <SpecBlock
                  label="Dimensions"
                  value={`${[view.dimensions.length, view.dimensions.width, view.dimensions.height].filter((n) => n !== undefined).join(" × ")} ${view.dimensions.unit}`}
                  verification={view.provenance.dimensions?.verification === "demo" ? "demo" : undefined}
                />
              ) : null}
              {view.weight ? <SpecBlock label="Weight" value={`${view.weight.value} ${view.weight.unit}`} /> : null}
            </div>
          </section>
        ) : null}
      </div>
      {footnotes.length > 0 ? (
        <details className="rounded-card border border-edge bg-surface px-5 py-3 text-xs text-fg-muted">
          <summary className="tap flex cursor-pointer items-center font-semibold text-fg-soft">How to read these specs</summary>
          <ul className="mt-2 flex flex-col gap-1.5 pb-1">
            {footnotes.map((d) => (
              <li key={d.key}>
                <span className="font-semibold text-fg-soft">{d.label}: </span>
                {d.tooltip}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function InsightsPanel({ insights, view }: { insights: Insight[]; view: ProductView }) {
  const strengths = [...view.editorial.strengths, ...insights.filter((i) => i.tone === "strength").map((i) => i.text)];
  const tradeoffs = [...view.editorial.tradeoffs, ...insights.filter((i) => i.tone === "tradeoff").map((i) => i.text)];
  const neutral = insights.filter((i) => i.tone === "neutral").map((i) => i.text);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section className="rounded-card bg-positive-soft/60 p-5">
        <h3 className="eyebrow text-positive">Strengths</h3>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {strengths.length === 0 ? (
            <li className="text-fg-muted">No strengths flagged from the stated specs.</li>
          ) : (
            strengths.map((t) => <li key={t}>{t}</li>)
          )}
        </ul>
      </section>
      <section className="rounded-card bg-accent-soft/60 p-5">
        <h3 className="eyebrow text-accent-strong">Tradeoffs</h3>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {tradeoffs.length === 0 ? (
            <li className="text-fg-muted">Tradeoffs not assessed. Our rules found nothing to flag from the stated specs, which is not the same as finding none.</li>
          ) : (
            tradeoffs.map((t) => <li key={t}>{t}</li>)
          )}
        </ul>
      </section>
      {neutral.length > 0 ? (
        <section className="rounded-card border border-edge bg-surface-raised p-5 md:col-span-2">
          <h3 className="eyebrow">Worth knowing</h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-fg-soft">
            {neutral.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export function ProvenanceBlock({ view }: { view: ProductView }) {
  const entries = Object.entries(view.provenance) as [string, Provenance][];
  const fieldName = (path: string) => path.replace(/^attributes\./, "").replace(/_/g, " ");
  type Group = {
    url?: string;
    kind: string;
    retrievedAt?: string;
    method: string;
    fields: string[];
    // One entry per distinct note, with the fields that carry it. The notes
    // were being collected and never rendered, so the reason a figure is a
    // bound, or absent, or relayed, existed in the file and nowhere a reader
    // could see it.
    notes: { note: string; fields: string[] }[];
  };
  const byUrl = new Map<string, Group>();
  for (const [path, p] of entries) {
    const key = p.source.url ?? `${p.source.kind}:${p.source.ref ?? ""}`;
    const cur = byUrl.get(key) ?? { url: p.source.url, kind: p.source.kind, retrievedAt: p.source.retrievedAt, method: p.source.method, fields: [], notes: [] };
    cur.fields.push(fieldName(path));
    if (p.source.note) {
      const existing = cur.notes.find((n) => n.note === p.source.note);
      if (existing) existing.fields.push(fieldName(path));
      else cur.notes.push({ note: p.source.note, fields: [fieldName(path)] });
    }
    byUrl.set(key, cur);
  }
  // Three different things, counted and named separately. Lumping them under
  // "demo values" called a figure nobody stated an invention, which is a
  // different accusation and the wrong one.
  const demoCount = entries.filter(([, p]) => p.verification === "demo").length;
  const notStatedCount = entries.filter(([, p]) => p.verification === "not_stated").length;
  const boundCount = entries.filter(([, p]) => p.bound !== undefined).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const sentences = [
    demoCount > 0 ? `${plural(demoCount, "field carries", "fields carry")} demo data, marked on the page.` : null,
    notStatedCount > 0 ? `${plural(notStatedCount, "field is", "fields are")} not stated by the source, so no value is recorded and none is guessed.` : null,
    boundCount > 0 ? `${plural(boundCount, "figure is", "figures are")} a bound the source states rather than an exact value, shown in the words the source used.` : null,
  ].filter(Boolean);
  return (
    <section className="rounded-card border border-edge bg-surface-raised p-5 text-sm">
      <h3 className="eyebrow">Sources and updates</h3>
      <p className="mt-2 text-fg-soft">
        Last updated {shortDate(view.lastUpdated)}. {sentences.join(" ")} Maker-reported figures are not independently verified here.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {[...byUrl.values()].map((s, i) => (
          <li key={i} className="flex flex-col gap-0.5 rounded-xl bg-surface px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold capitalize">{s.kind.replace(/_/g, " ")}</span>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener nofollow" className="truncate text-accent-strong hover:underline">
                  {s.url.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              {s.retrievedAt ? <span className="text-xs text-fg-muted">retrieved {shortDate(s.retrievedAt)}</span> : null}
              {s.method === "secondhand" ? <span className="rounded-pill border border-edge-strong px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-soft">Relayed, not fetched</span> : null}
            </div>
            <p className="text-xs text-fg-muted">{s.fields.join(", ")}</p>
            {s.notes.length > 0 ? (
              <ul className="mt-1 flex flex-col gap-1">
                {s.notes.map((n, j) => (
                  <li key={j} className="text-xs text-fg-soft">
                    <span className="font-semibold">{n.fields.join(", ")}:</span> {n.note}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
