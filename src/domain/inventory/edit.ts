/**
 * Changing a staged record, in the few places it makes sense to change one.
 *
 * A reviewer reads a draft and finds the supplier's description is not a
 * product name, or that a figure is wrong, or that the price has moved. Those
 * are the edits. The id, the slug, the brand, the category and the status are
 * not editable here: the first four are identity and the fifth has its own
 * commands, with its own rules.
 *
 * Two things hold through every edit.
 *
 * A typed figure is read exactly as a cell in a file is read, by the same code.
 * "1.5" is not a count, a negative is not a nutrition figure, a bare number in
 * a box labelled mg is milligrams because the box says so and not because this
 * site happens to store milligrams. Somebody typing a figure gets the same
 * scrutiny as somebody uploading one.
 *
 * And an edit never promotes a figure. A staged figure is demo data because the
 * file it came from is invented, and typing a different number into it does not
 * make it evidence: it stays demo data, answers no filter, and its note records
 * that a person changed it. A figure becomes a fact when somebody records where
 * it came from, which is a different job from this one.
 */

import { fieldByKey, type TargetField } from "@/domain/import/fields";
import { readCell, type CellContext, type CellValue } from "@/domain/import/values";
import type { AttributePrimitive, AttributeValue } from "@/domain/attributes";
import { Product } from "@/domain/product";
import type { Source } from "@/domain/provenance";

/** The figures a staged record holds, and the only ones this edits. */
export const EDITABLE_FIGURES = ["function", "sugar_g", "caffeine_mg", "servings_per_pack"] as const;

export type FigureEdit = {
  key: string;
  /** What the operator typed. Empty means "the source does not state this". */
  raw: string;
  /** For a count: the operator states that one packed item is one serving. */
  servingsBasis?: boolean;
};

export type RecordEdit = {
  name?: string;
  description?: string;
  offer?: { price: string; url: string; lastChecked: string };
  figures?: FigureEdit[];
};

export type EditError = { field: string; message: string };
export type EditResult = { ok: true; product: Product; changes: string[] } | { ok: false; errors: EditError[] };

/** Where an edited note starts. Kept so a second edit replaces the first sentence rather than stacking. */
const EDIT_MARKER = " Changed here by the operator";

function withEditNote(source: Source, editedOn: string, what: string): Source {
  const base = (source.note ?? "").split(EDIT_MARKER)[0].trimEnd();
  return { ...source, note: `${base}${EDIT_MARKER} on ${editedOn}: ${what} This is still not a fact about any real product.` };
}

function primitive(v: CellValue): AttributePrimitive | undefined {
  switch (v.kind) {
    case "number":
    case "integer":
      return v.value;
    case "list":
    case "text":
      return v.value;
    case "money":
      return undefined;
  }
}

const describe = (v: AttributePrimitive | undefined): string => (v === undefined ? "nothing" : JSON.stringify(v));

/** The unit a figure box states, which is the operator stating it. */
function contextFor(field: TargetField, edit: FigureEdit): CellContext {
  return {
    unit: field.unit ? { value: field.unit, from: "unit shown beside the box you typed in" } : undefined,
    servingsBasis: edit.servingsBasis === true,
  };
}

function readDate(text: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) return undefined;
  return text;
}

