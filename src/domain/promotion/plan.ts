/**
 * What promoting some drafts into the catalogue would do, worked out and
 * written down, without doing any of it.
 *
 * This is a planner and not a publisher. It reads the ingestion workspace and
 * the catalogue, assembles the catalogue that would exist if a reviewer's
 * choices were carried out, validates that hypothetical catalogue, and reports.
 * It writes one thing: a signed plan, in the workspace, which is a record of a
 * decision rather than the decision being carried out. `catalog/` is never
 * touched by anything in this file, and there is no code here that could touch
 * it.
 *
 * Four things it refuses to let a reviewer skip.
 *
 * **A family is promoted whole.** The unit of selection is the thing a shopper
 * chooses between, which is a representative and its configurations. Promoting
 * "The Sweat Cabin in blackout" without the cabin it is a finish of would put a
 * record on the site whose own family is not there, which is worse than not
 * promoting it: it reads as a model in its own right, which is precisely what
 * the family layer decided it is not.
 *
 * **A picture needs a permission.** Not a feed entry. See `rights.ts`.
 *
 * **A collision needs an answer.** Five of these ids are in the catalogue
 * already. See `shadow.ts`.
 *
 * **The result has to be a valid catalogue.** The whole hypothetical thing is
 * run through the same validation the real one is, including family integrity,
 * before a plan can be signed.
 *
 * Promotion is still not publication. A promoted record would arrive as a
 * draft, and whether a shopper ever sees it is a decision after this one.
 */

