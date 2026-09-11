/**
 * Reading one cell, and saying what could not be read.
 *
 * Three rules run through all of it.
 *
 * An empty cell is unknown. It is never zero, never false and never an empty
 * list. "0" is a real figure and means zero; nothing said means nothing known,
 * and the difference is the whole point of the withholding rules this site
 * already follows.
 *
 * A unit is part of the figure. "80" in a column headed caffeine is a number
 * with no unit attached, and this site stores milligrams. Where a file states a
 * unit that differs, the conversion is shown and flagged rather than applied
 * quietly, because a supplier writing g where they meant mg is a data error and
 * a silent conversion turns it into a plausible wrong number.
 *
 * The raw text is kept, always, next to whatever was made of it.
 */

import type { TargetField } from "./fields";

export type FlagSeverity = "blocker" | "check";
export type Flag = { severity: FlagSeverity; message: string };

export type CellValue =
  | { kind: "number"; value: number; unit?: string }
  | { kind: "money"; minor: number; currency: string }
  | { kind: "integer"; value: number }
  | { kind: "text"; value: string }
  | { kind: "list"; value: string[] };

export type ReadCell = {
  raw: string;
  value?: CellValue;
  flags: Flag[];
};

const blocker = (message: string): Flag => ({ severity: "blocker", message });
const check = (message: string): Flag => ({ severity: "check", message });

/**
 * When nothing could be read, only the reasons why.
 *
 * A note saying how a comma was read is useful beside a figure and noise beside
 * a rejection: the figure it describes is not there.
 */
const onlyBlockers = (flags: Flag[]): Flag[] => flags.filter((f) => f.severity === "blocker");

/**
 * A cell a spreadsheet would run.
 *
 * Never executed here: this is a string in a browser, not a formula engine. It
 * is flagged because the same file opened in Excel would run it, and because a
 * cell starting with = is far more likely to be a broken export than a value.
 */
export function looksLikeFormula(raw: string): boolean {
  const t = raw.trim();
  if (t === "") return false;
  if (t.startsWith("=") || t.startsWith("@")) return true;
  // A leading + or - is only suspicious when what follows is not a number.
  if (/^[+-]/.test(t) && !/^[+-]?\d/.test(t)) return true;
  return false;
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR" };
const KNOWN_CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD"];

/**
 * A currency a column heading states, if it states one.
 *
 * "unit_price_usd" says USD in the same way "0,08 g" says grams: it is stated,
 * not inferred, and reading it is not the same as assuming one. A heading of
 * "price" says nothing and still gets nothing. The code has to stand on its own
 * as a word, so "cost_in_aud" counts and "used_price" does not.
 */
export function currencyFromHeader(header: string): string | undefined {
  const words = header.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (const code of KNOWN_CURRENCIES) if (words.includes(code.toLowerCase())) return code;
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) if (header.includes(symbol)) return code;
  return undefined;
}

/** g and mg convert exactly. Anything else is a different kind of measurement. */
const CONVERSIONS: Record<string, Record<string, number>> = {
  g: { mg: 0.001, g: 1 },
  mg: { g: 1000, mg: 1 },
};

