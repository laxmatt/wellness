"use client";

import { useSyncExternalStore } from "react";
import type { NeedDefinition, NeedState } from "@/domain/needs";

// What the shopper has told this site they need, per category, so a screen
// that is not the category page can still answer "does this one fit".
//
// The chips live in React state on the category page and die on navigation.
// The comparison is a different page and has no chips of its own, and its whole
// job is products the shopper is weighing against each other, some of which the
// current filters exclude. So the requirements are written here, alongside the
// compare selection, in the same anonymous localStorage, and read back there.
//
// Keyed by category, and read back by category. A cold plunge column is never
// measured against a red-light requirement because it never sees one.
//
// Each entry carries the classification the server computed over the whole
// category. Nothing in the browser evaluates a product against a condition:
// no domain code and no product data beyond ids reaches the bundle, which is
// the same rule the filters follow.
export type StoredNeeds = Record<string, NeedDefinition[]>;

const KEY = "wc.needs.v1";
const EMPTY: StoredNeeds = {};
const NONE: NeedDefinition[] = [];
let cache: StoredNeeds | null = null;
const listeners = new Set<() => void>();

function read(): StoredNeeds {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as StoredNeeds) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

/**
 * Replace one category's requirements.
 *
 * A no-op when nothing changed, because this runs from an effect on every
 * filter render and a write notifies every card on the page.
 */
export function setNeeds(categoryId: string, needs: NeedDefinition[]) {
  const current = read();
  if (JSON.stringify(current[categoryId] ?? NONE) === JSON.stringify(needs)) return;
  const next = { ...current, [categoryId]: needs };
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable. The in-memory cache still serves this page, which
    // is what the category page needs; the comparison will simply show none.
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The requirements held for one category.
 *
 * The server snapshot is empty, so the section is absent in the HTML and
 * appears when the browser takes over. It describes a choice the shopper made
 * in this browser; it was never part of the document.
 */
export function useNeeds(categoryId: string | undefined): NeedDefinition[] {
  const all = useSyncExternalStore(subscribe, read, () => EMPTY);
  if (!categoryId) return NONE;
  return all[categoryId] ?? NONE;
}

/** One product against one requirement. */
export function stateOf(need: NeedDefinition, productId: string): NeedState {
  if (need.matchIds.includes(productId)) return "match";
  if (need.unknownIds.includes(productId)) return "unknown";
  return "miss";
}
