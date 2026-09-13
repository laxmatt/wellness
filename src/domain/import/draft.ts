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
import { currencyFromHeader, readCell, unitFromHeader, type CellContext, type Flag, type ReadCell } from "./values";

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

/**
 * What a column states about itself, and who stated it.
 *
 * Three places can say what a measure column's unit or a price column's
 * currency is: the cell, the column heading, and the operator. The cell is
 * handled where the cell is read. This resolves the other two, and refuses when
 * they disagree rather than ranking them.
 */
function columnContext(field: TargetField, header: string, mapping: ColumnMapping): { ctx: CellContext; clash?: string } {
  const ctx: CellContext = { servingsBasis: mapping.servingsBasis === true };

  if (field.kind === "money") {
    const fromHeader = currencyFromHeader(header);
    const fromOperator = mapping.currency;
    if (fromHeader && fromOperator && fromHeader !== fromOperator) {
      return { ctx, clash: `The heading "${header}" says ${fromHeader} and the currency set beside the column says ${fromOperator}. Those disagree, so no price is read from this column until one of them changes.` };
    }
    const value = fromHeader ?? fromOperator;
    if (value) ctx.currency = { value, from: fromHeader ? `column heading "${header}"` : "currency set beside the column" };
  }

  if (field.kind === "measure") {
    const fromHeader = unitFromHeader(header);
    const fromOperator = mapping.units?.[field.key];
    if (fromHeader && fromOperator && fromHeader !== fromOperator) {
      return { ctx, clash: `The heading "${header}" says ${fromHeader} and the unit set beside the column says ${fromOperator}. Those disagree, so no figure is read from this column until one of them changes.` };
    }
    const value = fromHeader ?? fromOperator;
    if (value) ctx.unit = { value, from: fromHeader ? `column heading "${header}"` : "unit set beside the column" };
  }

  return { ctx };
}

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
      const { ctx, clash } = columnContext(field, header, mapping);
      // A disagreement between the heading and the operator is a disagreement,
      // not a precedence question. Letting the operator's box quietly overrule a
      // heading that says something else is how a column of euros gets read as
      // dollars with nothing on screen to show for it.
      const cell = clash ? { raw, flags: [{ severity: "blocker" as const, message: clash }] } : readCell(raw, field, ctx);
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
    title: "Who is actually speaking",
    detail:
      "A feed can come from the maker, from a distributor, or from a reseller, and the file usually does not say which. That decides what a figure is worth here, and it is not readable from the rows. Until somebody establishes it, the origin of every figure in this tool is unverified and pending review: no verification, no source kind and no method is recorded, because writing one down from a file that did not state it would be inventing the evidence rather than recording it.",
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
