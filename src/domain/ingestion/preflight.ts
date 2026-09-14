/**
 * Everything an administrator sees before a single draft is written.
 *
 * The order matters, because it is the order the questions get harder in. What
 * is in this file. What the profile throws away and why. Which of the
 * category's filters this mapping can actually fill, which is the question that
 * decides whether the import is worth doing at all: a sauna record with a price
 * and a picture and nothing else answers not one of the five filters a shopper
 * would use. Then what could not be read, what was extracted rather than
 * stated, and finally what would happen to each record if this were approved.
 *
 * Nothing here writes. It is a report, and the import that follows it runs the
 * same code again rather than acting on a plan it was handed: a report a person
 * looked at ten minutes ago is not a promise about the file on disk now.
 */

import type { AttributeDefinition } from "@/domain/attributes";
import type { CategoryDefinition } from "@/domain/category";
import { differencesBetween } from "@/domain/intake/plan";
import type { Brand, Product } from "@/domain/product";
import { ATTR_PREFIX, buildCandidates, type BuildOutput, type Candidate, type ExcludedRow, type ValueError } from "./build";
import type { Extraction } from "./extract";
import { mergeRecord, withdrawnRecords, type FieldOutcome, type RecordAction } from "./merge";
import { checkProfile, isApproved, mappingFor, type MappingProfile, type PartnerSource, type ProfileProblem } from "./profile";
import { fieldsFromProduct, productFromFields, type RecordFields } from "./record";
import type { SourceTable } from "./adapter";

export type ColumnReport = {
  name: string;
  populated: number;
  total: number;
  samples: string[];
  /** What the profile does with it, in the words the tool shows. */
  usedFor: string[];
};

export type FilterCoverage = {
  key: string;
  label: string;
  kind: string;
  covered: "price" | "direct" | "extracted" | "unmapped";
  /** How many records this import would give a value for. Coverage is not filled by mapping alone. */
  withValue: number;
  of: number;
  note: string;
};

export type RecordPlan = {
  id: string;
  name: string;
  action: RecordAction;
  rows: number[];
  representativeRow: number;
  groupNote: string;
  outcomes: FieldOutcome[];
  /** Top-level `Product` keys that would move, by the same comparison the intake planner uses. */
  productDifferences: string[];
  failures: string[];
  valueErrors: ValueError[];
  extractions: Extraction[];
  /** The catalogue already holds this id. The workspace copy shadows it and never touches it. */
  shadowsCatalog: boolean;
  merged: RecordFields;
  mergedNotes: Record<string, string>;
  product?: Product;
  brand?: Brand;
};

export type ComparisonFamily = {
  /** The record a shopper is offered. */
  id: string;
  name: string;
  /** The configurations it stands for, each still a record of its own. */
  members: { id: string; name: string; because: string }[];
};

export type Preflight = {
  sourceId: string;
  sourceName: string;
  profileVersion: number;
  profileApproved: boolean;
  fileName: string;
  rows: number;
  truncated: number;
  readerNotes: string[];
  problems: ProfileProblem[];
  columns: ColumnReport[];
  excluded: ExcludedRow[];
  ungrouped: { row: number; reason: string }[];
  filterCoverage: FilterCoverage[];
  valueErrors: ValueError[];
  extractions: Extraction[];
  plans: RecordPlan[];
  /**
   * One per source page, and one per thing a shopper chooses between. They are
   * different numbers on purpose: every page is kept as a record, and the
   * editorial family layer decides how many of them are comparable models.
   */
  sourceRecords: number;
  comparisonFamilies: ComparisonFamily[];
  withdrawn: string[];
  counts: Record<RecordAction, number>;
  lastSuccessfulRefresh?: string;
  stalenessDays?: number;
  /** Whether the import command would do anything, and what stops it. */
  blockers: string[];
};

export type PreflightInput = {
  table: SourceTable;
  profile: MappingProfile;
  source: PartnerSource;
  category: CategoryDefinition;
  fileName: string;
  today: string;
  /** Records already in the ingestion workspace, by id. */
  workspace: Map<string, Product>;
  /** Ids the live catalogue already holds, so a shadowed id is said out loud. */
  catalogIds: Set<string>;
  /** The fields the last import of this source wrote, by record id. */
  snapshot: Record<string, RecordFields>;
  lastSuccessfulRefresh?: string;
};