function readNumber(text: string): number | undefined {
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A decimal point, when the file makes it unambiguous.
 *
 * "24,00" is twenty-four in half of Europe and a malformed figure elsewhere.
 * The one shape that is genuinely ambiguous is a comma with exactly three
 * digits after it: "1,234" is a thousand two hundred to one reader and one
 * point two three four to another, and that is refused. Any other count of
 * digits settles it, because a thousands group is always exactly three, so
 * "0,5" and "24,00" are decimals and nothing else.
 */
function normaliseDecimal(text: string): { text: string; note?: string } | { ambiguous: true } {
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (!hasComma) return { text };
  if (hasDot) {
    // Both present: the last one is the decimal separator, the other groups.
    return text.lastIndexOf(",") > text.lastIndexOf(".")
      ? { text: text.replace(/\./g, "").replace(",", "."), note: "Read with a comma as the decimal separator and a period grouping thousands." }
      : { text: text.replace(/,/g, ""), note: "Read with a period as the decimal separator and a comma grouping thousands." };
  }
  const single = /^(\d+),(\d+)$/.exec(text);
  if (single && single[2].length !== 3) return { text: text.replace(",", "."), note: "Read as a decimal comma." };
  return { ambiguous: true };
}

function readMeasure(raw: string, field: TargetField): ReadCell {
  const t = raw.trim();
  const match = /^([+-]?[\d.,]+)\s*([a-zA-Zµ]*)$/.exec(t);
  if (!match) return { raw, flags: [blocker(`"${t}" is not a number with an optional unit.`)] };

  const decimal = normaliseDecimal(match[1]);
  if ("ambiguous" in decimal) {
    return { raw, flags: [blocker(`"${t}" could be read two ways: the comma is either a decimal point or a thousands separator. Refused rather than guessed.`)] };
  }
  const n = readNumber(decimal.text);
  if (n === undefined) return { raw, flags: [blocker(`"${t}" is not a number.`)] };

  const flags: Flag[] = [];
  if (decimal.note) flags.push(check(decimal.note));
  if (n < 0) flags.push(blocker("A negative amount is not a nutrition figure."));

  const stated = match[2].toLowerCase();
  const target = field.unit!;
  if (stated === "") {
    flags.push(check(`No unit stated. Taken as ${target}, which is what this site stores, and worth confirming against the supplier's own sheet.`));
    return { raw, value: { kind: "number", value: n, unit: target }, flags };
  }
  if (stated === target) return { raw, value: { kind: "number", value: n, unit: target }, flags };

  const factor = CONVERSIONS[target]?.[stated];
  if (factor === undefined) {
    flags.push(blocker(`Stated in ${match[2]}, and this site stores ${target}. Those do not convert, so the figure is not read.`));
    return { raw, flags: onlyBlockers(flags) };
  }
  flags.push(check(`Stated in ${match[2]} and converted to ${target}: ${n} ${match[2]} is ${n * factor} ${target}. Confirm the supplier meant ${match[2]}.`));
  return { raw, value: { kind: "number", value: n * factor, unit: target }, flags };
}

function readMoney(raw: string, columnCurrency?: string): ReadCell {
  const t = raw.trim();
  const flags: Flag[] = [];
  let currency = columnCurrency;
  let rest = t;

  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (rest.includes(symbol)) {
      if (currency && currency !== code) flags.push(blocker(`The column says ${currency} and the cell says ${symbol}. Those disagree, so the price is not read.`));
      currency = currency ?? code;
      rest = rest.replace(symbol, "");
    }
  }
  const code = /\b([A-Z]{3})\b/.exec(rest);
  if (code && KNOWN_CURRENCIES.includes(code[1])) {
    if (currency && currency !== code[1]) flags.push(blocker(`The column says ${currency} and the cell says ${code[1]}. Those disagree, so the price is not read.`));
    currency = currency ?? code[1];
    rest = rest.replace(code[1], "");
  }
  rest = rest.trim();

  if (!currency) {
    flags.push(blocker("No currency. A bare number is not a price, and the currency is not assumed from anything."));
    return { raw, flags: onlyBlockers(flags) };
  }
  if (flags.some((f) => f.severity === "blocker")) return { raw, flags: onlyBlockers(flags) };

  const decimal = normaliseDecimal(rest);
  if ("ambiguous" in decimal) {
    return { raw, flags: [blocker(`"${t}" could be read two ways: the comma is either a decimal point or a thousands separator. Refused rather than guessed.`)] };
  }
  if (decimal.note) flags.push(check(decimal.note));
  const n = readNumber(decimal.text);
  if (n === undefined || n < 0) return { raw, flags: onlyBlockers([...flags, blocker(`"${t}" is not an amount.`)]) };

  const minor = Math.round(n * 100);
  if (Math.abs(n * 100 - minor) > 1e-9) flags.push(check(`Rounded to ${(minor / 100).toFixed(2)} ${currency}, because prices are stored in whole cents.`));
  return { raw, value: { kind: "money", minor, currency }, flags };
}

