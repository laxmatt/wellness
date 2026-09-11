"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useCompare } from "@/components/compare/CompareProvider";
import type { AssistantMessage, AssistantReply, ProposedAction } from "@/domain/assistant";
import { mentionsValue } from "@/domain/named-values";
import type { HardConstraint, SoftPreference } from "@/domain/personalization";

export type CompareSeed = { id: string; slug: string; name: string; categoryId: string };

export type AppliedBreakdown = { key: string; label: string; matchIds: string[]; unknownIds: string[] };

export type AppliedPreferences = {
  hard: HardConstraint[];
  soft: SoftPreference[];
  matchingIds: string[] | null;
  labels: string[];
  // Per constraint key, what it admits and what it cannot settle. Carried so a
  // screen can say where a product conflicts with an accepted constraint and
  // where the catalogue simply cannot answer, which `matchingIds` alone cannot
  // distinguish.
  breakdown: AppliedBreakdown[];
  // Accepted soft preferences, in words. Kept apart from `breakdown` on
  // purpose: a preference orders the list and decides nothing.
  softLabels: string[];
  nonce: number;
};

export type AssistantState = {
  available: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  messages: AssistantMessage[];
  replies: Record<number, AssistantReply>;
  sending: boolean;
  error: string | null;
  hard: HardConstraint[];
  soft: SoftPreference[];
  latest: AssistantReply | null;
  // Set only when the shopper accepts a proposal. Filters watch this.
  applied: AppliedPreferences | null;
  send: (text: string) => Promise<void>;
  // Answering a question the site asked. Distinct from `send` because it
  // carries the constraints the shopper has not applied yet, and tells the
  // route the message answers a question rather than replacing an answer.
  answerQuestion: (option: string, question: { key?: string }, replyIndex: number) => Promise<void>;
  accept: (action: ProposedAction) => void;
  // Setting one constraint aside. `from` is the proposal the alternative was
  // offered beside, already reduced: the choice applies that proposal without
  // the constraint, so the other requirements it carried are kept rather than
  // being left behind unapplied. Without it, the applied state is filtered
  // instead, which is what an alternative offered on its own can do.
  setAside: (key: string, from?: { hard: HardConstraint[]; soft: SoftPreference[]; matchesByKey: AppliedBreakdown[] }) => void;
  dismiss: (index: number) => void;
  dismissed: number[];
  removeConstraint: (key: string) => void;
  reset: () => void;
  categoryId: string;
};

const Ctx = createContext<AssistantState | null>(null);

