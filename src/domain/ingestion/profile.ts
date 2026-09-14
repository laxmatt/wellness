/**
 * What an administrator decided about one partner's file, written down.
 *
 * A mapping profile is the whole of the configuration: which source this is,
 * which column means which catalogue field, which rows are not products, which
 * of the category's approved attributes a column or an extraction rule fills,
 * and who owns each field when the same file arrives again next month.
 *
 * Three rules shape every type here.
 *
 * **A profile is a version, not a setting.** Saving writes a new numbered
 * version beside the old ones; nothing is edited in place. An import records
 * which version built it, so a record that turns out wrong names the decision
 * that produced it rather than whatever the profile happens to say today.
 *
 * **Approval is separate from use.** A saved version is a draft of a decision.
 * `approvedOn` is set by its own command, and an import refuses a version
 * nobody approved. Approving a mapping, importing drafts, reviewing listings
 * and publishing are four decisions and this file is only the first.
 *
 * **A profile cannot change the category.** Every attribute it fills has to be
 * one the category already defines. An administrator who wants a filter the
 * category does not have records the idea in `proposedFilters`, which is read
 * by people and by nothing else: a category schema is changed by editing the
 * category, in a commit somebody reviews.
 */

import { z } from "zod";
import { Id } from "@/domain/product";

/**
 * Formats this flow will accept, and the one it reads today.
 *
 * The others are named so an unsupported upload is refused by name rather than
 * mis-parsed, and so the adapter boundary has something to dispatch on. Naming
 * a format is not implementing it: see `adapter.ts`.
 */
export const SourceFormat = z.enum(["csv", "xlsx", "xml", "json", "api"]);
export type SourceFormat = z.infer<typeof SourceFormat>;

/**
 * Who owns a field between two imports.
 *
 * `feed` the partner's file decides, and a later file may change it.
 * `editorial` this site decides, and no file ever changes it.
 * `review_on_change` the file may propose a change and a person applies it.
 *
 * The default for anything a person would write is `review_on_change`, because
 * the failure this prevents is silent: a partner re-titles a product, an
 * overnight refresh takes the new title, and the editorial name somebody chose
 * is gone with no record that it was ever there.
 */
export const FieldOwnership = z.enum(["feed", "editorial", "review_on_change"]);
export type FieldOwnership = z.infer<typeof FieldOwnership>;

/** The canonical fields of the product model a source column can reach. */
export const CanonicalTarget = z.enum([
  "name",
  "description",
  "brand",
  "price",
  "availability",
  "image",
  "link",
  "merchant_sku",
  "mpn",
]);
export type CanonicalTarget = z.infer<typeof CanonicalTarget>;

export type TargetInfo = {
  target: CanonicalTarget;
  label: string;
  /** Where the value lands in a `Product`, for somebody checking the result. */
  catalogPath: string;
  required: boolean;
  note: string;
};

export const CANONICAL_TARGETS: TargetInfo[] = [
  { target: "name", label: "Product name", catalogPath: "name", required: true, note: "The partner's own title. A title is not a specification and nothing is read out of it unless an extraction rule says so and a person approves it." },
  { target: "description", label: "Description", catalogPath: "description", required: true, note: "Kept whole. Prose is not parsed into facts here." },
  { target: "brand", label: "Brand", catalogPath: "brandId", required: false, note: "A brand id is derived from this value. Where the file has no brand column the source's default brand is used, and that is a person's statement rather than a reading." },
  { target: "price", label: "Price", catalogPath: "offers[0].priceMinor with currency", required: false, note: "Read by the same money rules as everything else: a symbol is not a currency, and an amount with no stated currency is not a price." },
  { target: "availability", label: "Availability", catalogPath: "offers[0].availability", required: false, note: "The partner's own machine-readable claim, normalised against this site's values or refused. Prose beside it is never resolved against it." },
  { target: "image", label: "Image", catalogPath: "images[0].src", required: false, note: "Recorded with no licence. A feed carrying an image is not a grant to publish it." },
  { target: "link", label: "Merchant link", catalogPath: "offers[0].url", required: true, note: "The link the partner issued, verbatim. No tracking link is ever composed here." },
  { target: "merchant_sku", label: "Merchant SKU", catalogPath: "identifiers.merchantSkus[merchant]", required: false, note: "The partner's code for their own line. Kept for tracing, never used as our id." },
  { target: "mpn", label: "Manufacturer part number", catalogPath: "identifiers.mpn", required: false, note: "The maker's part number where the partner states one." },
];

