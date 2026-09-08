import { SpecRow } from "@/components/ui/SpecRow";
import { VerificationTag } from "@/components/ui/VerificationTag";
import type { CategoryDefinition } from "@/domain/category";
import { attributeDef } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import type { Insight } from "@/domain/recommend";
import type { Provenance } from "@/domain/provenance";
import type { OfferView, ProductView } from "@/domain/view";

const affiliateCopy: Record<OfferView["affiliateStatus"], string> = {
  affiliate: "Affiliate link. We may earn a commission.",
  non_affiliate: "No affiliate relationship.",
  unknown: "No affiliate relationship established.",
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
      <div className="rounded-card border border-line bg-paper p-5 text-sm text-ink-soft">
        No retailer listed yet. Reference price {formatMoney(view.price.money)} from the maker, checked {shortDate(view.price.checkedAt)}.
      </div>
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-paper">
      {view.offers.map((o, i) => (
        <li key={o.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold">{o.merchant.name}</p>
              {i === 0 && view.offers.length > 1 ? <span className="rounded-pill bg-moss-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-moss">Lowest</span> : null}
            </div>
            <p className="mt-0.5 text-xs text-ink-mute">
              {availabilityCopy[o.availability]} · checked {shortDate(o.lastChecked)} · {affiliateCopy[o.affiliateStatus]}
            </p>
            {o.discountCodes.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {o.discountCodes.map((d) => (
                  <li key={d.code} className="inline-flex items-center gap-2 rounded-lg border border-dashed border-line-strong bg-ivory px-2.5 py-1 text-xs">
                    <code className="font-semibold">{d.code}</code>
                    <span className="text-ink-soft">{d.description}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="text-right">
              <p className="tabular text-xl font-semibold">{formatMoney(o.price)}</p>
              {o.listPrice && o.listPrice.amountMinor > o.price.amountMinor ? <p className="tabular text-xs text-ink-mute line-through">{formatMoney(o.listPrice)}</p> : null}
            </div>
            <a href={o.url} target="_blank" rel="sponsored nofollow noopener" className="tap inline-flex items-center rounded-pill bg-ink px-5 text-sm font-semibold text-paper hover:bg-ember-deep">
              Visit {o.merchant.name.replace(/\s*\(direct\)$/, "")}
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SpecGroups({ view, cat }: { view: ProductView; cat: CategoryDefinition }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cat.compareGroups.map((g) => {
        const specs = g.keys.map((k) => view.specs.find((s) => s.key === k)).filter((s): s is NonNullable<typeof s> => s !== undefined);
        const tooltips = g.keys.map((k) => attributeDef(cat, k)).filter((d) => d?.tooltip);
        return (
          <section key={g.label} className="rounded-card border border-line bg-paper p-5">
            <h3 className="eyebrow">{g.label}</h3>
            <div className="mt-2 divide-y divide-line">
              {specs.map((s) => (
                <SpecRow key={s.key} spec={s} />
              ))}
            </div>
            {tooltips.length > 0 ? (
              <details className="mt-3 text-xs text-ink-mute">
                <summary className="tap flex cursor-pointer items-center font-semibold text-ink-soft">About these specs</summary>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {tooltips.map((d) => (
                    <li key={d!.key}>
                      <span className="font-semibold text-ink-soft">{d!.label}: </span>
                      {d!.tooltip}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        );
      })}
      {view.dimensions || view.weight ? (
        <section className="rounded-card border border-line bg-paper p-5">
          <h3 className="eyebrow">Size and weight</h3>
          <div className="mt-2 divide-y divide-line text-sm">
            {view.dimensions ? (
              <div className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-ink-soft">Dimensions</span>
                <span className="flex items-center gap-1.5">
                  <span className="tabular font-semibold">
                    {[view.dimensions.length, view.dimensions.width, view.dimensions.height].filter((n) => n !== undefined).join(" × ")} {view.dimensions.unit}
                  </span>
                  {view.provenance.dimensions ? <VerificationTag verification={view.provenance.dimensions.verification} /> : null}
                </span>
              </div>
            ) : null}
            {view.weight ? (
              <div className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-ink-soft">Weight</span>
                <span className="tabular font-semibold">
                  {view.weight.value} {view.weight.unit}
                </span>
              </div>
            ) : null}
          </div>
        </section>
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
      <section className="rounded-card bg-moss-soft/60 p-5">
        <h3 className="eyebrow text-moss">Strengths</h3>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {strengths.length === 0 ? <li className="text-ink-mute">No standout strengths under our rules.</li> : strengths.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </section>
      <section className="rounded-card bg-ember-soft/60 p-5">
        <h3 className="eyebrow text-ember-deep">Tradeoffs</h3>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {tradeoffs.length === 0 ? <li className="text-ink-mute">No tradeoffs flagged under our rules.</li> : tradeoffs.map((t) => <li key={t}>{t}</li>)}
        </ul>
      </section>
      {neutral.length > 0 ? (
        <section className="rounded-card border border-line bg-paper p-5 md:col-span-2">
          <h3 className="eyebrow">Worth knowing</h3>
          <ul className="mt-2 flex flex-col gap-2 text-sm text-ink-soft">
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
  const byUrl = new Map<string, { url?: string; kind: string; retrievedAt?: string; method: string; fields: string[]; note?: string }>();
  for (const [path, p] of entries) {
    const key = p.source.url ?? `${p.source.kind}:${p.source.ref ?? ""}`;
    const cur = byUrl.get(key) ?? { url: p.source.url, kind: p.source.kind, retrievedAt: p.source.retrievedAt, method: p.source.method, fields: [], note: undefined };
    cur.fields.push(path.replace(/^attributes\./, "").replace(/_/g, " "));
    byUrl.set(key, cur);
  }
  const demoCount = entries.filter(([, p]) => p.verification === "demo").length;
  return (
    <section className="rounded-card border border-line bg-paper p-5 text-sm">
      <h3 className="eyebrow">Sources and updates</h3>
      <p className="mt-2 text-ink-soft">
        Last updated {shortDate(view.lastUpdated)}. {demoCount > 0 ? `${demoCount} field${demoCount === 1 ? "" : "s"} carry demo values, marked on the page.` : ""} Maker-reported figures are not independently verified here.
      </p>
      <ul className="mt-3 flex flex-col gap-2">
        {[...byUrl.values()].map((s, i) => (
          <li key={i} className="flex flex-col gap-0.5 rounded-xl bg-ivory px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold capitalize">{s.kind.replace(/_/g, " ")}</span>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener nofollow" className="truncate text-ember-deep hover:underline">
                  {s.url.replace(/^https?:\/\//, "")}
                </a>
              ) : null}
              {s.retrievedAt ? <span className="text-xs text-ink-mute">retrieved {shortDate(s.retrievedAt)}</span> : null}
              {s.method === "secondhand" ? <span className="rounded-pill border border-line-strong px-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Relayed, not fetched</span> : null}
            </div>
            <p className="text-xs text-ink-mute">{s.fields.join(", ")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
