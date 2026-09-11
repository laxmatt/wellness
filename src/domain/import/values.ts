/**
 * Reading one cell, and saying what could not be read.
 *
 * Four rules run through all of it.
 *
 * An empty cell is unknown. It is never zero, never false and never an empty
 * list. "0" is a real figure and means zero; nothing said means nothing known,
 * and the difference is the whole point of the withholding rules this site
 * already follows.
 *
 * A figure without a unit is not a figure. A bare "80" in a column nobody has
 * labelled is a number with no meaning, and taking it as milligrams because
 * that is what this site happens to store is an assumption wearing a default's
 * clothes. A unit has to be stated: in the cell, in the column heading, or by
 * the operator. Otherwise the figure is not read.
 *
 * The same for money. "$" is the dollar of a dozen countries, so it names no
 * currency; a code does. An amount with no stated, supported currency is not a
 * price.
 *
 * A blocked value carries no value. Where something is rejected the draft holds
 * the raw text and the reasons, and nothing that could be mistaken for a figure
 * somebody can use.
 */

import type { TargetField } from "./fields";

export type FlagSeverity = "blocker" | "check";
export type Flag = { severity: FlagSeverity; message: string };

export type CellValue =
  | { kind: "number"; value: number; unit: string }
  | { kind: "money"; minor: number; currency: string }
  | { kind: "integer"; value: number }
  | { kind: "text"; value: string }
  | { kind: "list"; value: string[] };

export type ReadCell = {
  raw: string;
  value?: CellValue;
  flags: Flag[];
};

/** Something stated for a whole column, and who stated it. */
export type Stated = { value: string; from: string };

export type CellContext = {
  /** The unit of a measure column: from its heading, or set by the operator. */
  unit?: Stated;
  /** The currency of a price column: from its heading, or set by the operator. */
  currency?: Stated;
  /**
   * The operator has stated that one item in a pack is one serving. Without it,
   * "12 cans" is a count of cans and this will not call it 12 servings.
   */
  servingsBasis?: boolean;
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
const rejected = (raw: string, flags: Flag[]): ReadCell => ({ raw, flags: onlyBlockers(flags) });

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

/**
 * Currencies this will read.
 *
 * Every one of them divides into a hundred, which is the only reason a price
 * can be stored here as an integer number of minor units. JPY has no minor unit
 * and KWD has three digits, so a hundred is the wrong multiplier for both and
 * reading them would produce an amount a hundred times out. They are refused
 * until this holds an exponent per currency, which is a change to how money is
 * stored rather than a parsing tweak.
 */
export const SUPPORTED_CURRENCIES = ["USD", "GBP", "EUR", "CAD", "AUD", "NZD", "CHF"] as const;
/**
 * What a symbol could be, within the currencies anybody uses.
 *
 * A symbol never establishes a currency here, not even an unambiguous one: it
 * can only agree with a stated code or contradict it. But it is not nothing. A
 * cell reading "£12" in a column somebody has set to EUR is not twelve euros,
 * and reading it as twelve euros because the code outranks the symbol is how a
 * sterling price ends up in the books as a euro one.
 */
const SYMBOL_CANDIDATES: { symbol: string; currencies: string[]; name: string }[] = [
  { symbol: "$", currencies: ["USD", "CAD", "AUD", "NZD", "SGD", "HKD"], name: "a dollar sign" },
  { symbol: "£", currencies: ["GBP"], name: "a pound sign" },
  { symbol: "€", currencies: ["EUR"], name: "a euro sign" },
  { symbol: "¥", currencies: ["JPY", "CNY"], name: "a yen or yuan sign" },
  { symbol: "₹", currencies: ["INR"], name: "a rupee sign" },
  { symbol: "₽", currencies: ["RUB"], name: "a rouble sign" },
];

const UNIT_WORDS: Record<string, string> = {
  g: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  mg: "mg",
  milligram: "mg",
  milligrams: "mg",
  milligramme: "mg",
  milligrammes: "mg",
};

/** The units a measure field can be stored in here. */
export const SUPPORTED_UNITS = ["g", "mg"] as const;

/** g and mg convert exactly. Anything else is a different kind of measurement. */
const CONVERSIONS: Record<string, Record<string, number>> = {
  g: { mg: 0.001, g: 1 },
  mg: { g: 1000, mg: 1 },
};

const words = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/).filter(Boolean);

/**
 * A unit a column heading states, if it states one unambiguously.
 *
 * "sugar_g" and "Caffeine (mg)" each name a unit. "Sugar" names none and gets
 * none. A heading naming two of them names nothing usable, and is treated as
 * silent rather than resolved in this tool's favour.
 */