export const targetInfo = (target: CanonicalTarget): TargetInfo => CANONICAL_TARGETS.find((t) => t.target === target)!;

/**
 * An explicit translation of a partner's vocabulary into this site's.
 *
 * Written out, pair by pair, by a person. There is no fuzzy matching anywhere
 * in this flow: deciding that "In Stock" means `in_stock` is a translation
 * somebody makes once and can be shown; deciding that "Ships in 5 weeks"
 * means `backorder` is a judgement, and it is the same judgement whether a
 * person types it into this table or a regular expression guesses at it.
 */
export const ValueMap = z.record(z.string(), z.string());
export type ValueMap = z.infer<typeof ValueMap>;

export const ColumnMapping = z.object({
  target: CanonicalTarget,
  column: z.string().min(1),
  ownership: FieldOwnership.default("review_on_change"),
  /** For availability, and for anything else whose vocabulary differs from ours. */
  valueMap: ValueMap.optional(),
});
export type ColumnMapping = z.infer<typeof ColumnMapping>;

/** A pattern is small, and a large one is a mistake rather than a mapping. */
export const MAX_PATTERN_CHARS = 200;

/**
 * How one of the category's attributes gets filled.
 *
 * `column` is a whole cell, normalised against the attribute's own definition.
 * `extract` runs a pattern over a cell and takes its one capture group. The
 * second is the dangerous one, so it carries `approved` and nothing unapproved
 * is ever written: see `extract.ts` for what the administrator is shown before
 * approving.
 */
export const AttributeRule = z.discriminatedUnion("from", [
  z.object({
    from: z.literal("column"),
    key: z.string().min(1),
    column: z.string().min(1),
    ownership: FieldOwnership.default("review_on_change"),
    valueMap: ValueMap.optional(),
  }),
  z.object({
    from: z.literal("extract"),
    key: z.string().min(1),
    column: z.string().min(1),
    /** One capture group, and it is the value. */
    pattern: z.string().min(1).max(MAX_PATTERN_CHARS),
    flags: z.string().regex(/^[ims]*$/).default("i"),
    valueMap: ValueMap.optional(),
    ownership: FieldOwnership.default("review_on_change"),
    /** Set by a person who has seen the source text, the output and the review state. */
    approved: z.boolean().default(false),
    approvedBy: z.string().min(1).optional(),
  }),
]);
export type AttributeRule = z.infer<typeof AttributeRule>;

/** A row that is not a product of ours, named by a condition on a column. */
export const ExclusionRule = z.object({
  column: z.string().min(1),
  op: z.enum(["equals", "not_equals", "empty", "not_empty", "starts_with", "not_starts_with"]),
  value: z.string().optional(),
  /** Why, in a person's words. It appears beside every row this drops. */
  reason: z.string().min(1),
});
export type ExclusionRule = z.infer<typeof ExclusionRule>;

/**
 * How many rows make one product.
 *
 * A feed of 225 rows is not 225 products when the merchant sells one cabin in
 * eighteen configurations. The grouping is stated rather than inferred:
 * `column` groups on an exact cell value, `url_path` on the path of a URL in a
 * column, which is the merchant's own product page and so the merchant's own
 * grouping rather than ours.
 */
export const Grouping = z.object({
  mode: z.enum(["column", "url_path"]),
  column: z.string().min(1),
  /** Which row in a group the record is built from. `cheapest` needs a price mapping. */
  representative: z.enum(["first", "cheapest"]).default("cheapest"),
});
export type Grouping = z.infer<typeof Grouping>;