const SAMPLES = 3;

function columnReports(table: SourceTable, profile: MappingProfile): ColumnReport[] {
  return table.columns.map((name) => {
    const values = table.rows.map((r) => (r[name] ?? "").trim());
    const populated = values.filter((v) => v !== "").length;
    const usedFor: string[] = [];
    for (const c of profile.columns) if (c.column === name) usedFor.push(c.target);
    for (const a of profile.attributes) if (a.column === name) usedFor.push(`${a.key} (${a.from === "extract" ? "extracted" : "direct"})`);
    for (const e of profile.exclusions) if (e.column === name) usedFor.push(`exclusion: ${e.op}`);
    if (profile.grouping.column === name) usedFor.push(`grouping: ${profile.grouping.mode}`);
    return { name, populated, total: values.length, samples: [...new Set(values.filter((v) => v !== ""))].slice(0, SAMPLES), usedFor };
  });
}

function coverage(category: CategoryDefinition, profile: MappingProfile, plans: { merged: RecordFields }[]): FilterCoverage[] {
  const defs = new Map(category.attributeDefinitions.map((d) => [d.key, d]));
  return category.filters.map((filter) => {
    const of = plans.length;
    if (filter.key === "price") {
      const mapped = mappingFor(profile, "price") !== undefined;
      const withValue = plans.filter((p) => {
        const price = p.merged.price as { minor?: number } | undefined;
        return price !== undefined && price.minor !== undefined;
      }).length;
      return {
        key: filter.key,
        label: filter.label,
        kind: filter.kind,
        covered: mapped ? "price" : "unmapped",
        withValue,
        of,
        note: mapped
          ? "Filled from the mapped price column. A quote-only listing carries no amount and is outside every price filter, which is what a listing with no stated price is."
          : "No price column is mapped, so no record this import writes can answer a price filter.",
      };
    }
    const rule = profile.attributes.find((a) => a.key === filter.key);
    const def = defs.get(filter.key);
    const withValue = plans.filter((p) => p.merged[`${ATTR_PREFIX}${filter.key}`] !== undefined).length;
    if (!rule) {
      return {
        key: filter.key,
        label: filter.label,
        kind: filter.kind,
        covered: "unmapped",
        withValue,
        of,
        note: `Nothing in this profile fills ${filter.key}. Every record this import writes is invisible to this filter, and a shopper using it will not see them. ${def ? `The category stores ${def.type}${def.unit ? ` in ${def.unit}` : ""}.` : ""}`.trim(),
      };
    }
    const approvedExtract = rule.from === "extract" && rule.approved;
    return {
      key: filter.key,
      label: filter.label,
      kind: filter.kind,
      covered: rule.from === "column" ? "direct" : "extracted",
      withValue,
      of,
      note:
        rule.from === "column"
          ? `Filled directly from "${rule.column}".`
          : approvedExtract
            ? `Filled by an approved extraction rule over "${rule.column}". A value read out of text is a reading of what a partner wrote, not a specification they published as one.`
            : `An extraction rule over "${rule.column}" proposes values and nobody has approved it, so nothing is written and this filter stays empty.`,
    };
  });
}

/**
 * The records a shopper would be offered, each with the configurations it
 * stands for.
 *
 * Read off the merged fields rather than off the assembled products, so a
 * record that failed to build still shows where it belongs and a family does
 * not silently gain a member when a build starts succeeding.
 */