export function unitFromHeader(header: string): string | undefined {
  const found = new Set(words(header).map((w) => UNIT_WORDS[w]).filter((u): u is string => u !== undefined));
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * A currency a column heading states, if it states a supported one.
 *
 * A code, as a word: "unit_price_usd" states USD. A symbol states nothing. "$"
 * is the dollar of the United States, Canada, Australia, New Zealand, Singapore
 * and a dozen others, and picking one of them because the file reads as English
 * would be a guess with money attached to it.
 */
export function currencyFromHeader(header: string): string | undefined {
  const found = new Set(words(header).map((w) => w.toUpperCase()).filter((w) => (SUPPORTED_CURRENCIES as readonly string[]).includes(w)));
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * A decimal number, in decimal, with nothing clever.
 *
 * Number() accepts "0x1f", "1e3", "Infinity" and the empty string, and turns
 * the last of those into zero. A supplier file carrying any of them is not
 * stating an amount, so the syntax is pinned here rather than delegated:
 * digits, optionally a point, optionally more digits.
 */
function strictDecimal(text: string): number | undefined {
  if (!/^\d+(\.\d+)?$/.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A decimal point, where the file makes it unambiguous.
 *
 * "24,00" is twenty-four in half of Europe. The shape that is genuinely
 * ambiguous is a comma with exactly three digits after it: "1,234" is a
 * thousand two hundred to one reader and one point two three four to another,
 * and that is refused. Any other count of digits settles it, because a
 * thousands group is always exactly three.
 *
 * Grouping has to be well formed to be read as grouping. "1,2.34" is not a
 * number with a thousands separator in it, and reading it as 12.34 would invent
 * a figure out of a typo.
 */
function normaliseDecimal(text: string): { text: string; note?: string } | { ambiguous: string } {
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (!hasComma) return { text };

  if (hasDot) {
    const commaLast = text.lastIndexOf(",") > text.lastIndexOf(".");
    // Whichever is the grouping separator has to group in threes, all the way.
    const grouped = commaLast ? /^\d{1,3}(\.\d{3})+,\d+$/.test(text) : /^\d{1,3}(,\d{3})+\.\d+$/.test(text);
    if (!grouped) return { ambiguous: `"${text}" mixes a comma and a period in a way that is not a number: the grouping does not run in threes.` };
    return commaLast
      ? { text: text.replace(/\./g, "").replace(",", "."), note: "Read with a comma as the decimal separator and a period grouping thousands." }
      : { text: text.replace(/,/g, ""), note: "Read with a period as the decimal separator and a comma grouping thousands." };
  }

  const single = /^(\d+),(\d+)$/.exec(text);
  if (!single) return { ambiguous: `"${text}" has more than one comma and no decimal point, so what any of them mean is not stated.` };
  if (single[2].length === 3) return { ambiguous: `"${text}" could be read two ways: the comma is either a decimal point or a thousands separator.` };
  return { text: text.replace(",", "."), note: "Read as a decimal comma." };
}

// A nutrition figure past this is not a nutrition figure, and a price past it is
// not a price a shop charges. Both keep the arithmetic well inside what an
// integer holds exactly.
const MAX_MEASURE = 1_000_000;
const MAX_MINOR = 1_000_000_000;
const MAX_COUNT = 100_000;

function readMeasure(raw: string, field: TargetField, ctx: CellContext): ReadCell {
  const t = raw.trim();
  const match = /^([+-]?[\d.,]+)\s*([a-zA-Zµ]*)$/.exec(t);
  if (!match) return rejected(raw, [blocker(`"${t}" is not a number with an optional unit.`)]);

  const decimal = normaliseDecimal(match[1].replace(/^[+-]/, ""));
  if ("ambiguous" in decimal) return rejected(raw, [blocker(`${decimal.ambiguous} Refused rather than guessed.`)]);

  const flags: Flag[] = [];
  if (decimal.note) flags.push(check(decimal.note));

  // A negative reading is refused outright. It used to be flagged and still
  // handed back a figure, which is the one shape a blocked cell must never take.
  if (match[1].startsWith("-")) return rejected(raw, [...flags, blocker("A negative amount is not a nutrition figure, so nothing is read from this cell.")]);

  const n = strictDecimal(decimal.text);
  if (n === undefined) return rejected(raw, [...flags, blocker(`"${t}" is not a plain decimal number.`)]);
  if (n > MAX_MEASURE) return rejected(raw, [...flags, blocker(`${n} is past anything this reads as a nutrition figure.`)]);

  // Which unit, and who said so. A unit is never supplied by this tool.
  const cellUnit = match[2] === "" ? undefined : (UNIT_WORDS[match[2].toLowerCase()] ?? match[2].toLowerCase());
  const column = ctx.unit;
  if (cellUnit && column && cellUnit !== column.value) {
    return rejected(raw, [...flags, blocker(`The cell says ${match[2]} and the ${column.from} says ${column.value}. Those disagree, so the figure is not read.`)]);
  }
  const unit = cellUnit ?? column?.value;
  if (!unit) {
    return rejected(raw, [
      ...flags,
      blocker(
        `No unit. Neither the cell nor the column states one, so this is a bare number. This site stores ${field.unit}, and taking the number as ${field.unit} for that reason would be an assumption rather than a reading. Put the unit in the column heading, or set it beside the column.`,
      ),
    ]);
  }
  if (cellUnit === undefined && column) flags.push(check(`Unit taken from the ${column.from}: ${column.value}. The cell itself states none.`));

  const target = field.unit!;
  if (unit === target) return { raw, value: { kind: "number", value: n, unit: target }, flags };

  const factor = CONVERSIONS[target]?.[unit];
  if (factor === undefined) return rejected(raw, [...flags, blocker(`Stated in ${unit}, and this site stores ${target}. Those do not convert, so the figure is not read.`)]);
  flags.push(check(`Stated in ${unit} and converted to ${target}: ${n} ${unit} is ${n * factor} ${target}. Confirm the supplier meant ${unit}.`));
  return { raw, value: { kind: "number", value: n * factor, unit: target }, flags };
}

function readMoney(raw: string, ctx: CellContext): ReadCell {
  const t = raw.trim();
  const flags: Flag[] = [];
  let rest = t;

  const symbols = SYMBOL_CANDIDATES.filter((s) => rest.includes(s.symbol));
  if (symbols.length > 1) {
    return rejected(raw, [blocker(`"${t}" carries ${symbols.map((s) => s.name).join(" and ")}. Two currency symbols in one amount is not an amount.`)]);
  }
  const symbol = symbols[0];
  const codeMatch = /(?:^|[^A-Za-z])([A-Za-z]{3})(?:[^A-Za-z]|$)/.exec(rest);
  const cellCode = codeMatch ? codeMatch[1].toUpperCase() : undefined;
  if (codeMatch) rest = rest.replace(codeMatch[1], "");
  if (symbol) rest = rest.split(symbol.symbol).join("");
  rest = rest.trim();

  if (cellCode && !(SUPPORTED_CURRENCIES as readonly string[]).includes(cellCode)) {
    return rejected(raw, [
      blocker(
        `${cellCode} is not a currency this reads. It handles ${SUPPORTED_CURRENCIES.join(", ")}, all of which divide into a hundred. A currency with no minor unit, or with three digits, would come out a hundred times wrong, so it is refused until this stores an exponent per currency.`,
      ),
    ]);
  }

  const column = ctx.currency;
  if (cellCode && column && cellCode !== column.value) {
    return rejected(raw, [blocker(`The cell says ${cellCode} and the ${column.from} says ${column.value}. Those disagree, so the price is not read.`)]);
  }
  const currency = cellCode ?? column?.value;
  if (!currency) {
    const because = symbol ? `"${symbol.symbol}" is ${symbol.name}, and a symbol is not a code: it does not say which country's money this is.` : "Neither the cell nor the column states one.";
    return rejected(raw, [blocker(`No currency. ${because} Put a code such as ${SUPPORTED_CURRENCIES[0]} in the heading, or set one beside the column.`)]);
  }
  // A symbol cannot name the currency, but it can rule one out. This is the
  // check that stops "£12" in a EUR column from being read as twelve euros.
  if (symbol && !symbol.currencies.includes(currency)) {
    const where = cellCode ? "the cell" : (column?.from ?? "the column");
    return rejected(raw, [
      blocker(
        `The amount carries ${symbol.name} and ${where} says ${currency}. ${symbol.symbol} is ${symbol.currencies.join(", ")}, so those contradict each other and nothing is read.`,
      ),
    ]);
  }
  if (!cellCode && column) flags.push(check(`Currency taken from the ${column.from}: ${column.value}. The cell itself states none.`));

  // "$" on its own used to reach Number(""), which is zero, and became a free
  // product. An amount has to be present and has to be a decimal number.
  if (rest === "") return rejected(raw, [...flags, blocker(`"${t}" states no amount.`)]);
  const decimal = normaliseDecimal(rest);
  if ("ambiguous" in decimal) return rejected(raw, [...flags, blocker(`${decimal.ambiguous} Refused rather than guessed.`)]);
  if (decimal.note) flags.push(check(decimal.note));

  const n = strictDecimal(decimal.text);
  if (n === undefined) return rejected(raw, [...flags, blocker(`"${t}" is not a plain decimal amount.`)]);

  const minor = Math.round(n * 100);
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return rejected(raw, [...flags, blocker(`${n} is past anything this reads as a price.`)]);
  if (Math.abs(n * 100 - minor) > 1e-9) flags.push(check(`Rounded to ${(minor / 100).toFixed(2)} ${currency}, because prices are stored in whole cents.`));
  return { raw, value: { kind: "money", minor, currency }, flags };
}

/**
 * Words this recognises as one packed thing.
 *
 * Written down, like every other vocabulary here. A label nobody wrote down is
 * a label this cannot reason about: "12 cases" is not twelve of anything a
 * shopper drinks, and guessing that it might be would be the same mistake as
 * turning cans into servings.
 */
const ITEM_LABELS = [
  "can", "cans",
  "stick", "sticks",
  "sachet", "sachets",
  "packet", "packets",
  "scoop", "scoops",
  "tablet", "tablets",
  "capsule", "capsules",
  "bottle", "bottles",
  "pouch", "pouches",
  "bar", "bars",
  "piece", "pieces",
  "unit", "units",
];
/** The one label that already says servings, and so needs no basis at all. */
const SERVING_LABELS = ["serving", "servings"];

function readCount(raw: string, ctx: CellContext): ReadCell {
  const t = raw.trim();
  // The whole cell has to be a whole number and, at most, one word. Pinned here
  // and not after the basis question: a looser shape used to capture the digits
  // off the front of "1.5" and "1e3" and hand back 1 as soon as the basis was
  // stated, which turned an operator's tick into a number the file never held.
  const match = /^(\d+)(?:\s+([A-Za-z]+))?$/.exec(t);
  if (!match) {
    return rejected(raw, [
      blocker(`"${t}" is not a whole number, optionally followed by one word naming what is counted. A count is whole: no decimals, no exponents, no punctuation.`),
    ]);
  }

  const n = Number(match[1]);
  if (!Number.isSafeInteger(n) || n > MAX_COUNT) return rejected(raw, [blocker(`"${match[1]}" is past anything this reads as a pack size.`)]);
  if (n === 0) return rejected(raw, [blocker("A pack of zero is not a pack.")]);

  const label = match[2]?.toLowerCase();
  if (label === undefined) return { raw, value: { kind: "integer", value: n }, flags: [] };

  if (SERVING_LABELS.includes(label)) return { raw, value: { kind: "integer", value: n }, flags: [check(`Counted as ${n} servings, which is what the cell says it counts.`)] };

  if (!ITEM_LABELS.includes(label)) {
    return rejected(raw, [
      blocker(`"${match[2]}" is not a word this recognises as one packed item. It knows ${ITEM_LABELS.slice(0, 6).join(", ")} and a few more, and it will not assume what an unfamiliar one holds.`),
    ]);
  }

  // A count of cans is a count of cans. Calling it servings needs somebody to
  // say that one can is one serving, and this used to say it for them.
  const one = label.replace(/s$/, "");
  if (!ctx.servingsBasis) {
    return rejected(raw, [
      blocker(
        `This counts ${n} ${label}, and the field holds servings. ${n} ${label} is ${n} servings only if one ${one} is one serving, which the file does not say. State that basis beside the column if it is true, or map servings from a column that counts servings.`,
      ),
    ]);
  }
  return {
    raw,
    value: { kind: "integer", value: n },
    flags: [check(`Counted as ${n} servings from ${n} ${label}, because one item per serving was stated for this column. The file itself does not say it.`)],
  };
}

function readList(raw: string, field: TargetField): ReadCell {
  const parts = raw
    .split(/[|,;/]/)
    .map((p) => p.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter((p) => p !== "");
  if (parts.length === 0) return rejected(raw, [blocker("No value.")]);

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
  return value ? { raw, value, flags } : rejected(raw, flags);
}

function readClassification(raw: string, field: TargetField): ReadCell {
  const t = raw.trim().toLowerCase().replace(/\s+/g, "-");
  const allowed = field.allowed ?? [];
  if (!allowed.includes(t)) return rejected(raw, [blocker(`"${raw.trim()}" is not a category this site compares. It holds ${allowed.join(", ")}.`)]);
  return { raw, value: { kind: "text", value: t }, flags: [] };
}

/** Read one cell for one field, given whatever the column states. */
export function readCell(raw: string, field: TargetField, ctx: CellContext = {}): ReadCell {
  const t = raw.trim();
  if (t === "") {
    // Unknown. Not zero, not false, not an empty list.
    return { raw, flags: field.required ? [blocker("Nothing in this cell, and a draft needs this field.")] : [check("Nothing in this cell. Held as unknown, which is not the same as zero.")] };
  }
  if (looksLikeFormula(t)) {
    return rejected(raw, [blocker("This cell starts like a spreadsheet formula. It is kept as text and never run here, and it is almost certainly a broken export rather than a value.")]);
  }

  switch (field.kind) {
    case "measure":
      return readMeasure(raw, field, ctx);
    case "money":
      return readMoney(raw, ctx);
    case "count":
      return readCount(raw, ctx);
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
