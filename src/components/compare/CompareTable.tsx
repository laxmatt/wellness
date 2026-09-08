import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import { VerificationTag } from "@/components/ui/VerificationTag";
import type { CategoryDefinition } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import { primaryStrength, primaryTradeoff, type RecommendedProduct } from "@/domain/recommend";

// Phase 2 comparison: aligned columns, sticky attribute labels, horizontal
// scroll on narrow screens. Difference highlighting and the mobile carousel
// treatment arrive in Phase 3.
export function CompareTable({ items, cat, ids }: { items: RecommendedProduct[]; cat: CategoryDefinition; ids: string[] }) {
  const removeHref = (id: string) => `/compare?ids=${ids.filter((x) => x !== id).join(",")}`;
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: `${176 + items.length * 230}px` }}>
        <colgroup>
          <col style={{ width: 176 }} />
          {items.map((it) => (
            <col key={it.view.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 z-10 w-36 bg-ivory p-2 text-left align-bottom sm:w-44">
              <span className="eyebrow">Product</span>
            </th>
            {items.map((it) => (
              <th key={it.view.id} className="p-2 text-left align-bottom font-normal">
                <div className="overflow-hidden rounded-card bg-paper shadow-card">
                  <Link href={`/products/${it.view.slug}`} className="relative block">
                    <ImageFrame image={primaryImage(it.view.images)} ratio="1/1" />
                    {it.badges[0] ? (
                      <div className="absolute left-2 top-2">
                        <Badge kind={it.badges[0]} />
                      </div>
                    ) : null}
                  </Link>
                  <div className="p-3">
                    <p className="eyebrow">{it.view.brand.name}</p>
                    <Link href={`/products/${it.view.slug}`} className="font-display text-lg leading-tight hover:underline">
                      {it.view.name}
                    </Link>
                    <p className="tabular mt-1 text-lg font-semibold">{formatMoney(it.view.price.money)}</p>
                    <Link href={removeHref(it.view.id)} className="tap mt-1 inline-flex items-center text-xs font-semibold text-ink-mute hover:text-ink">
                      Remove
                    </Link>
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="Quality score">
            {items.map((it) => (
              <Cell key={it.view.id}>
                <span className="tabular font-semibold">{it.score}</span>
                <span className="text-ink-mute"> / 100</span>
              </Cell>
            ))}
          </Row>
          <Row label="Why">
            {items.map((it) => (
              <Cell key={it.view.id}>{primaryStrength(it.view, cat) ?? "—"}</Cell>
            ))}
          </Row>
          <Row label="Tradeoff">
            {items.map((it) => (
              <Cell key={it.view.id}>{primaryTradeoff(it.view, cat) ?? "None flagged"}</Cell>
            ))}
          </Row>
          {cat.compareGroups.map((g) => (
            <GroupRows key={g.label} label={g.label} keys={g.keys} items={items} />
          ))}
          <Row label="Retailers">
            {items.map((it) => (
              <Cell key={it.view.id}>
                {it.view.offers.length === 0 ? "None listed" : `${it.view.offers.length}, from ${formatMoney(it.view.price.money)}`}
                <Link href={`/products/${it.view.slug}#retailers`} className="ml-2 font-semibold text-ember-deep hover:underline">
                  See
                </Link>
              </Cell>
            ))}
          </Row>
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, children, group = false }: { label: string; children: React.ReactNode; group?: boolean }) {
  return (
    <tr>
      <th scope="row" className={`sticky left-0 z-10 bg-ivory p-2 text-left align-top text-xs font-semibold ${group ? "pt-6 text-ink-mute uppercase tracking-[0.12em]" : "text-ink-soft"}`}>
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-line p-2 align-top">{children}</td>;
}

function GroupRows({ label, keys, items }: { label: string; keys: string[]; items: RecommendedProduct[] }) {
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={items.length + 1} className="sticky left-0 bg-ivory px-2 pb-1 pt-6 text-left">
          <span className="eyebrow">{label}</span>
        </th>
      </tr>
      {keys.map((k) => {
        const specs = items.map((it) => it.view.specs.find((s) => s.key === k));
        const lab = specs.find(Boolean)?.shortLabel ?? k;
        return (
          <Row key={k} label={lab}>
            {items.map((it, i) => {
              const s = specs[i];
              const showTag = s?.provenance && (s.alwaysShowVerification || s.provenance.verification === "demo");
              return (
                <Cell key={it.view.id}>
                  <span className="tabular font-semibold">{s?.formatted ?? "Not stated"}</span>
                  {showTag && s?.provenance ? <VerificationTag verification={s.provenance.verification} className="ml-1.5" /> : null}
                </Cell>
              );
            })}
          </Row>
        );
      })}
    </>
  );
}
