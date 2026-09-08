"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AssistantReply, ProposedAction } from "@/domain/assistant";
import { cn } from "@/lib/cn";
import { useAssistant } from "./AssistantProvider";

// The panel is opt-in and never appears on its own. On wide screens it docks
// beside the page rather than over it, so the products stay readable. On
// phones it is a sheet the shopper opens and closes; closing keeps scroll
// position and every filter already applied.
export function AssistantPanel() {
  const a = useAssistant();
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (a?.open) inputRef.current?.focus();
  }, [a?.open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [a?.messages.length, a?.sending]);

  useEffect(() => {
    if (!a?.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") a.setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [a]);

  if (!a || !a.open) return null;

  const submit = () => {
    const text = draft;
    setDraft("");
    void a.send(text);
  };

  return (
    <aside
      id="assistant-panel"
      aria-label="Shopping assistant"
      className={cn(
        // Phone: a sheet over the lower screen. Desktop: a docked column beside
        // the page, matched by the gutter AssistantDock adds. Never overlapping
        // content on either.
        "fixed z-40 border-edge-strong bg-surface-raised shadow-float",
        "inset-x-0 bottom-0 max-h-[74dvh] rounded-t-card border-t",
        "lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20 lg:w-[21.5rem] lg:max-h-none lg:rounded-card lg:border",
      )}
    >
      <PanelBody a={a} draft={draft} setDraft={setDraft} submit={submit} logRef={logRef} inputRef={inputRef} />
    </aside>
  );
}

function ModeBanner({ reply }: { reply: AssistantReply | null }) {
  if (!reply) return null;
  if (reply.mode === "prototype") {
    return (
      <p className="border-b border-edge bg-warm-soft px-4 py-2 text-xs text-fg">
        <strong>Prototype replies.</strong> No language model is connected yet, so answers come from a small scripted stand-in. Product results below are real and come from the site&apos;s own ranking.
      </p>
    );
  }
  if (reply.mode === "unavailable") {
    return (
      <p className="border-b border-edge bg-accent-soft px-4 py-2 text-xs text-fg">
        <strong>Assistant paused.</strong> {reply.notice ?? "Filters and comparison still work."}
      </p>
    );
  }
  return null;
}

function PanelBody({
  a,
  draft,
  setDraft,
  submit,
  logRef,
  inputRef,
}: {
  a: NonNullable<ReturnType<typeof useAssistant>>;
  draft: string;
  setDraft: (v: string) => void;
  submit: () => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const latest = a.latest;
  return (
    <div className="flex h-full max-h-[74dvh] flex-col lg:max-h-[calc(100dvh-6.5rem)]">
      <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div>
          <p className="font-display text-lg leading-none">Help me choose</p>
          <p className="mt-1 text-xs text-fg-muted">Optional. Everything here can be done with the filters too.</p>
        </div>
        <div className="flex items-center gap-2">
          {a.messages.length > 0 ? (
            <button type="button" onClick={a.reset} className="text-xs font-semibold text-fg-muted hover:text-fg">
              Start over
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => a.setOpen(false)}
            aria-label="Close the assistant"
            className="tap inline-flex items-center justify-center rounded-pill border border-edge-strong bg-surface-raised"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <ModeBanner reply={latest} />

      {a.hard.length > 0 ? (
        <div className="border-b border-edge px-4 py-2">
          <p className="eyebrow">What I am matching on</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {(latest?.activeConstraints ?? []).map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => a.removeConstraint(c.key)}
                  className="tap inline-flex items-center gap-1.5 rounded-pill border border-edge-strong bg-surface px-3 text-xs font-semibold hover:border-fg"
                >
                  {c.label}
                  <span aria-hidden>×</span>
                  <span className="sr-only">Remove this constraint</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3">
        {a.messages.length === 0 ? (
          <div className="text-sm text-fg-soft">
            <p>Tell me what you need and I will narrow the list. For example:</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {["A full-body panel under $700 for a small apartment", "Something I can set up without an electrician", "Zero sugar, no caffeine"].map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => void a.send(s)} className="text-left font-semibold text-accent-strong hover:underline">
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-fg-muted">
              This helps you compare products. It does not give medical advice and will not say a product treats any condition.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-3">
            {a.messages.map((m, i) => (
              <li key={i} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
                <p
                  className={cn(
                    "max-w-[85%] rounded-card px-3.5 py-2 text-sm",
                    m.role === "user" ? "bg-control text-control-fg" : "bg-surface text-fg",
                  )}
                >
                  {m.text}
                </p>
                {a.replies[i] ? <ReplyExtras reply={a.replies[i]} index={i} a={a} /> : null}
              </li>
            ))}
          </ol>
        )}
        {a.sending ? <p className="mt-3 text-sm text-fg-muted">Thinking…</p> : null}
        {a.error ? <p className="mt-3 text-sm text-accent-strong">{a.error}</p> : null}
      </div>

      <form
        className="flex items-center gap-2 border-t border-edge px-3 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor="assistant-input">
          Tell the assistant what matters to you
        </label>
        <input
          id="assistant-input"
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What matters to you?"
          className="tap min-w-0 flex-1 rounded-pill border border-edge-strong bg-surface px-4 text-base text-fg placeholder:text-fg-muted"
        />
        <button
          type="submit"
          disabled={a.sending || draft.trim().length === 0}
          className="tap inline-flex items-center justify-center rounded-pill bg-control px-5 text-sm font-semibold text-control-fg hover:bg-control-hover disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {latest?.usage ? (
        <p className="border-t border-edge px-4 py-1.5 text-[11px] text-fg-muted">
          {latest.usage.sessionTurns} of {latest.usage.sessionTurnLimit} replies used this session · ${latest.usage.monthlySpendUsd.toFixed(2)} of $
          {latest.usage.monthlyCapUsd.toFixed(2)} monthly budget
        </p>
      ) : null}
    </div>
  );
}

function ReplyExtras({ reply, index, a }: { reply: AssistantReply; index: number; a: NonNullable<ReturnType<typeof useAssistant>> }) {
  const dismissed = a.dismissed.includes(index);
  return (
    <div className="flex w-full flex-col gap-2">
      {reply.medicalRedirect ? (
        <p className="rounded-card border border-edge bg-surface px-3 py-2 text-xs text-fg-soft">
          Questions about treating a condition are for a clinician. I can still compare these products on their specifications.
        </p>
      ) : null}

      {reply.question ? (
        <div className="rounded-card border border-edge bg-surface px-3 py-2">
          <p className="text-sm font-semibold">{reply.question.text}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {reply.question.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => void a.send(o)}
                className="tap inline-flex items-center rounded-pill border border-edge-strong bg-surface-raised px-3 text-xs font-semibold hover:border-fg"
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {reply.products.length > 0 ? (
        <div className="rounded-card border border-edge bg-surface px-3 py-2">
          <p className="eyebrow">From the site&apos;s ranking</p>
          <ul className="mt-1.5 flex flex-col gap-2">
            {reply.products.slice(0, 3).map((p) => (
              <li key={p.productId} className="text-sm">
                <Link href={`/products/${p.slug}`} className="font-semibold hover:underline">
                  {p.brand} {p.name}
                </Link>
                <span className="text-fg-muted">
                  {" "}
                  · {p.price}
                  {p.priceIsPlaceholder ? " (placeholder price)" : ""}
                </span>
                {p.fits.length > 0 ? <p className="text-xs text-positive">Fits: {p.fits.slice(0, 2).join("; ")}</p> : null}
                {p.misses.length > 0 ? <p className="text-xs text-accent-strong">Misses: {p.misses.slice(0, 2).join("; ")}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reply.notice ? <p className="text-xs text-fg-muted">{reply.notice}</p> : null}

      {reply.proposals.length > 0 && !dismissed ? (
        <div className="rounded-card border border-dashed border-edge-strong bg-surface px-3 py-2">
          <p className="text-xs font-semibold text-fg-soft">Apply this to the page?</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {reply.proposals.map((p, i) => (
              <li key={i} className="text-sm">
                {p.summary}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                reply.proposals.forEach((p: ProposedAction) => a.accept(p));
                a.dismiss(index);
              }}
              className="tap inline-flex items-center rounded-pill bg-control px-4 text-xs font-semibold text-control-fg hover:bg-control-hover"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => a.dismiss(index)}
              className="tap inline-flex items-center rounded-pill border border-edge-strong bg-surface-raised px-4 text-xs font-semibold hover:border-fg"
            >
              No thanks
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-fg-muted">Nothing changes on the page until you choose Apply.</p>
        </div>
      ) : null}
    </div>
  );
}