function readCount(raw: string): ReadCell {
  const t = raw.trim();
  const match = /^(\d+)\s*(.*)$/.exec(t);
  if (!match) return { raw, flags: [blocker(`"${t}" is not a whole number.`)] };
  const n = Number(match[1]);
  const trailing = match[2].trim();
  const flags: Flag[] = [];
  if (trailing !== "") {
    flags.push(
      check(`Counted as ${n}, with "${trailing}" ignored. A pack of ${n} ${trailing} is ${n} servings only if one ${trailing.replace(/s$/, "")} is one serving, which this file does not say.`),
    );
  }
  if (n === 0) flags.push(blocker("A pack of zero is not a pack."));
  return { raw, value: { kind: "integer", value: n }, flags };
}

function readList(raw: string, field: TargetField): ReadCell {
  const parts = raw
    .split(/[|,;/]/)
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((p) => p !== "");
  if (parts.length === 0) return { raw, flags: [blocker("No value.")] };

  const allowed = field.allowed ?? [];
  const unknown = parts.filter((p) => !allowed.includes(p));
  const flags: Flag[] = [];
  if (unknown.length > 0) {
    flags.push(
      blocker(
        `${unknown.map((u) => `"${u}"`).join(", ")} ${unknown.length === 1 ? "is not a value" : "are not values"} this site uses. It filters on ${allowed.join(", ")}. Deciding that the supplier's word means one of ours is an editorial call, not a conversion.`,
      ),
    );
  }
  const known = parts.filter((p) => allowed.includes(p));
  const value = known.length > 0 ? ({ kind: "list", value: known } as const) : undefined;
  return { raw, value, flags: value ? flags : onlyBlockers(flags) };
}

function readClassification(raw: string, field: TargetField): ReadCell {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "-");
  const allowed = field.allowed ?? [];
  if (!allowed.includes(t)) {
    return { raw, flags: [blocker(`"${raw.trim()}" is not a category this site compares. It holds ${allowed.join(", ")}.`)] };
  }
  return { raw, value: { kind: "text", value: t }, flags: [] };
}

/**
 * Read one cell for one field.
 *
 * `columnCurrency` is a currency the mapping states for a whole price column,
 * which is how a file with a bare "24.00" can still produce a price: somebody
 * stated the currency, rather than this assuming one.
 */
export function readCell(raw: string, field: TargetField, columnCurrency?: string): ReadCell {
  const t = raw.trim();
  if (t === "") {
    // Unknown. Not zero, not false, not an empty list.
    return { raw, flags: field.required ? [blocker("Nothing in this cell, and a draft needs this field.")] : [check("Nothing in this cell. Held as unknown, which is not the same as zero.")] };
  }
  if (looksLikeFormula(t)) {
    return {
      raw,
      flags: [blocker("This cell starts like a spreadsheet formula. It is kept as text and never run here, and it is almost certainly a broken export rather than a value.")],
    };
  }

  switch (field.kind) {
    case "measure":
      return readMeasure(raw, field);
    case "money":
      return readMoney(raw, columnCurrency);
    case "count":
      return readCount(raw);
    case "list":
      return readList(raw, field);
    case "classification":
      return readClassification(raw, field);
    case "identity":
    case "reference":
    default: {
      const flags: Flag[] = [];
      if (field.key === "source_reference" && /^https?:\/\//i.test(t)) {
        flags.push(check("A link, kept as text. This tool never opens it, and a reviewer decides whether the page behind it is evidence."));
      }
      return { raw, value: { kind: "text", value: t }, flags };
    }
  }
}
