/**
 * A draft record, and the list of what is still unsettled about it.
 *
 * A draft is not a product. It is a proposal built from one supplier's row,
 * carrying the raw text it came from, whatever could be read out of it, and
 * every reason it cannot be published as it stands.
 *
 * The second list is the point of the whole demonstration. A file that parses
 * cleanly still leaves the two questions this site cannot answer from a feed:
 * which product and variant this actually is, and whether a supplier saying
 * something makes it a fact. Those never come out green, however good the CSV
 * is, so they are stated as standing review items rather than as flags a clean
 * file would clear.
 */

import { DRINK_FIELDS, fieldByKey, type TargetField } from "./fields";
import type { ColumnMapping } from "./mapping";
import { currencyFromHeader, readCell, type Flag, type ReadCell } from "./values";

export type DraftField = ReadCell & { field: TargetField };

export type Draft = {
  /** The row in the file, counting the heading as row 1, so it matches what a spreadsheet shows. */
  row: number;
  fields: DraftField[];
  blockers: number;
  checks: number;
  /** A short name for the row, from the file's own text, for a reviewer scanning the list. */
  label: string;
};

export type DraftSet = {
  drafts: Draft[];
  /** Fields a draft needs that the mapping does not fill. */
  missingRequired: TargetField[];
  totals: { rows: number; clean: number; withChecks: number; withBlockers: number };
};

export function buildDrafts(headers: string[], rows: string[][], mapping: ColumnMapping): DraftSet {
  const indexOf = new Map(headers.map((h, i) => [h, i]));
  const missingRequired = DRINK_FIELDS.filter((f) => f.required && mapping.columns[f.key] === undefined);

  const drafts = rows.map((row, i) => {
    const fields: DraftField[] = [];
    for (const [key, header] of Object.entries(mapping.columns)) {
      const field = fieldByKey(key);
      const column = indexOf.get(header);
      if (!field || column === undefined) continue;
      const raw = row[column] ?? "";
      // A currency the operator stated for the column wins. Failing that, one
      // the heading itself states is read, the same way a unit inside a cell is
      // read: stated, not assumed. A heading saying nothing still gets nothing,
      // and the price is refused rather than given a default.
      const fromHeader = field.kind === "money" ? currencyFromHeader(header) : undefined;
      const currency = field.kind === "money" ? (mapping.currency ?? fromHeader) : undefined;
      const cell = readCell(raw, field, currency);
      if (field.kind === "money" && !mapping.currency && fromHeader && cell.value) {
        cell.flags = [...cell.flags, { severity: "check", message: `Currency read from the column heading "${header}". Confirm the supplier means ${fromHeader} in every row.` }];
      }
      fields.push({ field, ...cell });
    }
    // In the order this file declares them, so the list reads the same way twice.
    fields.sort((a, b) => DRINK_FIELDS.indexOf(a.field) - DRINK_FIELDS.indexOf(b.field));

    const count = (severity: Flag["severity"]) => fields.reduce((n, f) => n + f.flags.filter((x) => x.severity === severity).length, 0);
    const name = fields.find((f) => f.field.key === "name")?.raw.trim();
    const sku = fields.find((f) => f.field.key === "supplier_sku")?.raw.trim();
    return {
      row: i + 2,
      fields,
      blockers: count("blocker") + missingRequired.length,
      checks: count("check"),
      label: name || sku || `Row ${i + 2}`,
    };
  });

  return {
    drafts,
    missingRequired,
    totals: {
      rows: drafts.length,
      clean: drafts.filter((d) => d.blockers === 0 && d.checks === 0).length,
      withChecks: drafts.filter((d) => d.blockers === 0 && d.checks > 0).length,
      withBlockers: drafts.filter((d) => d.blockers > 0).length,
    },
  };
}

/**
 * What a person still has to do, on every row, however clean the file is.
 *
 * These are not parse results and no file clears them. They are here because a
 * demonstration that ends at "12 rows validated" would suggest the hard part is
 * done, and the hard part has not started.
 */
export const STANDING_REVIEW: { title: string; detail: string }[] = [
  {
    title: "Which product this is",
    detail:
      "A supplier row names a line in their catalogue. Matching it to a product here, or deciding it is a new one, is a person's judgement. Nothing in this tool matches anything to the catalogue, by name or by code.",
  },
  {
    title: "Which variant this is",
    detail:
      "Flavour, size and pack count separate records that otherwise look identical. A row reading a brand and a product name usually settles none of the three, and a wrong variant is a wrong price, a wrong sugar figure and a wrong caffeine figure at once.",
  },
  {
    title: "Whether the supplier is evidence",
    detail:
      "Every figure here is a supplier's claim. On this site that is a retailer speaking, not the maker: it is recorded as merchant_feed, method secondhand, and never as manufacturer_reported unless the maker's own page has been read.",
  },
  {
    title: "What date the figures carry",
    detail: "A record needs the date the figure was read. A file has no date in it unless the supplier put one there, and the date it was downloaded is not the date the figure was true.",
  },
  {
    title: "Whether a price is an offer",
    detail: "A supplier's price belongs to that merchant on that day. It becomes an offer with the merchant named and the date attached, and never the product's own price.",
  },
  {
    title: "What is missing entirely",
    detail:
      "Serving size, format, sodium, calories and the rest are not in this mapping. A draft is silent on them rather than defaulted, and a product page will not show a figure this site does not hold.",
  },
];
