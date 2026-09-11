"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { ImageFrame } from "@/components/ui/ImageFrame";
import { VerificationTag } from "@/components/ui/VerificationTag";
import type { CompareModel } from "@/domain/compare";
import { NeedsFit } from "@/components/needs/NeedsFit";
import { useNeeds } from "@/components/needs/NeedsStore";
import { buttonStyles } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

// One table, two behaviours. Wide screens see every column at once. Narrow
// screens scroll horizontally with snap points on each product column while
// the attribute labels stay pinned to the left edge.
export function CompareView({ model, ids, categoryId }: { model: CompareModel; ids: string[]; categoryId: string }) {
  const [diffOnly, setDiffOnly] = useState(false);
  // The requirements the shopper set on this category's own page. A comparison
  // has no chips, and the products in it are exactly the ones a filter may have
  // excluded: that conflict is the thing worth seeing, not hiding.
  //
  // Read by category, so a column is only ever measured against requirements
  // from its own. The page admits one category at a time, and this keeps that
  // true rather than assuming it.
  const needs = useNeeds(categoryId);
  const removeHref = (id: string) => `/compare?ids=${ids.filter((x) => x !== id).join(",")}`;
  const groups = model.groups
    .map((g) => ({ ...g, rows: diffOnly ? g.rows.filter((r) => !r.same) : g.rows }))
    .filter((g) => g.rows.length > 0);
  const hidden = model.groups.reduce((n, g) => n + g.rows.filter((r) => r.same).length, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          aria-pressed={diffOnly}
          onClick={() => setDiffOnly((v) => !v)}
          className={cn(
            "tap inline-flex items-center gap-2 rounded-pill border px-4 text-sm font-semibold transition-colors",
            diffOnly ? "border-fg bg-fg text-fg-inverse" : "border-edge-strong bg-surface-raised text-fg hover:border-fg",
          )}
        >
          Differences only
          {hidden > 0 ? <span className={cn("tabular text-xs", diffOnly ? "text-fg-inverse/70" : "text-fg-muted")}>{hidden} identical</span> : null}
        </button>
        <p className="text-sm text-fg-muted">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-positive align-middle" aria-hidden />
          Marks the strongest value in a row where higher or lower is better.
        </p>
      </div>

      <div className="-mx-4 max-h-[calc(100dvh-6rem)] snap-x snap-proximity overflow-auto rounded-card border border-edge bg-surface sm:mx-0">
        <table className="w-full table-fixed border-separate border-spacing-0 text-sm" style={{ minWidth: `${152 + model.columns.length * 200}px` }}>
          <colgroup>
            <col style={{ width: 152 }} />
            {model.columns.map((c) => (
              <col key={c.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-edge-strong bg-surface p-2 text-left align-bottom">
                <span className="eyebrow">Product</span>
              </th>
              {model.columns.map((c) => (
                <th key={c.id} className="sticky top-0 z-20 snap-start border-b border-edge-strong bg-surface p-2 text-left align-bottom font-normal">
                  <div className="flex gap-3 rounded-xl bg-surface-raised p-2 shadow-card">
                    <Link href={`/products/${c.slug}`} className="relative block w-14 shrink-0 overflow-hidden rounded-lg">
                      <ImageFrame image={c.image} ratio="1/1" />
                    </Link>
                    <div className="min-w-0">
                      {c.badge ? <Badge kind={c.badge} className="mb-1" /> : null}
                      <p className="eyebrow truncate">{c.brand}</p>
                      <Link href={`/products/${c.slug}`} className="block truncate font-display text-base leading-tight hover:underline">
                        {c.name}
                      </Link>
                      <div className="flex items-baseline gap-2">
                        <p className="tabular font-semibold">{c.price}</p>
                        <Link href={removeHref(c.id)} className="text-xs font-semibold text-fg-muted hover:text-fg">
                          Remove
                        </Link>
                      </div>
                    </div>
                  </div>

                  {/* Going to a retailer took a detour through the product page.
                      Every retailer on the record is offered here by name, in
                      the order the record holds them, and the page never picks
                      one for a shopper. Details is separate and labelled, so
                      leaving the comparison is always a deliberate choice.

                      A product with nothing to link to says so rather than
                      inventing a destination, and nothing here claims stock:
                      an amount was true on a date, which the product page
                      shows and this column does not. */}
                  <div className="mt-2 flex flex-col gap-1.5">
                    {c.merchants.map((m) => (
                      <a
                        key={m.offerId}
                        href={m.url}
                        target="_blank"
                        rel="sponsored nofollow noopener"
                        className={cn(buttonStyles("primary", "sm"), "w-full justify-between gap-2 px-3")}
                      >
                        <span className="truncate">Visit {m.merchant}</span>
                        {m.price ? <span className="tabular shrink-0 opacity-80">{m.price}</span> : null}
                      </a>
                    ))}
                    <Link href={`/products/${c.slug}`} className={cn(buttonStyles("ghost", "sm"), "w-full")}>
                      Details
                    </Link>
                    {c.merchants.length === 0 ? (
                      <p className="text-[11px] leading-snug text-fg-muted">
                        No retailer we can link to for this one. The details page says what we hold.
                      </p>
                    ) : null}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {needs.length > 0 ? (
              <>
                <tr>
                  <th scope="rowgroup" colSpan={model.columns.length + 1} className="sticky left-0 z-10 bg-surface px-2 pb-1 pt-4 text-left">
                    <span className="eyebrow">How it fits your needs</span>
                  </th>
                </tr>
                <tr>
                  <th scope="row" className="sticky left-0 z-10 bg-surface p-2 text-left align-top text-xs font-semibold text-fg-soft">
                    Your selections
                  </th>
                  {model.columns.map((c) => (
                    <td key={c.id} className="p-2 align-top">
                      <NeedsFit productId={c.id} categoryId={categoryId} heading="Against what you picked" />
                    </td>
                  ))}
                </tr>
              </>
            ) : null}
            {/* Keyed by position, not by label. Two groups can carry the same
                label: Wellness Drinks defines a "Buying" group of subscription
                specs, and every category gets a "Buying" group of retailers
                appended by the model. Keying on the label made React see one
                group twice. Position is stable here because the groups are
                built in a fixed order from the category definition and never
                reordered. */}
            {groups.map((g, gi) => (
              <Fragment key={gi}>
                <tr>
                  <th scope="rowgroup" colSpan={model.columns.length + 1} className="sticky left-0 z-10 bg-surface px-2 pb-1 pt-6 text-left">
                    <span className="eyebrow">{g.label}</span>
                  </th>
                </tr>
                {g.rows.map((r) => (
                  <tr key={`${gi}-${r.key}`}>
                    <th scope="row" className={cn("sticky left-0 z-10 bg-surface p-2 text-left align-top text-xs font-semibold", r.same ? "text-fg-muted" : "text-fg-soft")}>
                      {r.label}
                      {r.notComparable ? (
                        <span className="mt-0.5 block font-normal text-[10px] leading-tight text-fg-muted" title={r.notComparable}>
                          {/* The colon becomes a full stop so the qualifier reads as two
                              sentences under a narrow label. The word after it has to be
                              capitalised too: "Not ranked. at least one source" was
                              rendering on every unranked row. */}
                          {r.notComparable.replace(/^Not ranked: (\w)/, (_, c: string) => `Not ranked. ${c.toUpperCase()}`)}
                        </span>
                      ) : null}
                    </th>
                    {r.cells.map((cell, i) => (
                      <td key={model.columns[i].id} className={cn("snap-start border-b border-edge p-2 align-top", r.same && "text-fg-muted")}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {cell.best ? <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-positive" aria-label="Strongest in this row" /> : null}
                          <span className={cn("tabular", cell.best ? "font-bold" : "font-semibold")}>{cell.text}</span>
                          {cell.verification ? <VerificationTag verification={cell.verification} /> : null}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-fg-muted sm:hidden">Swipe the table sideways to see every product.</p>
    </div>
  );
}
