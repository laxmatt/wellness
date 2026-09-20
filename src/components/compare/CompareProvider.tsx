"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { MAX_COMPARE } from "@/lib/site";

export type CompareItem = { id: string; slug: string; name: string; categoryId: string };
export type CompareAuthority = { categoryId: string; publishedIds: string[] };

type CompareState = {
  items: CompareItem[];
  has: (id: string) => boolean;
  toggle: (item: CompareItem) => { ok: boolean; reason?: string };
  remove: (id: string) => void;
  clear: (categoryId?: string) => void;
  forCategory: (categoryId: string) => CompareItem[];
  ready: boolean;
  reconcile: (authority: CompareAuthority) => void;
};

// Anonymous compare selection. Lives in localStorage only. Never leaves the
// browser. Per category, capped at MAX_COMPARE. Implemented as an external
// store so hydration uses the empty server snapshot, then swaps to storage.
const KEY = "wc.compare.v1";
const EMPTY: CompareItem[] = [];
let cache: CompareItem[] | null = null;
const listeners = new Set<() => void>();

function read(): CompareItem[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as CompareItem[]) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: CompareItem[]) {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage unavailable; state still works for this page
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

const Ctx = createContext<CompareState | null>(null);

export function CompareProvider({ children }: { children: ReactNode }) {
  const items = useSyncExternalStore(subscribe, read, () => EMPTY);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);

  const has = useCallback((id: string) => items.some((i) => i.id === id), [items]);
  const forCategory = useCallback((categoryId: string) => items.filter((i) => i.categoryId === categoryId), [items]);

  const toggle = useCallback((item: CompareItem) => {
    const cur = read();
    if (cur.some((i) => i.id === item.id)) {
      write(cur.filter((i) => i.id !== item.id));
      return { ok: true };
    }
    if (cur.filter((i) => i.categoryId === item.categoryId).length >= MAX_COMPARE) {
      return { ok: false, reason: `You can compare up to ${MAX_COMPARE} at a time.` };
    }
    write([...cur, item]);
    return { ok: true };
  }, []);

  const remove = useCallback((id: string) => write(read().filter((i) => i.id !== id)), []);
  const clear = useCallback((categoryId?: string) => write(categoryId ? read().filter((i) => i.categoryId !== categoryId) : EMPTY), []);
  const reconcile = useCallback(({ categoryId, publishedIds }: CompareAuthority) => {
    const cur = read();
    const known = new Set(publishedIds);
    const next = cur.filter((item) => item.categoryId !== categoryId || known.has(item.id));
    if (next.length !== cur.length) write(next);
  }, []);

  const value = useMemo(() => ({ items, has, toggle, remove, clear, forCategory, ready, reconcile }), [items, has, toggle, remove, clear, forCategory, ready, reconcile]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Only a complete, successfully loaded category list is authoritative. An
// explicit empty list clears that category; absent authority changes nothing.
export function CompareReconciler({ authority }: { authority?: CompareAuthority }) {
  const { reconcile, ready } = useCompare();
  useEffect(() => {
    if (ready && authority) reconcile(authority);
  }, [ready, authority, reconcile]);
  return null;
}

export function useCompare(): CompareState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCompare outside CompareProvider");
  return ctx;
}