/**
 * One source record that is a configuration of another, not a model of its own.
 *
 * Sweat Kingdom sells The Sweat Cabin on one page and the same cabin in a
 * blackout finish on another. Both pages are kept, with their own price, stock,
 * pictures and issued link; only one of them is a thing a shopper chooses
 * between. Which is which is a judgement about the products, so it is written
 * down here as a pair of record ids and a reason, saved in a version, and
 * approved with the rest of the mapping.
 *
 * Deliberately not a pattern, a prefix or a similarity score. A heuristic over
 * titles would fold "Blackout Edition" into its family correctly and fold two
 * genuinely different saunas together on the day their names happened to agree,
 * and nobody would see that happen. Two lines of configuration are cheaper than
 * a rule nobody can audit.
 *
 * Partner-specific by construction: these ids are this source's records, and
 * this profile belongs to this source.
 */
export const FamilyRule = z.object({
  /** The record that is a configuration. Its derived record id, not a title. */
  member: Id,
  /** The record it is compared as. */
  family: Id,
  /** Why. Shown in review and written onto the record. */
  because: z.string().min(1),
});
export type FamilyRule = z.infer<typeof FamilyRule>;

export type FamilyProblem = { where: string; message: string };

/**
 * Everything wrong with a set of family rules that can be seen without a file.
 *
 * Self-reference, a record claimed by two families, and a chain. The fourth
 * failure, naming a record this file does not produce, needs the file and is
 * checked where the records exist.
 *
 * Refusing chains is what refuses cycles. A cycle is a chain that closes, so a
 * rule set where no representative is itself a member cannot contain one, and
 * there is no graph to walk looking for something a walk might miss.
 */
export function checkFamilyRules(rules: FamilyRule[]): FamilyProblem[] {
  const problems: FamilyProblem[] = [];
  const members = new Set<string>();
  for (const [i, rule] of rules.entries()) {
    const where = `families[${i}]`;
    if (rule.member === rule.family) {
      problems.push({ where, message: `"${rule.member}" is given as a configuration of itself.` });
      continue;
    }
    if (members.has(rule.member)) {
      problems.push({ where, message: `"${rule.member}" is already a configuration of another record. One record belongs to one family.` });
      continue;
    }
    members.add(rule.member);
  }
  for (const [i, rule] of rules.entries()) {
    if (members.has(rule.family) && rule.member !== rule.family) {
      const parent = rules.find((r) => r.member === rule.family)!;
      problems.push({
        where: `families[${i}]`,
        message: `"${rule.member}" is given as a configuration of "${rule.family}", which is itself a configuration of "${parent.family}". A family is one level deep: point this at "${parent.family}", or decide that "${rule.family}" is a model of its own.`,
      });
    }
  }
  return problems;
}

/**
 * A filter an administrator wants and the category does not have.
 *
 * Recorded and never applied. Adding a filter changes what the site compares
 * products on, which is a schema change in a commit, not a side effect of
 * somebody mapping a spreadsheet.
 */
export const ProposedFilter = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  reason: z.string().min(1),
  proposedBy: z.string().min(1),
});
export type ProposedFilter = z.infer<typeof ProposedFilter>;

/**
 * A partner and the shape of what they send.
 *
 * Nothing here holds a credential and nothing here holds an address a
 * credential is embedded in. The feed this flow was built against is fetched
 * from a URL carrying an API key; that URL is not recorded, here or anywhere,
 * and `IngestionStore` refuses an upload that looks like it carries one.
 */
