/**
 * Which column means which field, written down and reusable.
 *
 * A mapping is a person's decision, saved. This suggests one from headings it
 * recognises, and every suggestion is a written synonym match rather than a
 * resemblance: "sugar_g" is in the list in fields.ts, "sweetness" is not, and
 * nothing here decides that they are probably the same thing. A column this
 * does not recognise is left unmapped and shown as unmapped.
 *
 * Mappings export and import as JSON so the same supplier's next file takes a
 * second, and so the decision is reviewable as text rather than remembered.
 */

import { DRINK_FIELDS, normaliseHeader, type TargetField } from "./fields";
import { SUPPORTED_CURRENCIES, SUPPORTED_UNITS } from "./values";

/** A mapping file is a small JSON object, not a payload. */
export const MAX_MAPPING_BYTES = 64_000;

export type ColumnMapping = {
  version: 1;
  /** What this mapping is for, in a person's words. */
  name: string;
  /** Target field key to the exact heading in the file. */
  columns: Record<string, string>;
  /**
   * The currency of the price column, when neither the cells nor the heading
   * state one. Stated by a person, because a price with an assumed currency is
   * a wrong price waiting to happen. It does not override a currency the file
   * states: where the two disagree, nothing is read.
   */
  currency?: string;
  /**
   * The unit of a measure column, per field, when neither the cells nor the
   * heading state one. Same rule: it fills a silence, it does not overrule a
   * statement.
   */
  units?: Record<string, string>;
  /**
   * The operator states that one item in a pack is one serving. Without it a
   * cell reading "12 cans" is a count of cans, and this will not call it 12
   * servings on its own.
   */
  servingsBasis?: boolean;
};

export type MappingSuggestion = {
  mapping: ColumnMapping;
  /** Headings nothing recognised. Not an error: most supplier files carry columns this site has no use for. */
  unmapped: string[];
  /** Required fields with no column. A draft cannot be built without these. */
  missingRequired: TargetField[];
};

export function suggestMapping(headers: string[], name = "Suggested"): MappingSuggestion {
  const byNormalised = new Map(headers.map((h) => [normaliseHeader(h), h]));
  const columns: Record<string, string> = {};
  const taken = new Set<string>();

  for (const field of DRINK_FIELDS) {
    for (const synonym of [field.key, ...field.synonyms]) {
      const header = byNormalised.get(normaliseHeader(synonym));
      if (header !== undefined && !taken.has(header)) {
        columns[field.key] = header;
        taken.add(header);
        break;
      }
    }
  }

  return {
    mapping: { version: 1, name, columns },
    unmapped: headers.filter((h) => !taken.has(h)),
    missingRequired: DRINK_FIELDS.filter((f) => f.required && columns[f.key] === undefined),
  };
}

/** A mapping read back from JSON, or the reason it was refused. */
export function parseMapping(text: string, headers: string[]): { ok: true; mapping: ColumnMapping; notes: string[] } | { ok: false; reason: string } {
  // Bounded like the supplier file it sits beside. A mapping is a handful of
  // column names, and anything large enough to matter is not one.
  if (text.length > MAX_MAPPING_BYTES) return { ok: false, reason: `A mapping file is a few hundred bytes. This one is ${Math.round(text.length / 1000)} kB.` };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "This is not JSON." };
  }
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: "A mapping is a JSON object." };
  const obj = raw as Partial<ColumnMapping>;
  if (obj.version !== 1) return { ok: false, reason: `This mapping says version ${String(obj.version)}. This tool writes and reads version 1.` };
  if (typeof obj.columns !== "object" || obj.columns === null) return { ok: false, reason: "A mapping needs a columns object." };

  const notes: string[] = [];
  const columns: Record<string, string> = {};
  for (const [key, header] of Object.entries(obj.columns)) {
    if (typeof header !== "string") continue;
    if (!DRINK_FIELDS.some((f) => f.key === key)) {
      notes.push(`"${key}" is not a field this tool maps to, and was left out.`);
      continue;
    }
    if (!headers.includes(header)) {
      notes.push(`"${header}" is not a column in this file, so ${key} was left unmapped.`);
      continue;
    }
    columns[key] = header;
  }
  let currency: string | undefined;
  if (typeof obj.currency === "string" && obj.currency !== "") {
    const code = obj.currency.toUpperCase();
    if ((SUPPORTED_CURRENCIES as readonly string[]).includes(code)) currency = code;
    else notes.push(`"${obj.currency}" is not a currency this reads, so no currency was set. It handles ${SUPPORTED_CURRENCIES.join(", ")}.`);
  }

  const units: Record<string, string> = {};
  for (const [key, unit] of Object.entries(obj.units ?? {})) {
    if (typeof unit !== "string") continue;
    const field = DRINK_FIELDS.find((f) => f.key === key);
    if (!field || field.kind !== "measure") {
      notes.push(`"${key}" is not a field that takes a unit, so that unit was left out.`);
      continue;
    }
    if (!(SUPPORTED_UNITS as readonly string[]).includes(unit)) {
      notes.push(`"${unit}" is not a unit this reads, so ${key} was left without one.`);
      continue;
    }
    units[key] = unit;
  }

  return {
    ok: true,
    mapping: {
      version: 1,
      name: typeof obj.name === "string" ? obj.name : "Imported",
      columns,
      currency,
      units: Object.keys(units).length > 0 ? units : undefined,
      servingsBasis: obj.servingsBasis === true ? true : undefined,
    },
    notes,
  };
}

export const serialiseMapping = (mapping: ColumnMapping): string => JSON.stringify(mapping, null, 2);
