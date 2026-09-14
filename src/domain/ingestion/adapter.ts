/**
 * The one place a partner's bytes become rows, and the only format that gets
 * past it today.
 *
 * Everything downstream works on a `SourceTable`: named columns, rows of
 * strings, and notes about what the reader had to do to get there. Nothing
 * downstream knows whether those rows came from a CSV, a spreadsheet or an
 * API, which is the point of the boundary and the reason it exists before
 * there is a second format to put behind it.
 *
 * What it is not: a parser that tries. A format with no adapter is refused by
 * name. Guessing at a spreadsheet's bytes would produce rows of nonsense with
 * nothing to show that anything had gone wrong, and a feed read wrong is worse
 * than a feed not read.
 */

import { LIMITS, readCsv } from "@/domain/import/csv";
import type { SourceFormat } from "./profile";

export type SourceTable = {
  columns: string[];
  /** One row, keyed by column name. A column the row does not reach is an empty string. */
  rows: Record<string, string>[];
  /** How the reader read it: a delimiter it settled on, a byte-order mark it removed. */
  notes: string[];
  /** Rows past the reader's limit, dropped rather than read. */
  truncated: number;
};

export type AdapterResult = { ok: true; table: SourceTable } | { ok: false; reason: string };

export type SourceAdapter = {
  format: SourceFormat;
  label: string;
  /** What this adapter will and will not do, shown beside the format in the tool. */
  note: string;
  read(text: string, byteLength: number): AdapterResult;
};

/**
 * CSV, and TSV, because the reader decides the delimiter from the file rather
 * than from its name and refuses a file where two delimiters both fit.
 *
 * This is a thin wrapper. Every rule about quoting, delimiters, byte-order
 * marks, oversized cells and duplicate headings lives in `readCsv`, which the
 * supplier-file tests already exercise, and none of it is restated here.
 */
export const csvAdapter: SourceAdapter = {
  format: "csv",
  label: "CSV or TSV",
  note: `Up to ${LIMITS.bytes / 1000} kB, ${LIMITS.rows} rows and ${LIMITS.columns} columns. The delimiter is read from the file and a file two delimiters both fit is refused.`,
  read(text, byteLength) {
    const table = readCsv(text, byteLength);
    if (!table.ok) return { ok: false, reason: table.reason };
    return {
      ok: true,
      table: {
        columns: table.headers,
        rows: table.rows.map((row) => Object.fromEntries(table.headers.map((h, i) => [h, row[i] ?? ""]))),
        notes: [`Read as ${table.delimiter === "\t" ? "tab" : `"${table.delimiter}"`} separated.`, ...table.notes],
        truncated: table.truncated,
      },
    };
  },
};

/** Why each unimplemented format is unimplemented, in the words the tool shows. */
const NOT_YET: Record<Exclude<SourceFormat, "csv">, string> = {
  xlsx: "A spreadsheet is a zip of XML with merged cells, formulas and several sheets, and which sheet holds the catalogue is a decision this has no way to make. No partner has sent one.",
  xml: "An XML feed carries its own schema, and mapping one means naming a repeating element and a path per field rather than a column per field. That is a second kind of mapping profile and no partner has sent an XML feed.",
  json: "Same as XML: a path per field rather than a column per field. No partner has sent one.",
  api: "An API is a credential, a rate limit and a schedule as well as a format. None of those exist here, and this flow deliberately holds no credential.",
};

const ADAPTERS: SourceAdapter[] = [csvAdapter];

export const adapters = (): SourceAdapter[] => [...ADAPTERS];

export function adapterFor(format: SourceFormat): { ok: true; adapter: SourceAdapter } | { ok: false; reason: string } {
  const adapter = ADAPTERS.find((a) => a.format === format);
  if (adapter) return { ok: true, adapter };
  return {
    ok: false,
    reason: `This flow reads ${ADAPTERS.map((a) => a.label).join(", ")} and does not read ${format}. ${NOT_YET[format as Exclude<SourceFormat, "csv">] ?? ""}`.trim(),
  };
}

/** Which formats exist as a choice, and whether each can be read yet. */
export const formatOptions = (): { format: SourceFormat; label: string; supported: boolean; note: string }[] => [
  { format: "csv", label: csvAdapter.label, supported: true, note: csvAdapter.note },
  ...(Object.entries(NOT_YET) as [Exclude<SourceFormat, "csv">, string][]).map(([format, note]) => ({ format: format as SourceFormat, label: format.toUpperCase(), supported: false, note })),
];
