/**
 * What a second upload of the same feed may change, and what it may not.
 *
 * This is the part that decides whether an editor's work survives the next
 * refresh. The failure it exists to prevent is silent: a partner re-titles a
 * product overnight, the import takes the new title, and the name somebody
 * wrote by hand is gone with nothing to say it was ever there.
 *
 * So every field has an owner and every decision is made against three values,
 * not two: what the file says now, what the record says now, and what the last
 * import wrote. Two values cannot tell a partner's change from an editor's. A
 * price that differs from the file could be a price the partner moved or a
 * price somebody corrected here, and the snapshot of the last import is the
 * only thing that separates them.
 *
 * The rules, for a field the file and the record disagree on:
 *
 * - **editorial**: the record wins, always, and no file ever changes it.
 * - **review_on_change**: the record wins. If the file has moved since the last
 *   import, that is queued for a person; if it has not, the difference is an
 *   edit made here and it stands.
 * - **feed**: the file wins, but only when the record still says what the last
 *   import wrote. If both have moved since, nothing is written and the field is
 *   queued as a conflict. A conflict is a question for a person, not a race for
 *   whichever side wrote last.
 *
 * Nothing here deletes. A record the file has stopped carrying is reported as a
 * removal and left where it is: a partner dropping a line from a feed for a
 * week is not this site deciding the product no longer exists.
 */

import type { FieldMeta } from "./build";
import type { Derivation } from "@/domain/provenance";
import type { RecordFields } from "./record";

export type FieldOutcome = {
  key: string;
  label: string;
  ownership: FieldMeta["ownership"];
  outcome: "written" | "unchanged" | "held_editorial" | "held_local" | "conflict" | "review" | "withdrawn";
  /** What the file says now. Absent when the file has stopped carrying this field. */
  incoming?: unknown;
  /** What the record says now. Absent when the record has no such field. */
  current?: unknown;
  /** What the last import wrote. Absent when there is no record of one. */
  last?: unknown;
  why: string;
};

export type RecordAction = "added" | "changed" | "conflict" | "review" | "unchanged" | "failed";

export type MergeResult = {
  fields: RecordFields;
  notes: Record<string, string>;
  derivations: Record<string, Derivation>;
  outcomes: FieldOutcome[];
  action: RecordAction;
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type MergeInput = {
  incoming: RecordFields;
  incomingNotes: Record<string, string>;
  incomingDerivations: Record<string, Derivation>;
  meta: Record<string, FieldMeta>;
  /** The record as it stands, when there is one. */
  current?: { fields: RecordFields; notes: Record<string, string>; derivations: Record<string, Derivation> };
  /** The fields the last import of this source wrote for this record. */
  last?: RecordFields;
};

export function mergeRecord(input: MergeInput): MergeResult {
  const { incoming, incomingNotes, incomingDerivations, meta, current, last } = input;

  if (!current) {
    return {
      fields: { ...incoming },
      notes: { ...incomingNotes },
      derivations: { ...incomingDerivations },
      outcomes: Object.keys(incoming).map((key) => ({
        key,
        label: meta[key]?.label ?? key,
        ownership: meta[key]?.ownership ?? "feed",
        outcome: "written" as const,
        incoming: incoming[key],
        why: "A record this site does not hold yet. Everything the file says is written, and nothing is overwritten because there is nothing to overwrite.",
      })),
      action: "added",
    };
  }

  const fields: RecordFields = { ...current.fields };
  const notes: Record<string, string> = { ...current.notes };
  const derivations: Record<string, Derivation> = { ...current.derivations };
  const outcomes: FieldOutcome[] = [];
  const keys = [...new Set([...Object.keys(incoming), ...Object.keys(current.fields)])].sort();

  for (const key of keys) {
    const I = incoming[key];
    const C = current.fields[key];
    const L = last?.[key];
    const ownership = meta[key]?.ownership ?? "feed";
    const label = meta[key]?.label ?? key;
    const record = (outcome: FieldOutcome["outcome"], why: string): void => {
      outcomes.push({ key, label, ownership, outcome, incoming: I, current: C, last: L, why });
    };

    if (I === undefined) {
      // The file has stopped carrying this field. Never a reason to blank a
      // record: a partner dropping a column is a change to the feed, not a
      // statement that the product lost the property.
      record("withdrawn", "The file no longer carries this field. What the record holds is left alone: a column that stopped arriving says nothing about the product.");
      continue;
    }
    if (C === undefined) {
      fields[key] = I;
      if (incomingNotes[key]) notes[key] = incomingNotes[key];
      if (incomingDerivations[key]) derivations[key] = incomingDerivations[key];
      record("written", "The record holds nothing here, so the file's value is written.");
      continue;
    }
    if (same(I, C)) {
      record("unchanged", "The file and the record agree.");
      continue;
    }
    if (ownership === "editorial") {
      record("held_editorial", "This site owns this field. No file changes it.");
      continue;
    }
    if (ownership === "review_on_change") {
      if (last !== undefined && same(I, L)) {
        record("held_local", "The file says what it said at the last import, so this difference was made here and it stands.");
      } else {
        record("review", "The file proposes a different value. This field is applied by a person, so it is queued rather than written.");
      }
      continue;
    }
    // feed-owned
    if (last === undefined) {
      record(
        "review",
        "There is no record of what the last import wrote for this field, so a difference cannot be told apart from an edit made here. Queued rather than written: the safe direction is the one where nobody's work disappears.",
      );
      continue;
    }
    if (same(C, L)) {
      fields[key] = I;
      if (incomingNotes[key]) notes[key] = incomingNotes[key];
      else delete notes[key];
      if (incomingDerivations[key]) derivations[key] = incomingDerivations[key];
      else delete derivations[key];
      record("written", "The record still says what the last import wrote, so the file's newer value is written.");
      continue;
    }
    if (same(I, L)) {
      record("held_local", "The file has not moved since the last import, so this difference was made here and it stands.");
      continue;
    }
    record("conflict", "Both the file and this site have changed this field since the last import. Nothing is written, and a person decides which is right.");
  }

  const has = (o: FieldOutcome["outcome"]): boolean => outcomes.some((x) => x.outcome === o);
  const action: RecordAction = has("conflict") ? "conflict" : has("written") ? "changed" : has("review") ? "review" : "unchanged";
  return { fields, notes, derivations, outcomes, action };
}

/** Records the last import wrote that this upload no longer carries. Reported, never deleted. */
export function withdrawnRecords(lastIds: string[], incomingIds: string[]): string[] {
  const present = new Set(incomingIds);
  return lastIds.filter((id) => !present.has(id)).sort();
}

/**
 * What to remember about this record after an import, field by field.
 *
 * Not simply "what the file said". A field the import held back keeps the
 * value the last import wrote, so the disagreement stays visible: a conflict
 * that is recorded as resolved because the file stopped moving is a conflict
 * nobody decided. It goes on being reported until somebody changes one side or
 * the other.
 */
export function nextSnapshot(outcomes: FieldOutcome[], previous: RecordFields | undefined): RecordFields {
  const snapshot: RecordFields = {};
  for (const o of outcomes) {
    switch (o.outcome) {
      case "written":
      case "unchanged":
      case "held_editorial":
        if (o.incoming !== undefined) snapshot[o.key] = o.incoming;
        break;
      case "held_local":
      case "conflict":
      case "review":
      case "withdrawn": {
        const kept = previous?.[o.key];
        if (kept !== undefined) snapshot[o.key] = kept;
        break;
      }
    }
  }
  return snapshot;
}
