/**
 * Turning a partner's text into a value this catalogue can hold, or saying why
 * it cannot.
 *
 * The rules are the ones this project already applies to a supplier file, and
 * they are applied here for the same reason: a value that nearly parsed is the
 * one that does the damage, because it reaches a filter and a comparison table
 * looking exactly like a value somebody checked.
 *
 * An empty cell is unknown. It is not zero, not false and not an empty list.
 * A number with the wrong unit is not converted, it is refused. A word outside
 * an enum's options is refused rather than matched to the nearest one: deciding
 * that a partner's "Infrared" means our `far_infrared` is a translation a
 * person makes once, in the profile's value map, where it can be read back.
 */

import { validateAttributeAgainstDefinition, type AttributeDefinition, type AttributePrimitive } from "@/domain/attributes";
import { fieldByKey } from "@/domain/import/fields";
import { readCell } from "@/domain/import/values";
import { Availability } from "@/domain/product";
import { mappedValue, type ValueMap } from "./profile";

export type Normalised =
  | { ok: true; value: AttributePrimitive; note?: string }
  | { ok: false; reason: string }
  /** The cell is empty. Unknown, which is not a refusal and not a value. */
  | { ok: "empty" };

/** Digits, optionally a decimal point, optionally a sign. No exponents, no hex, no `Infinity`. */
function strictNumber(text: string): number | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A unit the cell states, removed only when it is the unit the attribute is
 * stored in.
 *
 * A cell reading "7.5 kW" in a field stored in kW states the same thing twice.
 * A cell reading "7500 W" states something else, and converting it here would
 * be this tool deciding what the partner meant.
 */
function stripUnit(text: string, unit: string | undefined): { text: string; stated?: string } {
  const m = /^(-?[\d.,]+)\s*([A-Za-z"'%°]+)$/.exec(text);
  if (!m) return { text };
  if (unit && m[2].toLowerCase() === unit.toLowerCase()) return { text: m[1] };
  return { text, stated: m[2] };
}

/**
 * One raw string, one attribute definition, one answer.
 *
 * `valueMap` is the administrator's own translation table and runs first: it is
 * the only thing in this flow that may turn one word into another, and every
 * pair in it was typed by a person and is shown back to them.
 */
export function normaliseAttribute(raw: string, def: AttributeDefinition, valueMap?: ValueMap): Normalised {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: "empty" };

  const mapped = mappedValue(trimmed, valueMap);
  const text = mapped ?? trimmed;
  const note = mapped !== undefined ? `Translated from "${trimmed}" by this profile's value map.` : undefined;

  switch (def.type) {
    case "number":
    case "integer": {
      const { text: bare, stated } = stripUnit(text, def.unit);
      if (stated) {
        return { ok: false, reason: `"${text}" states ${stated} and this site stores ${def.unit ?? "a bare number"} for ${def.key}. Converting it here would decide what the partner meant, so it is refused.` };
      }
      const n = strictNumber(bare.replace(/,/g, ""));
      if (n === undefined) return { ok: false, reason: `"${text}" is not a plain decimal number.` };
      if (def.type === "integer" && !Number.isInteger(n)) return { ok: false, reason: `${def.key} holds whole numbers and "${text}" is not one.` };
      const bad = validateAttributeAgainstDefinition(def, n);
      return bad ? { ok: false, reason: bad } : { ok: true, value: n, note };
    }
    case "boolean": {
      const t = text.toLowerCase();
      if (["true", "yes", "y", "1"].includes(t)) return { ok: true, value: true, note };
      if (["false", "no", "n", "0"].includes(t)) return { ok: true, value: false, note };
      return { ok: false, reason: `"${text}" is not a yes or a no. Map it in this profile's value map if the partner writes it another way.` };
    }
    case "enum": {
      const options = def.enumOptions ?? [];
      if (options.some((o) => o.value === text)) return { ok: true, value: text, note };
      return {
        ok: false,
        reason: `"${text}" is not one of ${options.map((o) => o.value).join(", ")}. Deciding which of ours the partner's word means is a translation: put the pair in this profile's value map and it will be shown as one.`,
      };
    }
    case "string":
      return { ok: true, value: text, note };
    case "list":
    case "number_list":
      return { ok: false, reason: `${def.key} holds a list, and this flow fills lists from nothing yet. One cell to one list needs a stated separator and a stated vocabulary, and no partner file here has either.` };
  }
}

export type ReadPrice = { ok: true; minor: number; currency: string; notes: string[] } | { ok: false; reason: string } | { ok: "empty" };

/**
 * A price, read by the money rules this project already has.
 *
 * Those rules refuse a symbol as a currency, refuse an amount whose grouping is
 * ambiguous, and refuse a currency this catalogue cannot store in minor units.
 * They are not restated here: the same `readCell` reads a price typed into the
 * inventory tool and a price arriving in a partner feed.
 */
export function readPrice(raw: string, columnCurrency?: string): ReadPrice {
  if (raw.trim() === "") return { ok: "empty" };
  const read = readCell(raw, fieldByKey("price")!, columnCurrency ? { currency: { value: columnCurrency, from: "currency set on this column in the mapping profile" } } : {});
  const blockers = read.flags.filter((f) => f.severity === "blocker");
  if (!read.value || read.value.kind !== "money") {
    return { ok: false, reason: blockers.map((f) => f.message).join(" ") || `"${raw}" is not a price this reads.` };
  }
  return { ok: true, minor: read.value.minor, currency: read.value.currency, notes: read.flags.map((f) => f.message) };
}

export type ReadAvailability = { ok: true; value: Availability; note?: string } | { ok: false; reason: string } | { ok: "empty" };

/**
 * The partner's own stock word, normalised or refused.
 *
 * Never inferred from anything else on the row. A description stating a lead
 * time and a field saying out of stock are two statements, and this resolves
 * neither against the other: the field is the field, the description is kept
 * whole, and a reader sees both.
 */
export function readAvailability(raw: string, valueMap?: ValueMap): ReadAvailability {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: "empty" };
  const mapped = mappedValue(trimmed, valueMap);
  const text = mapped ?? trimmed;
  const parsed = Availability.safeParse(text);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `"${trimmed}" is not a stock value this site holds. It holds ${Availability.options.join(", ")}. Map the partner's word in this profile's value map, or leave it unmapped and the record says unknown.`,
    };
  }
  return { ok: true, value: parsed.data, note: mapped !== undefined ? `Translated from "${trimmed}" by this profile's value map.` : undefined };
}

/** Lowercase, hyphen-separated, or nothing where the text carries no letters or digits. */
export function slugPart(text: string): string | undefined {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s === "" ? undefined : s.slice(0, 60).replace(/-+$/, "");
}
