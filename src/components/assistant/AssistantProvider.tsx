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

  const send = useCallback(
    async (text: string) => {
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
          body: JSON.stringify({ sessionId: sessionId.current, categoryId, messages: next, hard, soft }),
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
    [categoryId, hard, messages, sending, soft],
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
      accept,
      dismiss: (i) => setDismissed((prev) => [...prev, i]),
      dismissed,
      removeConstraint,
      reset,
      categoryId,
    }),
    [accept, applied, categoryId, dismissed, error, hard, latest, messages, open, removeConstraint, replies, reset, send, sending, soft],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantState | null {
  return useContext(Ctx);
}