export const PartnerSource = z.object({
  id: Id,
  name: z.string().min(1),
  format: SourceFormat,
  /** The merchant record these offers belong to. */
  merchantId: Id,
  merchantName: z.string().min(1),
  merchantWebsite: z.url().optional(),
  categoryId: Id,
  /**
   * Whether this partner is the maker or a shop.
   *
   * It decides how a specification from this file is attributed. A maker
   * publishing its own feed is the maker speaking; a shop's feed relaying a
   * maker's specification is the maker's claim reaching us through somebody
   * else, and this catalogue already draws that distinction and renders it as
   * "Via retailer". `catalog.test.ts` refuses a record that says a maker's
   * claim was read direct from anywhere but the maker.
   */
  relationship: z.enum(["manufacturer", "retailer"]),
  /**
   * The currency this partner's prices are in, where the file states none.
   *
   * A person's statement, recorded as one, and it never overrules a currency
   * the file does state: where the two disagree nothing is read. This
   * catalogue stores USD, so anything else is refused rather than converted.
   */
  priceCurrency: z.string().length(3).optional(),
  /** Record ids are this, then the grouping key. Never anything read out of a cell. */
  idPrefix: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** Used when the file states no brand. A person's statement, recorded as one. */
  defaultBrand: z.string().min(1),
  /**
   * What this partner's links are. `affiliate` needs a network and a programme
   * reference, because a link that pays is a thing somebody arranged and can
   * name. Nothing here turns a plain link into a tracking one.
   */
  affiliate: z.object({
    status: z.enum(["affiliate", "non_affiliate", "unknown"]),
    network: z.enum(["awin", "impact", "cj", "amazon", "direct", "other"]).optional(),
    programRef: z.string().min(1).optional(),
    /** A link that does not start with this is not the issued link, and the row is refused. */
    linkPrefix: z.string().min(1).optional(),
  }),
  /** A merchant who quotes rather than prices still sells the thing. */
  allowQuoteOnly: z.boolean().default(false),
  notes: z.string().default(""),
}).refine((s) => s.affiliate.status !== "affiliate" || (s.affiliate.network !== undefined && s.affiliate.programRef !== undefined), {
  message: "An affiliate link belongs to a named network and a programme reference. Without both there is nothing to check the claim against.",
});
export type PartnerSource = z.infer<typeof PartnerSource>;

export const MappingProfile = z.object({
  sourceId: Id,
  version: z.number().int().positive(),
  format: SourceFormat,
  createdOn: z.iso.date(),
  createdBy: z.string().min(1),
  note: z.string().default(""),
  /** The headings this version was built against, so a later file that lost a column says so. */
  columnsSeen: z.array(z.string()).default([]),
  grouping: Grouping,
  columns: z.array(ColumnMapping).default([]),
  attributes: z.array(AttributeRule).default([]),
  exclusions: z.array(ExclusionRule).default([]),
  /** Records that are configurations of other records, for comparison. Editorial, and explicit. */
  families: z.array(FamilyRule).default([]),
  proposedFilters: z.array(ProposedFilter).default([]),
  approvedOn: z.iso.date().optional(),
  approvedBy: z.string().min(1).optional(),
});
export type MappingProfile = z.infer<typeof MappingProfile>;

export const isApproved = (p: MappingProfile): boolean => p.approvedOn !== undefined && p.approvedBy !== undefined;

/** The mapping for one canonical field, or nothing. */
export const mappingFor = (p: MappingProfile, target: CanonicalTarget): ColumnMapping | undefined => p.columns.find((c) => c.target === target);

/** The rule filling one attribute, or nothing. One rule per attribute: two would be two claims. */
export const ruleFor = (p: MappingProfile, key: string): AttributeRule | undefined => p.attributes.find((a) => a.key === key);

export type ProfileProblem = { where: string; message: string };

/**
 * Everything wrong with a profile, said at once.
 *
 * Checked against the file's actual headings and the category's actual
 * attribute definitions, because those are the two things a profile can be
 * wrong about in a way nothing downstream would notice: a column that is not
 * there reads as empty, and an attribute the category does not define is a
 * value no screen will ever show.
 */
