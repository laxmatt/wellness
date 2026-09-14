/**
 * A partner's rows, a profile, and the records they would make.
 *
 * Three jobs, in order. Drop the rows the profile says are not products of
 * ours, and say which rule dropped each one. Group what is left into products,
 * because a feed of 225 rows is not 225 products when one cabin is sold in
 * eighteen configurations. Then read each group's representative row into
 * fields, by the profile's mapping, with every refusal kept rather than
 * swallowed.
 *
 * What comes out is fields and not yet a record. The merge decides which of
 * these fields may be written over what is already on disk, and only then is a
 * `Product` assembled. Keeping those apart is what makes a re-import able to
 * take a new price without taking a new name somebody wrote by hand.
 */

import type { AttributeDefinition } from "@/domain/attributes";
import type { CategoryDefinition } from "@/domain/category";
import { applyExtraction, extractionNote, type Extraction } from "./extract";
import { normaliseAttribute, readAvailability, readPrice, slugPart } from "./normalize";
import {
  mappingFor,
  targetInfo,
  type CanonicalTarget,
  type ExclusionRule,
  type FieldOwnership,
  type MappingProfile,
  type PartnerSource,
} from "./profile";

export type ExcludedRow = { row: number; column: string; value: string; reason: string };
export type ValueError = { id: string; field: string; raw: string; reason: string };

export type FieldMeta = {
  label: string;
  ownership: FieldOwnership;
  /** `direct` a column, `extracted` a pattern a person approved, `stated` a person's own statement on the source. */
  provenance: "direct" | "extracted" | "stated";
};

export type Candidate = {
  id: string;
  groupKey: string;
  /** The brand's name as this row states it, or the source's stated default. The `brand` field holds its id. */
  brandName: string;
  /** Row numbers as they appear in the file, counting the heading as row 1. */
  rows: number[];
  representativeRow: number;
  /** The feed's view of this record. Keys are `name`, `price`, `attr:<key>` and so on. */
  fields: Record<string, unknown>;
  notes: Record<string, string>;
  meta: Record<string, FieldMeta>;
  extractions: Extraction[];
  valueErrors: ValueError[];
  /** Why this group cannot become a record at all. */
  failures: string[];
  /** How many rows this record stands for, and what that choice cost. */
  groupNote: string;
};

export type BuildOutput = {
  candidates: Candidate[];
  excluded: ExcludedRow[];
  /** Rows with no grouping key, which is a row this cannot place rather than a row it drops. */
  ungrouped: { row: number; reason: string }[];
};

export const ATTR_PREFIX = "attr:";

const cell = (row: Record<string, string>, column: string): string => (row[column] ?? "").trim();

function excludedBy(row: Record<string, string>, rules: ExclusionRule[]): ExclusionRule | undefined {
  for (const rule of rules) {
    const value = cell(row, rule.column);
    const hit =
      rule.op === "equals" ? value === rule.value
      : rule.op === "not_equals" ? value !== rule.value
      : rule.op === "empty" ? value === ""
      : rule.op === "not_empty" ? value !== ""
      : rule.op === "starts_with" ? value.startsWith(rule.value ?? "")
      : !value.startsWith(rule.value ?? "");
    if (hit) return rule;
  }
  return undefined;
}

/** The merchant's own product path, which is a grouping they published rather than one we invented. */
function urlPath(value: string): string | undefined {
  try {
    return new URL(value).pathname;
  } catch {
    return undefined;
  }
}

function groupKeyOf(row: Record<string, string>, profile: MappingProfile): { key: string } | { reason: string } {
  const raw = cell(row, profile.grouping.column);
  if (raw === "") return { reason: `"${profile.grouping.column}" is empty on this row, and it is what rows are grouped by.` };
  if (profile.grouping.mode === "column") return { key: raw };
  const path = urlPath(raw);
  if (!path) return { reason: `"${raw}" is not an address, and this profile groups on the path of one.` };
  return { key: path };
}