export function applyEdit(product: Product, edit: RecordEdit, opts: { editedOn: string }): EditResult {
  const errors: EditError[] = [];
  const changes: string[] = [];
  const next: Product = { ...product, attributes: { ...product.attributes }, offers: [...product.offers] };

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
    if (description === "") errors.push({ field: "description", message: "A record needs a description. Say what is known about it, including that little is." });
    else if (description.length > 2000) errors.push({ field: "description", message: `A description is at most 2,000 characters. This is ${description.length}.` });
    else if (description !== product.description) {
      next.description = description;
      changes.push("description");
    }
  }

  if (edit.offer) {
    const offer = product.offers[0];
    if (!offer) {
      errors.push({ field: "offer", message: "This record holds no offer to edit." });
    } else {
      const priceField = fieldByKey("price")!;
      const read = readCell(edit.offer.price, priceField, { currency: { value: "USD", from: "currency shown beside the box you typed in" } });
      const blockers = read.flags.filter((f) => f.severity === "blocker");
      if (blockers.length > 0 || read.value?.kind !== "money") {
        for (const b of blockers) errors.push({ field: "offer.price", message: b.message });
        if (blockers.length === 0) errors.push({ field: "offer.price", message: "That is not an amount of money." });
      }
      const url = edit.offer.url.trim();
      if (!/^https?:\/\//i.test(url)) errors.push({ field: "offer.url", message: "A store link has to be an http or https address." });
      const date = readDate(edit.offer.lastChecked.trim());
      if (!date) errors.push({ field: "offer.lastChecked", message: "The date these prices were current has to be a date on the calendar, written YYYY-MM-DD." });

      if (read.value?.kind === "money" && url && date) {
        const changed = read.value.minor !== offer.priceMinor || url !== offer.url || date !== offer.lastChecked;
        if (changed) {
          next.offers = [
            {
              ...offer,
              priceMinor: read.value.minor,
              url,
              lastChecked: date,
              source: withEditNote(offer.source, opts.editedOn, `the price was set to ${(read.value.minor / 100).toFixed(2)} USD, stated current on ${date}.`),
            },
            ...product.offers.slice(1),
          ];
          changes.push(`offer: ${(offer.priceMinor / 100).toFixed(2)} to ${(read.value.minor / 100).toFixed(2)} USD`);
        }
      }
    }
  }

  for (const figure of edit.figures ?? []) {
    if (!(EDITABLE_FIGURES as readonly string[]).includes(figure.key)) {
      errors.push({ field: figure.key, message: `"${figure.key}" is not a figure this edits.` });
      continue;
    }
    const field = fieldByKey(figure.key);
    const current = product.attributes[figure.key];
    if (!field || !current) {
      errors.push({ field: figure.key, message: `This record holds no ${figure.key} to edit.` });
      continue;
    }

    // An empty box is "the source does not state this". It is not a zero, and
    // it is the one way to take a figure back out.
    if (figure.raw.trim() === "") {
      if (current.value === undefined) continue;
      next.attributes[figure.key] = {
        source: withEditNote(current.source, opts.editedOn, `the figure ${describe(current.value)} was cleared, so nothing is stated here.`),
        verification: "not_stated",
      };
      changes.push(`${figure.key}: ${describe(current.value)} to nothing stated`);
      continue;
    }

    const read = readCell(figure.raw, field, contextFor(field, figure));
    const blockers = read.flags.filter((f) => f.severity === "blocker");
    if (blockers.length > 0) {
      for (const b of blockers) errors.push({ field: figure.key, message: b.message });
      continue;
    }
    const value = read.value ? primitive(read.value) : undefined;
    if (value === undefined) {
      errors.push({ field: figure.key, message: `"${figure.raw}" could not be read as a ${field.label.toLowerCase()}.` });
      continue;
    }
    if (JSON.stringify(value) === JSON.stringify(current.value)) continue;

    // Still demo data. A different number typed into an invented figure is an
    // invented figure, and this is the line that keeps it out of the filters.
    const edited: AttributeValue = {
      value,
      unit: read.value?.kind === "number" ? read.value.unit : undefined,
      source: withEditNote(current.source, opts.editedOn, `the figure was changed from ${describe(current.value)} to ${describe(value)}.`),
      verification: "demo",
    };
    next.attributes[figure.key] = edited;
    changes.push(`${figure.key}: ${describe(current.value)} to ${describe(value)}`);
  }

  if (errors.length > 0) return { ok: false, errors };

  const parsed = Product.safeParse(next);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => ({ field: i.path.join(".") || "record", message: i.message })) };
  }
  return { ok: true, product: parsed.data, changes };
}
