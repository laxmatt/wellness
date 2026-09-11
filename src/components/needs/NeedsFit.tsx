"use client";

import { useState } from "react";
import type { NeedDefinition, NeedState } from "@/domain/needs";
import { cn } from "@/lib/cn";
import { stateOf, useNeeds } from "./NeedsStore";

// "How it fits your needs", on a card and in a comparison column.
//
// Three states, and the third is the point. A filter answers one question, may
// this product be shown, and answers it correctly by refusing anything the
// catalogue cannot settle. A shopper weighing two products is asking a
// different question, and "does not match" and "we cannot tell" are not the
// same news: one rules a product out, the other is something to go and check on
// the maker's page before buying.
//
// Nothing here is a score, a percentage, or a judgement of suitability. It
// reports, requirement by requirement, what the shopper asked for and what this
// catalogue can say about it. The capability score is a separate number
// measuring a different thing, and this never reads it.

const ORDER: Record<NeedState, number> = { miss: 0, unknown: 1, match: 2 };

const COPY: Record<NeedState, { heading: string; className: string; mark: string }> = {
  match: { heading: "Matches", className: "text-positive", mark: "✓" },
  miss: { heading: "Does not match", className: "text-accent-strong", mark: "✕" },
  unknown: { heading: "Needs confirmation", className: "text-fg-soft", mark: "?" },
};

function Row({ need, state }: { need: NeedDefinition; state: NeedState }) {
  const c = COPY[state];
  return (
    <li className="flex gap-2 text-sm leading-snug">
      <span aria-hidden className={cn("font-bold", c.className)}>
        {c.mark}
      </span>
      <span className="min-w-0">
        <span className="sr-only">{c.heading}: </span>
        <span className="font-medium text-fg">{need.label}</span>
        <span className="text-fg-muted"> · {need.groupLabel}</span>
        {state === "unknown" ? <span className="text-fg-soft"> · not stated clearly enough to match on</span> : null}
      </span>
    </li>
  );
}

export function NeedsFit({
  productId,
  categoryId,
  // How many rows to show before the rest go behind a control. The card has a
  // budget; a comparison column does not.
  limit,
  heading = "How it fits your needs",
}: {
  productId: string;
  categoryId: string;
  limit?: number;
  heading?: string;
}) {
  const needs = useNeeds(categoryId);
  const [expanded, setExpanded] = useState(false);
  if (needs.length === 0) return null;

  // Conflicts first, then what to check, then what fits. A shopper scanning a
  // row of cards is looking for the reason to stop.
  const rows = needs
    .map((need) => ({ need, state: stateOf(need, productId) }))
    .sort((a, b) => ORDER[a.state] - ORDER[b.state]);

  const counts = { match: 0, miss: 0, unknown: 0 } as Record<NeedState, number>;
  for (const r of rows) counts[r.state] += 1;

  const shown = limit !== undefined && !expanded ? rows.slice(0, limit) : rows;
  const hidden = rows.length - shown.length;

  return (
    <section data-testid="needs-fit" data-product={productId} className="rounded-card border border-edge bg-surface p-3">
      <p className="text-sm font-semibold text-fg-soft">{heading}</p>
      <p className="mt-0.5 text-xs text-fg-muted">
        {counts.match} of {rows.length} {rows.length === 1 ? "requirement" : "requirements"} met
        {counts.miss > 0 ? `, ${counts.miss} not met` : ""}
        {counts.unknown > 0 ? `, ${counts.unknown} to confirm` : ""}. Your selections, not a rating.
      </p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {shown.map((r) => (
          <Row key={r.need.id} need={r.need} state={r.state} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" onClick={() => setExpanded(true)} className="tap mt-2 text-sm font-semibold text-fg-soft underline-offset-2 hover:text-fg hover:underline">
          Show {hidden} more
        </button>
      ) : null}
      {counts.unknown > 0 ? (
        <p className="mt-2 text-xs leading-snug text-fg-muted">
          Confirm the unconfirmed ones with the maker before you buy. We hold no usable figure for them, so this site will not call them a match or a miss.
        </p>
      ) : null}
    </section>
  );
}

/**
 * What the filters held back because nothing could confirm it.
 *
 * A chip admits only what the catalogue settles, which is right: "under $2,000"
 * must not show a product whose price nobody has confirmed. But the product
 * then leaves the page without a word, and the shopper never learns it exists.
 * Plunge Original is exactly this on the cold plunge page: no usable amount, so
 * every budget chip removes it silently.
 *
 * This changes no filtering. It counts the products the current requirements
 * could neither admit nor rule out, and says so.
 */
export function NeedsHeldBack({ categoryId, ids, visible }: { categoryId: string; ids: string[]; visible: Set<string> }) {
  const needs = useNeeds(categoryId);
  if (needs.length === 0) return null;
  const held = ids.filter((id) => {
    if (visible.has(id)) return false;
    const states = needs.map((n) => stateOf(n, id));
    // Excluded only because something could not be confirmed. A product that
    // definitely fails a requirement is not held back; it is ruled out.
    return !states.includes("miss") && states.includes("unknown");
  });
  if (held.length === 0) return null;
  return (
    <p data-testid="needs-held-back" className="mt-3 text-sm leading-snug text-fg-soft">
      {held.length} {held.length === 1 ? "product is" : "products are"} not shown because we hold no confirmed figure to check against what you picked. {held.length === 1 ? "It is" : "They are"}{" "}
      neither a match nor a miss. Add {held.length === 1 ? "it" : "them"} to a comparison to see which requirement is unconfirmed.
    </p>
  );
}

/**
 * The invitation shown where a fit section would go if the shopper had asked
 * for anything.
 *
 * No preferences means no fit. Nothing is assumed on their behalf and nothing
 * is described as personalized: the section names what it would do and waits.
 */
export function NeedsInvitation({ categoryId, className }: { categoryId: string; className?: string }) {
  const needs = useNeeds(categoryId);
  if (needs.length > 0) return null;
  return (
    <p className={cn("text-sm leading-snug text-fg-soft", className)}>
      Pick a filter above and every card will say where it matches what you asked for, where it does not, and what you would need to confirm.
    </p>
  );
}