const idFrom = (prefix: string, groupKey: string): string | undefined => {
  const tail = slugPart(groupKey.split("/").filter(Boolean).pop() ?? groupKey);
  return tail ? `${prefix}-${tail}` : undefined;
};

const money = (minor: number): string => `$${(minor / 100).toLocaleString("en-US")}`;

export function buildCandidates(
  table: { columns: string[]; rows: Record<string, string>[] },
  profile: MappingProfile,
  source: PartnerSource,
  category: CategoryDefinition,
): BuildOutput {
  const excluded: ExcludedRow[] = [];
  const ungrouped: { row: number; reason: string }[] = [];
  const groups = new Map<string, { rows: Record<string, string>[]; numbers: number[] }>();

  table.rows.forEach((row, i) => {
    const number = i + 2;
    const rule = excludedBy(row, profile.exclusions);
    if (rule) {
      excluded.push({ row: number, column: rule.column, value: cell(row, rule.column), reason: rule.reason });
      return;
    }
    const key = groupKeyOf(row, profile);
    if ("reason" in key) {
      ungrouped.push({ row: number, reason: key.reason });
      return;
    }
    const bucket = groups.get(key.key) ?? { rows: [], numbers: [] };
    bucket.rows.push(row);
    bucket.numbers.push(number);
    groups.set(key.key, bucket);
  });

  const defs = new Map(category.attributeDefinitions.map((d) => [d.key, d]));
  const candidates: Candidate[] = [];
  for (const [groupKey, bucket] of groups) {
    candidates.push(readGroup(groupKey, bucket, profile, source, defs));
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return { candidates, excluded, ungrouped };
}

function readGroup(
  groupKey: string,
  bucket: { rows: Record<string, string>[]; numbers: number[] },
  profile: MappingProfile,
  source: PartnerSource,
  defs: Map<string, AttributeDefinition>,
): Candidate {
  const failures: string[] = [];
  const valueErrors: ValueError[] = [];
  const fields: Record<string, unknown> = {};
  const notes: Record<string, string> = {};
  const meta: Record<string, FieldMeta> = {};
  const extractions: Extraction[] = [];

  const id = idFrom(source.idPrefix, groupKey) ?? `${source.idPrefix}-unnamed`;
  if (!idFrom(source.idPrefix, groupKey)) {
    failures.push(`"${groupKey}" carries no letters or digits, so no record id can be derived from it.`);
  }

  // Which row this record is built from. The cheapest configuration is an
  // editorial choice and it is written into the note rather than left implicit.
  const priceMap = mappingFor(profile, "price");
  const priced = priceMap
    ? bucket.rows.map((r, i) => ({ row: r, i, price: readPrice(cell(r, priceMap.column), source.priceCurrency) })).filter((x) => x.price.ok === true)
    : [];
  let chosen = 0;
  if (profile.grouping.representative === "cheapest" && priced.length > 0) {
    chosen = priced.reduce((a, b) => ((b.price as { minor: number }).minor < (a.price as { minor: number }).minor ? b : a)).i;
  }
  const row = bucket.rows[chosen];

  const amounts = priced.map((p) => (p.price as { minor: number }).minor);
  const groupNote =
    bucket.rows.length === 1
      ? "One row in this file."
      : profile.grouping.representative === "cheapest" && amounts.length > 0
        ? `Chosen from ${bucket.rows.length} rows sharing ${groupKey}, ranging ${money(Math.min(...amounts))} to ${money(Math.max(...amounts))}. The cheapest is the one represented, named as the file names it, and its own link is the link on this record.`
        : `Chosen from ${bucket.rows.length} rows sharing ${groupKey}: the first of them.`;

  const put = (key: string, label: string, ownership: FieldOwnership, provenance: FieldMeta["provenance"], value: unknown, note?: string): void => {
    fields[key] = value;
    meta[key] = { label, ownership, provenance };
    if (note) notes[key] = note;
  };

  for (const target of ["name", "description", "link", "merchant_sku", "mpn", "image"] as CanonicalTarget[]) {
    const map = mappingFor(profile, target);
    if (!map) continue;
    const value = cell(row, map.column);
    if (value === "") {
      if (targetInfo(target).required) failures.push(`${targetInfo(target).label} is empty on the row this record is built from.`);
      continue;
    }
    put(target, targetInfo(target).label, map.ownership, "direct", value);
  }

  const brandMap = mappingFor(profile, "brand");
  const stated = brandMap ? cell(row, brandMap.column) : "";
  const brandName = stated !== "" ? stated : source.defaultBrand;
  const brandId = slugPart(brandName);
  if (!brandId) failures.push(`"${brandName}" carries no letters or digits, so no brand id can be derived from it.`);
  else {
    put(
      "brand",
      "Brand",
      brandMap?.ownership ?? "editorial",
      brandMap && stated !== "" ? "direct" : "stated",
      brandId,
      stated === "" ? `The file states no brand on this row. Recorded as ${source.defaultBrand}, which is this source's stated default and a person's statement rather than a reading.` : undefined,
    );
  }

  if (priceMap) {
    const read = readPrice(cell(row, priceMap.column), source.priceCurrency);
    if (read.ok === true) {
      put("price", "Price", priceMap.ownership, "direct", { minor: read.minor, currency: read.currency }, read.notes.length > 0 ? read.notes.join(" ") : undefined);
    } else if (read.ok === false) {
      valueErrors.push({ id, field: "price", raw: cell(row, priceMap.column), reason: read.reason });
    } else if (source.allowQuoteOnly) {
      put("price", "Price", priceMap.ownership, "stated", { quoteOnly: true }, "This row states no amount. The merchant quotes one, which this source says is how they sell, so the listing carries no price rather than a price of nothing.");
    } else {
      valueErrors.push({ id, field: "price", raw: "", reason: "This row states no price, and this source does not allow quote-only listings. A listing with no amount needs somebody to say the merchant quotes rather than prices." });
    }
  }

  const availabilityMap = mappingFor(profile, "availability");
  if (availabilityMap) {
    const raw = cell(row, availabilityMap.column);
    const read = readAvailability(raw, availabilityMap.valueMap);
    if (read.ok === true) put("availability", "Availability", availabilityMap.ownership, "direct", read.value, read.note);
    else if (read.ok === false) valueErrors.push({ id, field: "availability", raw, reason: read.reason });
  }

  for (const rule of profile.attributes) {
    const def = defs.get(rule.key);
    if (!def) {
      valueErrors.push({ id, field: rule.key, raw: "", reason: `"${rule.key}" is not an attribute this category defines, so nothing was read for it.` });
      continue;
    }
    const raw = cell(row, rule.column);
    if (rule.from === "column") {
      const read = normaliseAttribute(raw, def, rule.valueMap);
      if (read.ok === true) put(`${ATTR_PREFIX}${rule.key}`, def.label, rule.ownership, "direct", read.value, read.note);
      else if (read.ok === false) valueErrors.push({ id, field: rule.key, raw, reason: read.reason });
      continue;
    }
    const extraction = applyExtraction(rule, raw, def);
    extractions.push(extraction);
    // Only an approved rule writes. An unapproved one is shown with its source
    // text, its output and its review state, and it stops there.
    if (extraction.reviewState === "approved" && extraction.value !== undefined) {
      put(`${ATTR_PREFIX}${rule.key}`, def.label, rule.ownership, "extracted", extraction.value, extractionNote(extraction));
    } else if (extraction.reviewState === "refused") {
      valueErrors.push({ id, field: rule.key, raw: extraction.matchedText ?? raw, reason: extraction.notes.join(" ") });
    }
  }

  if (fields.link !== undefined && source.affiliate.linkPrefix && !String(fields.link).startsWith(source.affiliate.linkPrefix)) {
    failures.push(
      `The link on this row does not start with ${source.affiliate.linkPrefix}, which is what this source's issued links start with. No link is composed here, so the row is refused rather than linked to something nobody issued.`,
    );
  }

  return { id, groupKey, brandName, rows: bucket.numbers, representativeRow: bucket.numbers[chosen], fields, notes, meta, extractions, valueErrors, failures, groupNote };
}
