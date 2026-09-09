"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AssistantProductRef, AssistantReply, ProposedAction } from "@/domain/assistant";
import { cn } from "@/lib/cn";
import { useAssistant } from "./AssistantProvider";

// The panel is opt-in and never appears on its own. On wide screens it docks
// beside the page rather than over it. On phones it is a sheet the shopper
// opens and closes; closing keeps scroll position and every filter applied.
export function AssistantPanel() {
  const a = useAssistant();
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);

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

  // The on-screen keyboard shrinks the visual viewport without moving the
  // layout viewport, so a bottom-anchored sheet ends up underneath it. Lifting
  // the sheet by the difference keeps the input, Send and Close reachable and
  // the conversation scrollable while typing.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : undefined;
    if (!a?.open || !vv) return;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardInset(inset);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      setKeyboardInset(0);
    };
  }, [a?.open]);

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
      style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
      className={cn(
        "fixed z-40 border-edge-strong bg-surface-raised shadow-float",
        "inset-x-0 bottom-0 rounded-t-card border-t",
        "lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20 lg:w-[23rem] lg:rounded-card lg:border",
      )}
    >
      <PanelBody a={a} draft={draft} setDraft={setDraft} submit={submit} logRef={logRef} inputRef={inputRef} keyboardInset={keyboardInset} />
    </aside>
  );
}