function comparisonFamilies(plans: RecordPlan[]): ComparisonFamily[] {
  const nameOf = new Map(plans.map((p) => [p.id, p.name]));
  const members = new Map<string, { id: string; name: string; because: string }[]>();
  const heads: RecordPlan[] = [];
  for (const p of plans) {
    const family = p.merged.family as { of: string; because: string } | undefined;
    if (family && family.of !== p.id && nameOf.has(family.of)) {
      members.set(family.of, [...(members.get(family.of) ?? []), { id: p.id, name: p.name, because: family.because }]);
    } else {
      heads.push(p);
    }
  }
  return heads
    .map((h) => ({ id: h.id, name: h.name, members: (members.get(h.id) ?? []).sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function preflight(input: PreflightInput): Preflight {
  const { table, profile, source, category, today, snapshot } = input;
  const attributeKeys = category.attributeDefinitions.map((d) => d.key);
  const problems = checkProfile(profile, table.columns, attributeKeys);
  const built: BuildOutput = buildCandidates(table, profile, source, category);
  const defs = new Map(category.attributeDefinitions.map((d) => [d.key, d]));

  const plans: RecordPlan[] = built.candidates.map((candidate) => plan(candidate, input, defs));
  const families = comparisonFamilies(plans);
  const counts: Record<RecordAction, number> = { added: 0, changed: 0, conflict: 0, review: 0, unchanged: 0, failed: 0 };
  for (const p of plans) counts[p.action] += 1;

  const blockers: string[] = [];
  if (!isApproved(profile)) blockers.push(`Mapping profile v${profile.version} has not been approved. Approving a mapping and importing drafts are two decisions, and this is the first.`);
  if (problems.length > 0) blockers.push(`The profile does not fit this file: ${problems.length} ${problems.length === 1 ? "problem" : "problems"} listed above.`);
  if (plans.filter((p) => p.product !== undefined).length === 0) blockers.push("No record in this file can be built, so an import would write nothing.");

  return {
    sourceId: source.id,
    sourceName: source.name,
    profileVersion: profile.version,
    profileApproved: isApproved(profile),
    fileName: input.fileName,
    rows: table.rows.length,
    truncated: table.truncated,
    readerNotes: table.notes,
    problems: [...problems, ...built.familyProblems],
    columns: columnReports(table, profile),
    excluded: built.excluded,
    ungrouped: built.ungrouped,
    filterCoverage: coverage(category, profile, plans),
    valueErrors: plans.flatMap((p) => p.valueErrors),
    extractions: plans.flatMap((p) => p.extractions),
    plans,
    sourceRecords: plans.length,
    comparisonFamilies: families,
    withdrawn: withdrawnRecords(Object.keys(snapshot), plans.map((p) => p.id)),
    counts,
    lastSuccessfulRefresh: input.lastSuccessfulRefresh,
    stalenessDays: input.lastSuccessfulRefresh ? daysBetween(input.lastSuccessfulRefresh, today) : undefined,
    blockers,
  };
}

function plan(candidate: Candidate, input: PreflightInput, defs: Map<string, AttributeDefinition>): RecordPlan {
  const { source, profile, fileName, today, workspace, catalogIds, snapshot } = input;
  const existing = workspace.get(candidate.id);
  const current = existing ? fieldsFromProduct(existing, source.merchantId) : undefined;
  const merged = mergeRecord({
    incoming: candidate.fields,
    incomingNotes: candidate.notes,
    meta: candidate.meta,
    current,
    last: snapshot[candidate.id],
  });

  const base: RecordPlan = {
    id: candidate.id,
    name: String(candidate.fields.name ?? existing?.name ?? candidate.id),
    action: merged.action,
    rows: candidate.rows,
    representativeRow: candidate.representativeRow,
    groupNote: candidate.groupNote,
    outcomes: merged.outcomes,
    productDifferences: [],
    failures: candidate.failures,
    valueErrors: candidate.valueErrors,
    extractions: candidate.extractions,
    shadowsCatalog: catalogIds.has(candidate.id) && !workspace.has(candidate.id),
    merged: merged.fields,
    mergedNotes: merged.notes,
  };
  if (candidate.failures.length > 0) return { ...base, action: "failed" };

  const assembled = productFromFields(candidate.id, merged.fields, merged.notes, merged.outcomes, {
    source,
    profileVersion: profile.version,
    fileName,
    readOn: today,
    groupNote: candidate.groupNote,
    brandName: candidate.brandName,
    defs,
  });
  if (!assembled.ok) return { ...base, action: "failed", failures: assembled.reasons };

  return {
    ...base,
    product: assembled.product,
    brand: assembled.brand,
    // The same comparison the intake planner uses, so a reviewer sees the
    // record-level move as well as the field-level one. `source` moves on every
    // import because its note says what this import did, which is why the
    // action above is decided by the field outcomes and not by this list.
    productDifferences: existing ? differencesBetween(existing, assembled.product) : [],
  };
}
