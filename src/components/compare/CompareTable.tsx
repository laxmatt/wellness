import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame, primaryImage } from "@/components/ui/ImageFrame";
import { VerificationTag } from "@/components/ui/VerificationTag";
import type { CategoryDefinition } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import { primaryStrength, primaryTradeoff, type RecommendedProduct } from "@/domain/recommend";

// The wrapper is the scroll container on both axes, so product headers stick
// to its top and attribute labels stick to its left while the body scrolls.
export function CompareTable({ items, cat, ids }: { items: RecommendedProduct[]; cat: CategoryDefinition; ids: string[] }) {
  const removeHref = (id: string) => `/compare?ids=${ids.filter((x) => x !== id).join(",")}`;
  return (
    <div className="-mx-4 max-h-[calc(100dvh-5rem)] overflow-auto rounded-card border border-edge bg-surface sm:mx-0">
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: `${160 + items.length * 220}px` }}>
        <colgroup>
          <col style={{ width: 160 }} />
          {items.map((it) => (
            <col key={it.view.id} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 border-b border-edge-strong bg-surface p-2 text-left align-bottom">
              <span className="eyebrow">Product</span>
            </th>
            {items.map((it) => (
              <th key={it.view.id} className="sticky top-0 z-20 border-b border-edge-strong bg-surface p-2 text-left align-bottom font-normal">
                <div className="flex gap-3 rounded-xl bg-surface-raised p-2 shadow-card">
                  <Link href={`/products/${it.view.slug}`} className="relative block w-16 shrink-0 overflow-hidden rounded-lg">
                    <ImageFrame image={primaryImage(it.view.images)} ratio="1/1" />
                  </Link>
                  <div className="min-w-0">
                    {it.badges[0] ? <Badge kind={it.badges[0]} className="mb-1" /> : null}
                    <p className="eyebrow truncate">{it.view.brand.name}</p>
                    <Link href={`/products/${it.view.slug}`} className="block truncate font-display text-base leading-tight hover:underline">
                      {it.view.name}
                    </Link>
                    <div className="flex items-baseline gap-2">
                      <p className="tabular font-semibold">{formatMoney(it.view.price.money)}</p>
                      <Link href={removeHref(it.view.id)} className="text-xs font-semibold text-fg-muted hover:text-fg">
                        Remove
                      </Link>
                    </div>
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
                <span className="text-fg-muted"> / 100</span>
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
                <Link href={`/products/${it.view.slug}#retailers`} className="ml-2 font-semibold text-accent-strong hover:underline">
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <th scope="row" className="sticky left-0 z-10 bg-surface p-2 text-left align-top text-xs font-semibold text-fg-soft">
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-edge p-2 align-top">{children}</td>;
}

function GroupRows({ label, keys, items }: { label: string; keys: string[]; items: RecommendedProduct[] }) {
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={items.length + 1} className="sticky left-0 z-10 bg-surface px-2 pb-1 pt-6 text-left">
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