function ModeBanner({ reply }: { reply: AssistantReply | null }) {
  if (!reply) return null;
  if (reply.mode === "prototype") {
    return (
      <p className="border-b border-edge bg-warm-soft px-4 py-2.5 text-sm leading-snug text-fg">
        <strong>Prototype replies.</strong> No language model is connected yet, so answers come from a small scripted stand-in. The products listed are real and come from the
        site&apos;s own ranking.
      </p>
    );
  }
  if (reply.mode === "unavailable") {
    return (
      <p className="border-b border-edge bg-accent-soft px-4 py-2.5 text-sm leading-snug text-fg">
        <strong>The assistant is unavailable right now.</strong> Filters, product pages and comparison all still work.
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
  keyboardInset,
}: {
  a: NonNullable<ReturnType<typeof useAssistant>>;
  draft: string;
  setDraft: (v: string) => void;
  submit: () => void;
  logRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  keyboardInset: number;
}) {
  const latest = a.latest;
  // With the keyboard up there is far less room, so the sheet takes what is
  // left rather than a fixed share of a viewport that no longer exists.
  const heightClass = keyboardInset > 0 ? "max-h-[min(60dvh,26rem)]" : "max-h-[74dvh]";
  return (
    <div className={cn("flex h-full flex-col", heightClass, "lg:max-h-[calc(100dvh-6.5rem)]")}>
      <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3">
        <div className="min-w-0">
          <p className="font-display text-lg leading-none">Help me choose</p>
          <p className="mt-1 text-sm leading-snug text-fg-soft">Optional. The filters do the same job.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {a.messages.length > 0 ? (
            <button type="button" onClick={a.reset} className="tap inline-flex items-center rounded-pill px-2 text-sm font-semibold text-fg-soft hover:text-fg">
              Start over
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => a.setOpen(false)}
            aria-label="Close the assistant"
            className="tap inline-flex items-center justify-center rounded-pill border border-edge-strong bg-surface-raised hover:border-fg"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      <ModeBanner reply={latest} />

      {a.hard.length > 0 ? (
        <div className="border-b border-edge px-4 py-2.5">
          <p className="text-sm font-semibold text-fg-soft">What I am matching on</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {(latest?.activeConstraints ?? []).map((c) => (
              <li key={c.key}>
                <button
                  type="button"
                  onClick={() => a.removeConstraint(c.key)}
                  className="tap inline-flex items-center gap-2 rounded-pill border border-edge-strong bg-surface px-3.5 text-sm font-semibold hover:border-fg"
                >
                  {c.label}
                  <span aria-hidden className="text-base leading-none">
                    ×
                  </span>
                  <span className="sr-only">Remove this constraint</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div ref={logRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {a.messages.length === 0 ? (
          <div className="text-base leading-relaxed text-fg-soft">
            <p>Tell me what you need and I will narrow the list. For example:</p>
            <ul className="mt-3 flex flex-col gap-2">
              {["A full-body panel under $700 for a small apartment", "Something I can set up without an electrician", "Zero sugar, no caffeine"].map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => void a.send(s)}
                    className="tap w-full rounded-card border border-edge bg-surface px-3.5 py-2 text-left text-sm font-semibold text-fg hover:border-fg"
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm leading-snug text-fg-soft">
              This helps you compare products. It does not give medical advice and will not say a product treats any condition.
            </p>
          </div>
        ) : (
          <ol className="flex flex-col gap-4">
            {a.messages.map((m, i) => (
              <li key={i} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
                <p
                  className={cn(
                    "max-w-[88%] rounded-card px-4 py-2.5 text-base leading-relaxed",
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
        {a.sending ? <p className="mt-3 text-base text-fg-soft">Thinking…</p> : null}
        {a.error ? <p className="mt-3 text-base text-accent-strong">{a.error}</p> : null}
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
          enterKeyHint="send"
          autoComplete="off"
          placeholder="What matters to you?"
          // 16px minimum: anything smaller makes iOS zoom the page on focus.
          className="tap min-w-0 flex-1 rounded-pill border border-edge-strong bg-surface px-4 text-base text-fg placeholder:text-fg-muted"
        />
        <button
          type="submit"
          disabled={a.sending || draft.trim().length === 0}
          className="tap inline-flex shrink-0 items-center justify-center rounded-pill bg-control px-5 text-base font-semibold text-control-fg hover:bg-control-hover disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function ProductLine({ p }: { p: AssistantProductRef }) {
  return (
    <li className="text-base">
      <Link href={`/products/${p.slug}`} className="font-semibold hover:underline">
        {p.brand} {p.name}
      </Link>
      <span className="text-fg-soft"> · {p.priceIsPlaceholder ? "price not stated" : p.price}</span>
      {p.facts.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {p.facts.map((f) => (
            <li key={f.label} className="text-sm leading-snug text-fg-soft">
              <span className="font-medium text-fg">{f.label}:</span> {f.value} <span className="text-fg-muted">({f.attribution})</span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.fits.length > 0 ? <p className="mt-0.5 text-sm leading-snug text-positive">Fits: {p.fits.slice(0, 2).join("; ")}</p> : null}
      {p.misses.length > 0 ? <p className="mt-0.5 text-sm leading-snug text-accent-strong">Misses: {p.misses.slice(0, 2).join("; ")}</p> : null}
    </li>
  );
}

function ReplyExtras({ reply, index, a }: { reply: AssistantReply; index: number; a: NonNullable<ReturnType<typeof useAssistant>> }) {
  const dismissed = a.dismissed.includes(index);
  // Each is its own decision, taken on its own button, and it stays available
  // after Apply: applying what the assistant proposed is not a reason to
  // withdraw the choice it was asking about.
  const [primaryDone, setPrimaryDone] = useState(false);
  const [setAside, setSetAside] = useState<string[]>([]);
  const alternatives = reply.proposals
    .filter((p): p is Extract<ProposedAction, { kind: "relax_constraint" }> => p.kind === "relax_constraint")
    .filter((p) => !setAside.includes(p.key));
  const primary = reply.proposals.filter((p) => p.kind !== "relax_constraint");
  const proposed = reply.proposals.find((p): p is Extract<ProposedAction, { kind: "apply_preferences" }> => p.kind === "apply_preferences");
  // Once a constraint has been set aside, the original Apply would put it back:
  // it still carries the proposal as first offered. It is retired rather than
  // left standing, because the alternative has already applied the same
  // proposal without that constraint.
  const showPrimary = !dismissed && !primaryDone && setAside.length === 0 && primary.length > 0;
  const showAlternatives = !dismissed && alternatives.length > 0;
  return (
    <div className="flex w-full flex-col gap-2.5">
      {reply.medicalRedirect ? (
        <p className="rounded-card border border-edge bg-surface px-3.5 py-2.5 text-sm leading-snug text-fg-soft">
          Questions about treating a condition are for a clinician. I can still compare these products on their specifications.
        </p>
      ) : null}

      {reply.question ? (
        <div className="rounded-card border border-edge bg-surface px-3.5 py-3">
          <p className="text-base font-semibold">{reply.question.text}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {reply.question.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => void a.answerQuestion(o, reply.question!, index)}
                className="tap inline-flex items-center rounded-pill border border-edge-strong bg-surface-raised px-3.5 text-sm font-semibold hover:border-fg"
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* The site's own count, not the assistant's. Rendered on every reply,
          including the ones with nothing to show and the ones where the
          assistant's answer could not be read, because those are exactly the
          cases where the prose above is least trustworthy. */}
      {reply.matchSummary ? (
        <p data-testid="match-summary" className="rounded-card border border-edge bg-surface px-3.5 py-2.5 text-sm leading-snug">
          <span className="font-semibold">{reply.matchSummary}</span>{" "}
          <span className="text-fg-soft">Counted by this site, not by the assistant.</span>
        </p>
      ) : null}

      {reply.products.length > 0 ? (
        <div className="rounded-card border border-edge bg-surface px-3.5 py-3">
          <p className="text-sm font-semibold text-fg-soft">Matching products, from the site&apos;s ranking</p>
          <ul className="mt-2 flex flex-col gap-2.5">
            {reply.products.map((p) => (
              <ProductLine key={p.productId} p={p} />
            ))}
          </ul>
        </div>
      ) : null}

      {reply.unconfirmedPrice.length > 0 ? (
        <div className="rounded-card border border-dashed border-edge-strong bg-surface px-3.5 py-3">
          <p className="text-sm font-semibold text-fg-soft">Price not confirmed</p>
          <p className="mt-1 text-sm leading-snug text-fg-soft">
            These fit everything else you asked for, but we hold no verified price for them, so we cannot say whether they meet your budget.
          </p>
          <ul className="mt-2 flex flex-col gap-2.5">
            {reply.unconfirmedPrice.map((p) => (
              <li key={p.productId} className="text-base">
                <Link href={`/products/${p.slug}`} className="font-semibold hover:underline">
                  {p.brand} {p.name}
                </Link>
                <span className="text-fg-soft"> · {p.price} listed, unverified</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reply.notice ? <p className="text-sm leading-snug text-fg-soft">{reply.notice}</p> : null}

      {showPrimary || showAlternatives ? (
        <div className="rounded-card border border-dashed border-edge-strong bg-surface px-3.5 py-3">
          {/* Two kinds of action, and they must not travel together. Apply runs
              what the assistant is proposing to do. Setting a constraint aside
              is an alternative to that, offered one at a time: a reply that
              kept two constraints and asked about both used to hand Apply the
              power to remove both, so pressing the affirmative button silently
              did the thing the question was asking permission for. */}
          {showPrimary ? (
            <>
              <p className="text-sm font-semibold text-fg-soft">Apply this to the page?</p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {primary.map((p, i) => (
                  <li key={i} className="text-base leading-snug">
                    {p.summary}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    primary.forEach((p: ProposedAction) => a.accept(p));
                    setPrimaryDone(true);
                    if (alternatives.length === 0) a.dismiss(index);
                  }}
                  className="tap inline-flex items-center rounded-pill bg-control px-5 text-sm font-semibold text-control-fg hover:bg-control-hover"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => a.dismiss(index)}
                  className="tap inline-flex items-center rounded-pill border border-edge-strong bg-surface-raised px-5 text-sm font-semibold hover:border-fg"
                >
                  No thanks
                </button>
              </div>
            </>
          ) : null}

          {showAlternatives ? (
            <div className={showPrimary ? "mt-3 border-t border-edge pt-3" : ""}>
              <p className="text-sm font-semibold text-fg-soft">Or set one aside:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {alternatives.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => {
                      // The alternative applies the proposal it was offered
                      // beside, without this constraint and without any set
                      // aside before it. Its other requirements are kept: the
                      // choice was about one constraint, not about the answer.
                      const dropped = [...setAside, p.key];
                      a.setAside(
                        p.key,
                        proposed
                          ? { hard: proposed.hard.filter((c) => !dropped.includes(c.key)), soft: proposed.soft.filter((sp) => !dropped.includes(sp.key)) }
                          : undefined,
                      );
                      setSetAside(dropped);
                    }}
                    className="tap inline-flex items-center rounded-pill border border-edge-strong bg-surface-raised px-3.5 text-sm font-semibold hover:border-fg"
                  >
                    {p.summary}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <p className="mt-2 text-sm leading-snug text-fg-soft">Nothing changes on the page until you choose.</p>
        </div>
      ) : null}
    </div>
  );
}