export function checkProfile(
  profile: MappingProfile,
  columns: string[],
  attributeKeys: string[],
): ProfileProblem[] {
  const problems: ProfileProblem[] = [];
  const has = (c: string): boolean => columns.includes(c);

  if (!has(profile.grouping.column)) {
    problems.push({ where: "grouping", message: `The grouping uses "${profile.grouping.column}" and this file has no such column. Without it every row is its own product.` });
  }
  if (profile.grouping.representative === "cheapest" && !mappingFor(profile, "price")) {
    problems.push({ where: "grouping", message: "Representing a group by its cheapest row needs a price mapping, and there is none. Map a price column, or represent the group by its first row." });
  }

  const seen = new Set<CanonicalTarget>();
  for (const c of profile.columns) {
    if (seen.has(c.target)) problems.push({ where: `columns.${c.target}`, message: `Two columns are mapped to ${targetInfo(c.target).label}. A field takes one column: two are two different claims about the same thing.` });
    seen.add(c.target);
    if (!has(c.column)) problems.push({ where: `columns.${c.target}`, message: `"${c.column}" is not a column in this file.` });
  }
  for (const t of CANONICAL_TARGETS.filter((t) => t.required)) {
    if (!seen.has(t.target)) problems.push({ where: `columns.${t.target}`, message: `${t.label} has no column, and a record cannot be built without one.` });
  }

  const keys = new Set<string>();
  for (const a of profile.attributes) {
    if (keys.has(a.key)) problems.push({ where: `attributes.${a.key}`, message: `Two rules fill "${a.key}". One attribute takes one rule.` });
    keys.add(a.key);
    if (!attributeKeys.includes(a.key)) {
      problems.push({ where: `attributes.${a.key}`, message: `"${a.key}" is not an attribute this category defines. A profile fills the category's approved attributes and never adds one. Record the idea under proposed filters instead.` });
    }
    if (!has(a.column)) problems.push({ where: `attributes.${a.key}`, message: `"${a.column}" is not a column in this file.` });
    if (a.from === "extract") {
      const compiled = compilePattern(a.pattern, a.flags);
      if (!compiled.ok) problems.push({ where: `attributes.${a.key}`, message: compiled.reason });
    }
  }

  for (const [i, e] of profile.exclusions.entries()) {
    if (!has(e.column)) problems.push({ where: `exclusions[${i}]`, message: `"${e.column}" is not a column in this file.` });
    const needsValue = e.op === "equals" || e.op === "not_equals" || e.op === "starts_with" || e.op === "not_starts_with";
    if (needsValue && (e.value ?? "") === "") problems.push({ where: `exclusions[${i}]`, message: `"${e.op}" needs a value to compare against.` });
  }

  problems.push(...checkFamilyRules(profile.families));

  const missing = profile.columnsSeen.filter((c) => !has(c));
  if (missing.length > 0) {
    problems.push({ where: "file", message: `This file is missing ${missing.length} ${missing.length === 1 ? "column" : "columns"} the profile was built against: ${missing.join(", ")}. A column that is not there reads as empty, which is why this is said rather than left to be discovered.` });
  }

  return problems;
}

/**
 * A pattern, compiled, or the reason it was refused.
 *
 * Two refusals. A pattern has exactly one capture group, because the value is
 * that group and "the first of three" is a rule nobody would remember. And a
 * quantifier applied to a group that is itself quantified is refused, because
 * that is the shape that takes exponential time on a string that nearly
 * matches, and this runs patterns an administrator typed against cells a
 * partner sent.
 *
 * The second check is a guard and not a proof. JavaScript gives a regular
 * expression no time limit, so a determined pattern can still hang the tool it
 * runs in. That tool is a local one, the person who typed the pattern is the
 * person it would hang, and the cells are capped at 2,000 characters by the
 * reader. A pattern language with a cost model is the real answer and it is not
 * this.
 */
export function compilePattern(pattern: string, flags: string): { ok: true; regex: RegExp } | { ok: false; reason: string } {
  if (pattern.length > MAX_PATTERN_CHARS) return { ok: false, reason: `A pattern is at most ${MAX_PATTERN_CHARS} characters. This one is ${pattern.length}.` };
  if (/\([^)]*[+*]\)\s*[+*{]/.test(pattern)) {
    return { ok: false, reason: "This pattern repeats a group that already repeats, which is the shape that takes exponential time on text that nearly matches. Rewrite it without the nested repetition." };
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (e) {
    return { ok: false, reason: `This is not a pattern: ${e instanceof Error ? e.message : String(e)}` };
  }
  // Counted by compiling a pattern that can never match: the resulting match
  // array is one longer than the number of capture groups.
  let groups: number;
  try {
    groups = new RegExp(`${pattern}|`).exec("")!.length - 1;
  } catch {
    groups = 0;
  }
  if (groups !== 1) {
    return { ok: false, reason: `A pattern has exactly one capture group, and the value is what it captures. This one has ${groups}.` };
  }
  return { ok: true, regex };
}

/** The next version number for a source, given the versions already saved. */
export const nextVersion = (existing: MappingProfile[]): number => existing.reduce((n, p) => Math.max(n, p.version), 0) + 1;