import { createHash } from "node:crypto";
import type { CategoryDefinition } from "@/domain/category";
import { familyIssues, groupIntoFamilies } from "@/domain/family";
import { ATTR_PREFIX } from "@/domain/ingestion/build";
import type { MappingProfile, PartnerSource } from "@/domain/ingestion/profile";
import { fieldsFromProduct } from "@/domain/ingestion/record";
import { formatMoney } from "@/domain/money";
import type { Brand, Merchant, Product } from "@/domain/product";
import { validateCatalog, type LoadedCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { imageRightsFor, rightsBlocked, type ImageRightsRecord, type ImageRightsView } from "./rights";
import { resolutionProblems, resolveShadow, shadowDiff, type Resolved, type ShadowDiff, type ShadowResolution } from "./shadow";

export type BlockerCode =
  | "no_selection"
  | "family_incomplete"
  | "unknown_selection"
  | "shadow_unresolved"
  | "image_rights"
  | "catalogue_invalid"
  | "family_integrity";

export type Blocker = { code: BlockerCode; about: string; message: string };

export type ComparisonField = {
  key: string;
  label: string;
  state: "mapped" | "missing";
  display: string;
  /** Where the value came from, when there is one. */
  verification?: string;
};

export type EditorialChange = { key: string; label: string; here: unknown; lastImport: unknown };
export type OpenConflict = { key: string; label: string; incoming: unknown; current: unknown; last: unknown };

export type RecordReview = {
  id: string;
  name: string;
  role: "representative" | "configuration";
  price: { display: string; minor?: number; currency: string; quoteOnly: boolean; lastChecked: string };
  availability: string;
  image: ImageRightsView;
  link: { url: string; affiliateStatus: string; network?: string; programRef?: string };
  provenance: { kind: string; method: string; ref?: string; retrievedAt?: string; note?: string };
  editorial: { changes: EditorialChange[]; conflicts: OpenConflict[] };
  comparison: ComparisonField[];
  shadowsCatalog: boolean;
};

export type FamilyReview = { id: string; name: string; memberIds: string[]; records: RecordReview[] };

export type ShadowReview = {
  id: string;
  diff: ShadowDiff;
  resolution: ShadowResolution;
  /** What the catalogue would hold under this choice, and what the choice costs. */
  outcome?: Resolved;
  problems: { id: string; message: string }[];
};

export type PlanRequest = {
  /** Representative record ids. A family is selected whole or not at all. */
  familyIds: string[];
  shadows: ShadowResolution[];
  reviewer: string;
};

export type PromotionPlan = {
  /** Which drafts, from which file, read through which mapping. */
  sourceId: string;
  sourceName: string;
  profileVersion: number;
  uploadFile?: string;
  uploadHash?: string;
  lastSuccessfulRefresh?: string;
  builtOn: string;
  reviewer: string;

  /** Both numbers, always. Every source page is a record; the family layer says how many are models. */
  sourceRecords: number;
  comparisonFamilies: number;
  /** Every family, whether selected or not, so a reviewer sees what they did not take. */
  selectable: { id: string; name: string; memberIds: string[]; selected: boolean; shadowIds: string[] }[];

  selectedFamilyIds: string[];
  selectedRecordIds: string[];
  families: FamilyReview[];
  shadows: ShadowReview[];
  rights: ImageRightsView[];

  /** What the catalogue would look like afterwards, checked by the catalogue's own rules. */
  catalogueIssues: string[];
  familyIntegrityIssues: string[];
  hypotheticalProducts: number;
  hypotheticalFamilies: number;

  blockers: Blocker[];
  signable: boolean;
  /** A function of everything above that a reviewer decides. Recomputable, and checked on read. */
  planId: string;
};

export type PlanInput = {
  source: PartnerSource;
  profile: MappingProfile;
  category: CategoryDefinition;
  catalog: LoadedCatalog;
  drafts: Product[];
  /** Brands and merchants the drafts name. They travel with the records that name them. */
  draftBrands: Brand[];
  draftMerchants: Merchant[];
  rights: ImageRightsRecord[];
  state: {
    lastFile?: string;
    lastUploadHash?: string;
    lastSuccessfulRefresh?: string;
    snapshot: Record<string, Record<string, unknown>>;
    conflicts: Record<string, OpenConflict[]>;
  };
  request: PlanRequest;
  today: string;
};

const stable = (v: unknown): string => JSON.stringify(v ?? null);

/**
 * The fields a shopper compares a sauna on, at the level this site compares
 * them: what the category filters on, plus what a card shows.
 *
 * Reported per record and per field, because a family whose representative
 * states a heating type and whose configuration does not is a comparison with
 * a hole in it, and that is worth seeing before promotion rather than after.
 */
function comparisonFields(product: Product, category: CategoryDefinition): ComparisonField[] {
  const keys = [...new Set([...category.filters.map((f) => f.key), ...category.cardSpecKeys])];
  return keys.map((key) => {
    if (key === "price") {
      const offer = product.offers[0];
      const has = offer?.priceMinor !== undefined;
      return {
        key,
        label: "Price",
        state: has ? "mapped" : "missing",
        display: has ? formatMoney({ amountMinor: offer!.priceMinor!, currency: offer!.currency }) : offer?.quoteOnly ? "Quoted, so outside every price filter" : "No price",
      };
    }
    const def = category.attributeDefinitions.find((d) => d.key === key);
    const value = product.attributes[key];
    if (!value || value.value === undefined) {
      return { key, label: def?.label ?? key, state: "missing", display: "Not stated in anything this record was built from" };
    }
    return { key, label: def?.label ?? key, state: "mapped", display: String(value.value), verification: value.verification };
  });
}

/** What somebody changed here since the last import wrote this record. */
function editorialChanges(product: Product, snapshot: Record<string, unknown> | undefined, merchantId: string): EditorialChange[] {
  if (!snapshot) return [];
  const here = fieldsFromProduct(product, merchantId).fields;
  const keys = [...new Set([...Object.keys(here), ...Object.keys(snapshot)])].sort();
  const changes: EditorialChange[] = [];
  for (const key of keys) {
    if (stable(here[key]) === stable(snapshot[key])) continue;
    changes.push({ key, label: key.startsWith(ATTR_PREFIX) ? key.slice(ATTR_PREFIX.length) : key, here: here[key], lastImport: snapshot[key] });
  }
  return changes;
}

function reviewRecord(
  product: Product,
  role: RecordReview["role"],
  input: PlanInput,
  rightsViews: Map<string, ImageRightsView>,
  catalogIds: Set<string>,
): RecordReview {
  const offer = product.offers[0];
  return {
    id: product.id,
    name: product.name,
    role,
    price: {
      display: offer?.priceMinor !== undefined ? formatMoney({ amountMinor: offer.priceMinor, currency: offer.currency }) : "Price on request",
      minor: offer?.priceMinor,
      currency: offer?.currency ?? "USD",
      quoteOnly: offer?.quoteOnly === true,
      lastChecked: offer?.lastChecked ?? product.lastUpdated,
    },
    availability: offer?.availability ?? product.availability,
    image: rightsViews.get(product.id)!,
    link: {
      url: offer?.url ?? "",
      affiliateStatus: offer?.affiliate.status ?? "unknown",
      network: offer?.affiliate.network,
      programRef: offer?.affiliate.programRef,
    },
    provenance: {
      kind: product.source.kind,
      method: product.source.method,
      ref: product.source.ref,
      retrievedAt: product.source.retrievedAt,
      note: product.source.note,
    },
    editorial: {
      changes: editorialChanges(product, input.state.snapshot[product.id], input.source.merchantId),
      conflicts: input.state.conflicts[product.id] ?? [],
    },
    comparison: comparisonFields(product, input.category),
    shadowsCatalog: catalogIds.has(product.id),
  };
}

export function buildPromotionPlan(input: PlanInput): PromotionPlan {
  const { source, profile, catalog, drafts, request, today } = input;
  const catalogById = new Map(catalog.products.map((p) => [p.id, p]));
  const catalogIds = new Set(catalogById.keys());
  const families = groupIntoFamilies(drafts);
  const rightsViews = new Map(drafts.map((p) => [p.id, imageRightsFor(p, input.rights)]));

  const blockers: Blocker[] = [];
  const representativeIds = new Set(families.map((f) => f.representative.id));
  const memberOf = new Map<string, string>();
  for (const family of families) for (const member of family.members) memberOf.set(member.id, family.representative.id);

  // Selection. A family is the unit: an id that is a configuration of something
  // else is refused with the id of the family it belongs to, rather than
  // quietly promoted on its own or quietly widened to include its family.
  const wanted = [...new Set(request.familyIds)];
  const selectedFamilyIds: string[] = [];
  for (const id of wanted) {
    if (representativeIds.has(id)) {
      selectedFamilyIds.push(id);
      continue;
    }
    const family = memberOf.get(id);
    if (family) {
      blockers.push({
        code: "family_incomplete",
        about: id,
        message: `"${id}" is a configuration of "${family}", not a model of its own. Select "${family}" and this comes with it. Promoting a finish without the product it is a finish of puts a record on the site whose own family is not there.`,
      });
      continue;
    }
    blockers.push({ code: "unknown_selection", about: id, message: `"${id}" is not a record in this workspace.` });
  }
  selectedFamilyIds.sort();

  const selectedFamilies = families.filter((f) => selectedFamilyIds.includes(f.representative.id));
  const selectedRecords: { product: Product; role: RecordReview["role"] }[] = selectedFamilies.flatMap((f) => [
    { product: f.representative, role: "representative" as const },
    ...f.members.map((m) => ({ product: m, role: "configuration" as const })),
  ]);
  const selectedRecordIds = selectedRecords.map((r) => r.product.id).sort();
  if (selectedRecordIds.length === 0 && blockers.length === 0) {
    blockers.push({ code: "no_selection", about: "selection", message: "No family is selected, so there is nothing to plan." });
  }

  // Collisions. Only for what is actually selected: an unresolved shadow on a
  // family nobody chose is not this plan's problem.
  const resolutions = new Map(request.shadows.map((r) => [r.id, r]));
  const shadows: ShadowReview[] = [];
  const resolved = new Map<string, Resolved>();
  for (const { product } of selectedRecords) {
    const existing = catalogById.get(product.id);
    if (!existing) continue;
    const diff = shadowDiff(existing, product, profile, source.merchantId);
    const resolution = resolutions.get(product.id) ?? { id: product.id, choice: "unresolved" as const, fields: {}, note: "" };
    const problems = resolutionProblems(diff, resolution);
    const outcome = problems.length === 0 ? resolveShadow(existing, product, diff, resolution, source.merchantId) : undefined;
    if (outcome) resolved.set(product.id, outcome);
    for (const problem of problems) blockers.push({ code: "shadow_unresolved", about: problem.id, message: problem.message });
    shadows.push({ id: product.id, diff, resolution, outcome, problems });
  }

  // Pictures.
  const selectedRights = selectedRecords.map(({ product }) => rightsViews.get(product.id)!);
  for (const view of rightsBlocked(selectedRights)) {
    blockers.push({ code: "image_rights", about: view.recordId, message: `${view.recordId}: ${view.why}` });
  }

  // The catalogue this would produce. A promoted record arrives as a draft:
  // promotion and publication are different decisions and this is the first.
  const promoted: Product[] = selectedRecords.map(({ product }) => {
    const outcome = resolved.get(product.id);
    const chosen = outcome ? outcome.product : product;
    return chosen.status === "draft" ? chosen : { ...chosen, status: "draft" as const };
  });
  const promotedIds = new Set(promoted.map((p) => p.id));
  // Brands and merchants travel with the records that name them: promoting a
  // record whose brand the catalogue does not hold brings the brand too, which
  // is what makes the hypothetical catalogue a real answer rather than an
  // arrangement guaranteed to fail validation.
  const neededBrands = new Set(promoted.map((p) => p.brandId));
  const neededMerchants = new Set(promoted.flatMap((p) => p.offers.map((o) => o.merchantId)));
  const haveBrands = new Set(catalog.brands.map((b) => b.id));
  const haveMerchants = new Set(catalog.merchants.map((m) => m.id));
  const hypothetical: LoadedCatalog = {
    categories: catalog.categories,
    products: [...catalog.products.filter((p) => !promotedIds.has(p.id)), ...promoted],
    brands: [...catalog.brands, ...input.draftBrands.filter((b) => neededBrands.has(b.id) && !haveBrands.has(b.id))],
    merchants: [...catalog.merchants, ...input.draftMerchants.filter((m) => neededMerchants.has(m.id) && !haveMerchants.has(m.id))],
  };
  const catalogueIssues = validateCatalog(hypothetical).map((i) => `${i.file}: ${i.message}`);
  const integrity = familyIssues(hypothetical.products).map((i) => `${i.id}: ${i.message}`);
  for (const issue of catalogueIssues) blockers.push({ code: "catalogue_invalid", about: "catalogue", message: issue });
  for (const issue of integrity) blockers.push({ code: "family_integrity", about: "catalogue", message: issue });

  const plan: Omit<PromotionPlan, "planId"> = {
    sourceId: source.id,
    sourceName: source.name,
    profileVersion: profile.version,
    uploadFile: input.state.lastFile,
    uploadHash: input.state.lastUploadHash,
    lastSuccessfulRefresh: input.state.lastSuccessfulRefresh,
    builtOn: today,
    reviewer: request.reviewer,
    sourceRecords: drafts.length,
    comparisonFamilies: families.length,
    selectable: families.map((f) => ({
      id: f.representative.id,
      name: f.representative.name,
      memberIds: f.members.map((m) => m.id),
      selected: selectedFamilyIds.includes(f.representative.id),
      shadowIds: [f.representative, ...f.members].filter((p) => catalogIds.has(p.id)).map((p) => p.id),
    })),
    selectedFamilyIds,
    selectedRecordIds,
    families: selectedFamilies.map((f) => ({
      id: f.representative.id,
      name: f.representative.name,
      memberIds: f.members.map((m) => m.id),
      records: [
        reviewRecord(f.representative, "representative", input, rightsViews, catalogIds),
        ...f.members.map((m) => reviewRecord(m, "configuration", input, rightsViews, catalogIds)),
      ],
    })),
    shadows,
    rights: selectedRights,
    catalogueIssues,
    familyIntegrityIssues: integrity,
    hypotheticalProducts: hypothetical.products.length,
    hypotheticalFamilies: groupIntoFamilies(hypothetical.products.filter((p) => p.categoryId === source.categoryId)).length,
    blockers,
    // About the plan, and only about the plan. Whether a name has been typed
    // into the signing box is a separate precondition, checked when somebody
    // signs: mixing the two made a plan with nothing unresolved report itself
    // as unsignable because the box was still empty.
    signable: blockers.length === 0,
  };

  return {
    ...plan,
    planId: planIdFor({
      ...plan,
      shadows: plan.shadows.map((s) => ({ id: s.id, choice: s.resolution.choice, fields: s.resolution.fields })),
    }),
  };
}

/**
 * A name for a plan that is a function of the plan.
 *
 * Everything a reviewer decided goes into it: which drafts, from which file
 * read through which mapping, which families, how each collision was answered,
 * who signed and when. Two people making the same decisions about the same
 * bytes get the same identifier; changing one field of one merge gets a
 * different one. It is recomputed when a plan is read back, so a signed plan
 * whose contents were edited on disk stops matching its own name.
 */
export type PlanIdentity = {
  sourceId: string;
  profileVersion: number;
  uploadHash?: string;
  selectedFamilyIds: string[];
  selectedRecordIds: string[];
  shadows: { id: string; choice: string; fields: Record<string, string> }[];
  reviewer: string;
  builtOn: string;
};

export function planIdFor(identity: PlanIdentity): string {
  const content = {
    sourceId: identity.sourceId,
    profileVersion: identity.profileVersion,
    uploadHash: identity.uploadHash ?? null,
    families: [...identity.selectedFamilyIds].sort(),
    records: [...identity.selectedRecordIds].sort(),
    shadows: [...identity.shadows]
      .map((s) => ({ id: s.id, choice: s.choice, fields: Object.fromEntries(Object.entries(s.fields).sort()) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    reviewer: identity.reviewer.trim(),
    builtOn: identity.builtOn,
  };
  return `plan-${createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex").slice(0, 16)}`;
}
