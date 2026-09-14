/**
 * A person changing a draft, and the record saying that a person did.
 *
 * Small on purpose: a name and a description. Those are the two fields an
 * editor fixes first and the two a partner is most likely to overwrite, so they
 * are the ones the ownership rules have to be demonstrated on.
 *
 * The edit is marked on the record. A field an editor changed reads differently
 * from a field a feed wrote, and the next import has to be able to see the
 * difference: that is what the snapshot is for, and the note is for the person
 * reading the record afterwards.
 */

import type { Product } from "@/domain/product";

export type EditorialEdit = { name?: string; description?: string };
export type EditError = { field: string; message: string };
export type EditOutcome = { ok: true; product: Product; changes: string[] } | { ok: false; errors: EditError[] };

const MARKER = " Edited here by";

function withNote(note: string | undefined, by: string, on: string, what: string): string {
  const base = (note ?? "").split(MARKER)[0].trimEnd();
  return `${base}${MARKER} ${by} on ${on}: ${what}`;
}

export function applyEditorialEdit(product: Product, edit: EditorialEdit, opts: { by: string; on: string }): EditOutcome {
  const errors: EditError[] = [];
  const changes: string[] = [];
  const next: Product = { ...product };

  if (edit.name !== undefined) {
    const name = edit.name.replace(/\s+/g, " ").trim();
    if (name === "") errors.push({ field: "name", message: "A record needs a name." });
    else if (name.length > 200) errors.push({ field: "name", message: `A name is at most 200 characters. This is ${name.length}.` });
    else if (name !== product.name) {
      next.name = name;
      changes.push(`name: "${product.name}" to "${name}"`);
    }
  }

  if (edit.description !== undefined) {
    const description = edit.description.trim();
    if (description === "") errors.push({ field: "description", message: "A record needs a description. Say what is known, including that little is." });
    else if (description.length > 4000) errors.push({ field: "description", message: `A description is at most 4,000 characters. This is ${description.length}.` });
    else if (description !== product.description) {
      next.description = description;
      changes.push("description");
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (changes.length === 0) return { ok: true, product, changes };

  next.source = { ...product.source, note: withNote(product.source.note, opts.by, opts.on, `${changes.join("; ")}.`) };
  next.lastUpdated = opts.on;
  return { ok: true, product: next, changes };
}