function newSessionId(): string {
  const key = "wc.assistant.session";
  try {
    const existing = window.sessionStorage.getItem(key);
    if (existing) return existing;
    const id = `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    window.sessionStorage.setItem(key, id);
    return id;
  } catch {
    return `s_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

// Conversation state lives for the session only. Nothing typed here is
// persisted, sent to analytics, or used to build a profile: chat messages can
// carry health details and are treated as transient.
export function AssistantProvider({ categoryId, compareSeeds = [], children }: { categoryId: string; compareSeeds?: CompareSeed[]; children: ReactNode }) {
  const compare = useCompare();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [replies, setReplies] = useState<Record<number, AssistantReply>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hard, setHard] = useState<HardConstraint[]>([]);
  const [soft, setSoft] = useState<SoftPreference[]>([]);
  const [applied, setApplied] = useState<AppliedPreferences | null>(null);
  const [dismissed, setDismissed] = useState<number[]>([]);
  // Keys the shopper has explicitly taken off. A pending proposal is a snapshot
  // of what the assistant offered at the time, and removing a constraint after
  // it arrived does not rewrite that snapshot: answering the question would
  // otherwise carry the removed constraint back in and undo a deliberate act.
  // A removal stands until the shopper accepts a proposal that names the key
  // again, which is them asking for it back.
  const [removed, setRemoved] = useState<string[]>([]);
  // What each hard constraint of the applied proposal admits on its own. Kept
  // so a removal can be answered exactly: hard constraints are ANDed, so what
  // remains after any number of removals is the intersection of the sets for
  // the constraints still standing. A set precomputed for removing one would
  // be wrong the moment a second was removed.
  const [matchesByKey, setMatchesByKey] = useState<AppliedBreakdown[]>([]);
  // Accepted soft preferences, in the site's words. A ref, not state: nothing
  // renders from it directly, and `setAside` is memoised on state it must not
  // be re-created for. It reaches the screen through `applied`.
  const softWords = useRef<string[]>([]);
  const sessionId = useRef<string | null>(null);
  const nonce = useRef(0);

  const latest = useMemo(() => {
    const keys = Object.keys(replies).map(Number);
    return keys.length === 0 ? null : replies[Math.max(...keys)];
  }, [replies]);

  const post = useCallback(
    async (
      text: string,
      carry: { hard: HardConstraint[]; soft: SoftPreference[] },
      answering?: { key: string; via: "option" | "typed" },
    ) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      sessionId.current ??= newSessionId();
      const next = [...messages, { role: "user" as const, text: trimmed }];
      setMessages(next);
      setSending(true);
      setError(null);
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId.current, categoryId, messages: next, hard: carry.hard, soft: carry.soft, answering }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const reply = (await res.json()) as AssistantReply;
        setMessages((prev) => {
          const withReply = [...prev, { role: "assistant" as const, text: reply.text }];
          setReplies((r) => ({ ...r, [withReply.length - 1]: reply }));
          return withReply;
        });
      } catch {
        setError("The assistant did not respond. Filters and comparison are unaffected.");
      } finally {
        setSending(false);
      }
    },
    [categoryId, messages, sending],
  );

  /**
   * An ordinary typed message, unless a question is open and the text answers
   * it.
   *
   * A shopper who is asked "Which function suits you?" and types "electrolytes"
   * has answered, and deserves the same treatment as pressing the chip: the
   * constraints that question was about go with the message, and the reply is
   * merged into them. A shopper who types "forget the budget" has not answered,
   * and replacement is what drops the constraint.
   *
   * Three cases, not two. Text that is exactly one of the options is the same
   * act as pressing it, and merges. Text that names an option among other words
   * might be answering and revoking at once, so it is marked `typed` and the
   * route asks rather than assuming. Text that names no option is an ordinary
   * message and replaces.
   */
  /**
   * What an answer carries: the constraints of the reply that asked, minus
   * anything the shopper has since taken off, and the applied state when that
   * reply proposed nothing.
   */
  const carryFor = useCallback(
    (asking: AssistantReply | undefined) => {
      const pending = asking?.proposals.find((p) => p.kind === "apply_preferences");
      if (pending && pending.kind === "apply_preferences" && (pending.hard.length > 0 || pending.soft.length > 0)) {
        const keep = { hard: pending.hard.filter((c) => !removed.includes(c.key)), soft: pending.soft.filter((p) => !removed.includes(p.key)) };
        if (keep.hard.length > 0 || keep.soft.length > 0) return keep;
      }
      return { hard, soft };
    },
    [hard, removed, soft],
  );

  const send = useCallback(
    (text: string) => {
      const question = latest?.question;
      const answered =
        question?.key !== undefined && question.options.some((o) => mentionsValue(text, o));
      if (!answered || question?.key === undefined) return post(text, { hard, soft });

      const asking = Object.keys(replies)
        .map(Number)
        .sort((a, b) => b - a)
        .map((i) => replies[i])
        .find((r) => r.question?.key === question.key);
      const carry = carryFor(asking);
      // "electrolytes" leaves no room for a second meaning; "electrolytes, and
      // forget the budget" does.
      const bare = text.trim().replace(/[.,!?;:]+$/, "").toLowerCase();
      const exact = question.options.some((o) => o.trim().toLowerCase() === bare);
      return post(text, carry, { key: question.key, via: exact ? "option" : "typed" });
    },
    [carryFor, hard, latest, post, replies, soft],
  );

  /**
   * Answering a clarifying question the site asked.
   *
   * Two things differ from an ordinary message. The constraints of the reply
   * that asked are sent even though the shopper has not pressed Apply: they are
   * what the question is about, and losing them for want of a button press is
   * how "zero sugar, electrolytes, under $2" became "electrolytes". And the
   * route is told this answers a question, so the reply is merged into them
   * rather than replacing them, which is what stops a model that answers only
   * the question from taking the rest with it.
   */
  const answerQuestion = useCallback(
    (option: string, question: { key?: string }, replyIndex: number) => {
      const carry = carryFor(replies[replyIndex]);
      return post(option, carry, question.key ? { key: question.key, via: "option" } : undefined);
    },
    [carryFor, post, replies],
  );

  // Nothing here changes the page until the shopper presses Apply.
  const publish = useCallback(
    (h: HardConstraint[], s: SoftPreference[], matchingIds: string[] | null, labels: string[], breakdown: AppliedBreakdown[], softWords: string[]) => {
      nonce.current += 1;
      // Only the keys still standing. A constraint the shopper set aside must
      // not go on describing a product's fit.
      const held = new Set(h.map((c) => c.key));
      setApplied({ hard: h, soft: s, matchingIds, labels, breakdown: breakdown.filter((b) => held.has(b.key)), softLabels: softWords, nonce: nonce.current });
    },
    [],
  );

  /**
   * What the engine admits for a set of hard constraints, from the breakdown
   * the route sent with the proposal.
   *
   * Null when any remaining constraint has no set: the count is then unknown,
   * and the page falls back rather than showing a number nobody computed. An
   * empty constraint list admits everything, which is the correct answer when
   * the last one is set aside.
   */
  const admittedBy = useCallback(
    (keys: string[], breakdown: AppliedBreakdown[]): string[] | null => {
      if (keys.length === 0) return null;
      // By key, once each: the breakdown holds one entry per key covering every
      // constraint on it, so a key named twice is the same set twice.
      const sets = [...new Set(keys)].map((k) => breakdown.find((m) => m.key === k));
      if (sets.some((m) => m === undefined)) return null;
      return sets.reduce<string[]>((acc, m, i) => (i === 0 ? [...m!.matchIds] : acc.filter((id) => m!.matchIds.includes(id))), []);
    },
    [],
  );

  const setAside = useCallback(
    (key: string, from?: { hard: HardConstraint[]; soft: SoftPreference[]; matchesByKey: AppliedBreakdown[] }) => {
      setRemoved((prev) => (prev.includes(key) ? prev : [...prev, key]));
      // The breakdown of the proposal being acted on, not of whatever was
      // applied last: an alternative offered beside a proposal can name a
      // constraint the applied set never had, and the applied set's breakdown
      // says nothing about it.
      const breakdown = from?.matchesByKey ?? matchesByKey;
      if (from) setMatchesByKey(from.matchesByKey);
      const settle = (nextHard: HardConstraint[], nextSoft: SoftPreference[]) => {
        // Answered from the constraints that actually remain, however many
        // removals it took to get here. The page used to go back to unfiltered
        // on the first one, showing every product while the panel held two
        // constraints.
        const keys = [...new Set(nextHard.map((c) => c.key))];
        const ids = admittedBy(keys, breakdown);
        // Named by the site, from the labels it sent with the proposal. One
        // label per key, so two bounds on one key read as one entry.
        const labels = keys.map((k) => breakdown.find((m) => m.key === k)?.label).filter((l): l is string => l !== undefined);
        publish(nextHard, nextSoft, ids, labels, breakdown, softWords.current);
      };
      if (from) {
        const nextHard = from.hard.filter((c) => c.key !== key);
        const nextSoft = from.soft.filter((p) => p.key !== key);
        setHard(nextHard);
        setSoft(nextSoft);
        settle(nextHard, nextSoft);
        return;
      }
      setHard((prev) => {
        const nextHard = prev.filter((c) => c.key !== key);
        settle(nextHard, soft);
        return nextHard;
      });
    },
    [admittedBy, matchesByKey, publish, soft],
  );

  const accept = useCallback(
    (action: ProposedAction) => {
      if (action.kind === "apply_preferences") {
        setHard(action.hard);
        setSoft(action.soft);
        // Accepting a proposal that names a key is asking for it back.
        const named = new Set([...action.hard.map((c) => c.key), ...action.soft.map((p) => p.key)]);
        setRemoved((prev) => prev.filter((k) => !named.has(k)));
        setMatchesByKey(action.matchesByKey);
        softWords.current = action.softLabels;
        // The engine's answer for these exact constraints, not a chip
        // approximation and not the previous turn's answer.
        publish(action.hard, action.soft, action.matchingIds, [action.summary], action.matchesByKey, action.softLabels);
      } else if (action.kind === "add_to_compare") {
        for (const id of action.productIds) {
          const seed = compareSeeds.find((x) => x.id === id);
          if (seed && !compare.has(seed.id)) compare.toggle(seed);
        }
      } else if (action.kind === "relax_constraint") {
        setAside(action.key);
      }
    },
    [compare, compareSeeds, publish, setAside],
  );

  // The constraint chip's own control. Same act as setting one aside, by a
  // different button, and it published the same null.
  const removeConstraint = useCallback((key: string) => setAside(key), [setAside]);

  const reset = useCallback(() => {
    setMessages([]);
    setReplies({});
    setHard([]);
    setSoft([]);
    setDismissed([]);
    setRemoved([]);
    setMatchesByKey([]);
    softWords.current = [];
    setError(null);
    publish([], [], null, [], [], []);
  }, [publish]);

  const value = useMemo<AssistantState>(
    () => ({
      available: true,
      open,
      setOpen,
      messages,
      replies,
      sending,
      error,
      hard,
      soft,
      latest,
      applied,
      send,
      answerQuestion,
      accept,
      setAside,
      dismiss: (i) => setDismissed((prev) => [...prev, i]),
      dismissed,
      removeConstraint,
      reset,
      categoryId,
    }),
    [accept, answerQuestion, applied, categoryId, dismissed, error, hard, latest, messages, open, removeConstraint, replies, reset, send, sending, setAside, soft],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantState | null {
  return useContext(Ctx);
}
