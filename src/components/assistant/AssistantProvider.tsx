"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useCompare } from "@/components/compare/CompareProvider";
import type { AssistantMessage, AssistantReply, ProposedAction } from "@/domain/assistant";
import type { HardConstraint, SoftPreference } from "@/domain/personalization";

export type CompareSeed = { id: string; slug: string; name: string; categoryId: string };

export type AppliedPreferences = { hard: HardConstraint[]; soft: SoftPreference[]; matchingIds: string[] | null; labels: string[]; nonce: number };

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
      answering?: { key: string },
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

  const send = useCallback((text: string) => post(text, { hard, soft }), [hard, post, soft]);

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
      const pending = replies[replyIndex]?.proposals.find((p) => p.kind === "apply_preferences");
      const carry =
        pending && pending.kind === "apply_preferences" && (pending.hard.length > 0 || pending.soft.length > 0)
          ? { hard: pending.hard, soft: pending.soft }
          : { hard, soft };
      return post(option, carry, question.key ? { key: question.key } : undefined);
    },
    [hard, post, replies, soft],
  );

  // Nothing here changes the page until the shopper presses Apply.
  const publish = useCallback((h: HardConstraint[], s: SoftPreference[], matchingIds: string[] | null, labels: string[]) => {
    nonce.current += 1;
    setApplied({ hard: h, soft: s, matchingIds, labels, nonce: nonce.current });
  }, []);

  const accept = useCallback(
    (action: ProposedAction) => {
      if (action.kind === "apply_preferences") {
        setHard(action.hard);
        setSoft(action.soft);
        // The engine's answer for these exact constraints, not a chip
        // approximation and not the previous turn's answer.
        publish(action.hard, action.soft, action.matchingIds, [action.summary]);
      } else if (action.kind === "add_to_compare") {
        for (const id of action.productIds) {
          const seed = compareSeeds.find((x) => x.id === id);
          if (seed && !compare.has(seed.id)) compare.toggle(seed);
        }
      } else if (action.kind === "relax_constraint") {
        setHard((prev) => {
          const nextHard = prev.filter((c) => c.key !== action.key);
          // Relaxing widens the set, so the page returns to unfiltered until
          // the next reply reports what now qualifies.
          publish(nextHard, soft, null, []);
          return nextHard;
        });
      }
    },
    [compare, compareSeeds, publish, soft],
  );

  const removeConstraint = useCallback(
    (key: string) => {
      setHard((prev) => {
        const nextHard = prev.filter((c) => c.key !== key);
        publish(nextHard, soft, null, []);
        return nextHard;
      });
    },
    [publish, soft],
  );

  const reset = useCallback(() => {
    setMessages([]);
    setReplies({});
    setHard([]);
    setSoft([]);
    setDismissed([]);
    setError(null);
    publish([], [], null, []);
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
      dismiss: (i) => setDismissed((prev) => [...prev, i]),
      dismissed,
      removeConstraint,
      reset,
      categoryId,
    }),
    [accept, answerQuestion, applied, categoryId, dismissed, error, hard, latest, messages, open, removeConstraint, replies, reset, send, sending, soft],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantState | null {
  return useContext(Ctx);
}
