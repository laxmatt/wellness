/**
 * What a second run of the same intake should do, which is almost always
 * nothing.
 *
 * An intake file is read more than once: to check it, after an edit to it,
 * after a reviewer has changed a draft by hand. The danger is the third one. A
 * reviewer who corrects a name, writes a description, records an image right or
 * approves a draft has put work into a file that an import would otherwise
 * overwrite with the reading it came from, silently and completely.
 *
 * So an import creates and it reports. It never replaces a record that is
 * already there, whatever it thinks that record should say. Where the file and
 * the catalogue disagree, the disagreement is the output, and applying it is a
 * separate instruction naming the record.
 */

import type { Product } from "@/domain/product";

export type PlanAction = "create" | "unchanged" | "differs";

export type PlannedRecord = {
  id: string;
  action: PlanAction;
  /** Top-level fields where the catalogue and the reading disagree. */
  differences: string[];
  /** Set when the record on disk is no longer a draft: a person has moved it on. */
  reviewed: boolean;
};

export type IntakePlan = {
  records: PlannedRecord[];
  creates: string[];
  differs: string[];
  unchanged: string[];
};

const stable = (v: unknown): string => JSON.stringify(v);

/** Field-by-field, so a report names what moved rather than saying "changed". */
export function differencesBetween(existing: Product, incoming: Product): string[] {
  const keys = new Set([...Object.keys(existing), ...Object.keys(incoming)] as (keyof Product)[]);
  const out: string[] = [];
  for (const key of keys) {
    if (stable(existing[key]) !== stable(incoming[key])) out.push(String(key));
  }
  return out.sort();
}

export function planIntake(existing: Product[], incoming: Product[]): IntakePlan {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const records: PlannedRecord[] = incoming.map((p) => {
    const current = byId.get(p.id);
    if (!current) return { id: p.id, action: "create", differences: [], reviewed: false };
    const differences = differencesBetween(current, p);
    return {
      id: p.id,
      action: differences.length === 0 ? "unchanged" : "differs",
      differences,
      // A record that has left draft has been through somebody's hands. Saying
      // so in the plan is the difference between "this changed" and "this
      // changed and a person already acted on it".
      reviewed: current.status !== "draft",
    };
  });
  return {
    records,
    creates: records.filter((r) => r.action === "create").map((r) => r.id),
    differs: records.filter((r) => r.action === "differs").map((r) => r.id),
    unchanged: records.filter((r) => r.action === "unchanged").map((r) => r.id),
  };
}
