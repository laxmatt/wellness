/**
 * A decision, signed and kept, which is still not the decision being carried
 * out.
 *
 * Signing writes one file into the ingestion workspace. It moves no product,
 * writes nothing to `catalog/`, publishes nothing and changes no status. What
 * it records is that a named person, on a named day, looked at named drafts
 * built from a named file through a named mapping, answered every collision,
 * cleared every picture, and would promote these families.
 *
 * The record is deliberately complete enough to be read on its own a month
 * later, by somebody who does not have the workspace in front of them, and
 * deliberately immutable: a signed plan is written once and nothing, including
 * the next import of the same feed, edits it. A later feed can make a plan
 * out of date, and the tool says when it has, but out of date is a thing a
 * reader is told rather than a thing done to the file.
 *
 * `executed` is always false and there is no code anywhere that sets it. It is
 * in the shape so that the record says what it is.
 */

import { z } from "zod";
import { Id } from "@/domain/product";
import { ShadowChoice, FieldSide } from "./shadow";
import { planIdFor, type PromotionPlan } from "./plan";

export const SignedShadow = z.object({
  id: Id,
  choice: ShadowChoice,
  fields: z.record(z.string(), FieldSide).default({}),
  note: z.string().default(""),
  /** Which record the catalogue would end up with, in one word. */
  outcome: z.enum(["existing", "draft", "merged"]),
  /** Fields a merge took from the catalogue record. */
  tookExisting: z.array(z.string()).default([]),
  /** What this choice would throw away, so the cost is in the record and not only on a screen. */
  discards: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
});

export const SignedRecord = z.object({
  id: Id,
  name: z.string(),
  role: z.enum(["representative", "configuration"]),
  familyId: Id,
  price: z.string(),
  priceLastChecked: z.iso.date(),
  availability: z.string(),
  link: z.string(),
  affiliateStatus: z.string(),
  imageSrc: z.string().optional(),
  imageRights: z.string(),
  imageRightsBasis: z.string().optional(),
  imageRightsRecordedBy: z.string().optional(),
  imageRightsRecordedOn: z.iso.date().optional(),
  provenance: z.string(),
  editorialChanges: z.array(z.string()).default([]),
  openConflicts: z.array(z.string()).default([]),
  comparisonMapped: z.array(z.string()).default([]),
  comparisonMissing: z.array(z.string()).default([]),
});

export const SignedPlan = z.object({
  planId: z.string().regex(/^plan-[0-9a-f]{16}$/),
  signedBy: z.string().min(1),
  signedOn: z.iso.date(),
  builtOn: z.iso.date(),

  sourceId: Id,
  sourceName: z.string(),
  profileVersion: z.number().int().positive(),
  uploadFile: z.string().optional(),
  uploadHash: z.string().optional(),
  lastSuccessfulRefresh: z.iso.date().optional(),

  sourceRecords: z.number().int().nonnegative(),
  comparisonFamilies: z.number().int().nonnegative(),
  selectedFamilyIds: z.array(Id),
  selectedRecordIds: z.array(Id),
  records: z.array(SignedRecord),
  shadows: z.array(SignedShadow).default([]),

  hypotheticalProducts: z.number().int().nonnegative(),
  hypotheticalFamilies: z.number().int().nonnegative(),
  /** Empty by construction: a plan with a blocker cannot be signed. Kept so the record says so. */
  unresolvedBlockers: z.array(z.string()).default([]),

  /** Never true. Nothing in this project sets it, and promotion is not published here. */
  executed: z.literal(false),
});
export type SignedPlan = z.infer<typeof SignedPlan>;

export type SignOutcome = { ok: true; plan: SignedPlan } | { ok: false; errors: string[] };

export function signPlan(plan: PromotionPlan, signedBy: string, signedOn: string): SignOutcome {
  const by = signedBy.trim();
  if (by === "") return { ok: false, errors: ["An approval nobody signed is not one. Say who is signing this plan."] };
  if (plan.blockers.length > 0) {
    return { ok: false, errors: ["This plan has unresolved blockers, so it cannot be signed.", ...plan.blockers.map((b) => `${b.code}: ${b.message}`)] };
  }
  if (plan.selectedRecordIds.length === 0) return { ok: false, errors: ["Nothing is selected, so there is nothing to sign."] };

  const records = plan.families.flatMap((family) =>
    family.records.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      familyId: family.id,
      price: r.price.display,
      priceLastChecked: r.price.lastChecked,
      availability: r.availability,
      link: r.link.url,
      affiliateStatus: r.link.affiliateStatus,
      imageSrc: r.image.src,
      imageRights: r.image.state,
      imageRightsBasis: r.image.record?.basis,
      imageRightsRecordedBy: r.image.record?.recordedBy,
      imageRightsRecordedOn: r.image.record?.recordedOn,
      provenance: [r.provenance.kind, r.provenance.method, r.provenance.ref].filter(Boolean).join(" · "),
      editorialChanges: r.editorial.changes.map((c) => c.label),
      openConflicts: r.editorial.conflicts.map((c) => c.label),
      comparisonMapped: r.comparison.filter((c) => c.state === "mapped").map((c) => c.label),
      comparisonMissing: r.comparison.filter((c) => c.state === "missing").map((c) => c.label),
    })),
  );

  const signed = SignedPlan.safeParse({
    planId: plan.planId,
    signedBy: by,
    signedOn,
    builtOn: plan.builtOn,
    sourceId: plan.sourceId,
    sourceName: plan.sourceName,
    profileVersion: plan.profileVersion,
    uploadFile: plan.uploadFile,
    uploadHash: plan.uploadHash,
    lastSuccessfulRefresh: plan.lastSuccessfulRefresh,
    sourceRecords: plan.sourceRecords,
    comparisonFamilies: plan.comparisonFamilies,
    selectedFamilyIds: plan.selectedFamilyIds,
    selectedRecordIds: plan.selectedRecordIds,
    records,
    shadows: plan.shadows.map((s) => ({
      id: s.id,
      choice: s.resolution.choice,
      fields: s.resolution.fields,
      note: s.resolution.note,
      outcome: s.outcome!.from,
      tookExisting: s.outcome!.tookExisting,
      discards: s.outcome!.discards.map((d) => ({ key: d.key, label: d.label })),
    })),
    hypotheticalProducts: plan.hypotheticalProducts,
    hypotheticalFamilies: plan.hypotheticalFamilies,
    unresolvedBlockers: [],
    executed: false,
  });
  if (!signed.success) {
    return { ok: false, errors: signed.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`) };
  }
  return { ok: true, plan: signed.data };
}

/** Whether a stored plan still names itself, which a hand-edited file would not. */
export const planIdMatches = (plan: SignedPlan): boolean =>
  planIdFor({
    sourceId: plan.sourceId,
    profileVersion: plan.profileVersion,
    uploadHash: plan.uploadHash,
    selectedFamilyIds: plan.selectedFamilyIds,
    selectedRecordIds: plan.selectedRecordIds,
    shadows: plan.shadows.map((s) => ({ id: s.id, choice: s.choice, fields: s.fields })),
    reviewer: plan.signedBy,
    builtOn: plan.builtOn,
  }) === plan.planId;

const list = (items: string[]): string => (items.length === 0 ? "none" : items.join(", "));

/** The plan as a document, for somebody who does not have the tool in front of them. */
export function renderPlan(plan: SignedPlan): string {
  const lines: string[] = [];
  lines.push(`# Promotion plan ${plan.planId}`, "");
  lines.push(`**Nothing has been promoted or published.** This is a record of a decision. No file in \`catalog/\` was written when this was signed, and there is no command in this tool that carries it out.`, "");
  lines.push(`- Signed by ${plan.signedBy} on ${plan.signedOn}${plan.builtOn !== plan.signedOn ? ` (planned ${plan.builtOn})` : ""}`);
  lines.push(`- Source: ${plan.sourceName} (${plan.sourceId}), mapping profile v${plan.profileVersion}`);
  lines.push(`- File: ${plan.uploadFile ?? "not recorded"}${plan.uploadHash ? ` (sha256 ${plan.uploadHash.slice(0, 16)}…)` : ""}`);
  lines.push(`- Last successful refresh: ${plan.lastSuccessfulRefresh ?? "never"}`);
  lines.push(`- Workspace: ${plan.sourceRecords} source records, ${plan.comparisonFamilies} comparison families`);
  lines.push(`- Selected: ${plan.selectedFamilyIds.length} families, ${plan.selectedRecordIds.length} records`);
  lines.push(`- Catalogue afterwards, if this were ever carried out: ${plan.hypotheticalProducts} products, ${plan.hypotheticalFamilies} comparable models in this category`);
  lines.push("");

  if (plan.shadows.length > 0) {
    lines.push("## Records the catalogue already holds", "");
    for (const s of plan.shadows) {
      lines.push(`### ${s.id}`);
      lines.push(`- Decision: ${s.choice} (${s.outcome})`);
      if (s.tookExisting.length > 0) lines.push(`- Taken from the catalogue record: ${list(s.tookExisting)}`);
      if (s.discards.length > 0) lines.push(`- Given up by this choice: ${list(s.discards.map((d) => d.label))}`);
      if (s.note) lines.push(`- Note: ${s.note}`);
      lines.push("");
    }
  }

  lines.push("## Records", "");
  let family = "";
  for (const r of plan.records) {
    if (r.familyId !== family) {
      family = r.familyId;
      lines.push(`### Family: ${family}`, "");
    }
    lines.push(`**${r.name}** \`${r.id}\` — ${r.role}`);
    lines.push(`- Price ${r.price}, checked ${r.priceLastChecked}; availability ${r.availability}`);
    lines.push(`- Link ${r.link} (${r.affiliateStatus})`);
    lines.push(`- Image ${r.imageSrc ?? "none"} — rights ${r.imageRights}${r.imageRightsBasis ? `, ${r.imageRightsBasis} recorded by ${r.imageRightsRecordedBy} on ${r.imageRightsRecordedOn}` : ""}`);
    lines.push(`- Provenance ${r.provenance}`);
    lines.push(`- Comparison fields present: ${list(r.comparisonMapped)}`);
    lines.push(`- Comparison fields missing: ${list(r.comparisonMissing)}`);
    if (r.editorialChanges.length > 0) lines.push(`- Changed here since the last import: ${list(r.editorialChanges)}`);
    if (r.openConflicts.length > 0) lines.push(`- Open conflicts: ${list(r.openConflicts)}`);
    lines.push("");
  }

  lines.push("## Not done", "");
  lines.push("- No product was promoted into `catalog/`.");
  lines.push("- No product or category was published.");
  lines.push("- Sauna families are not wired into shopper-facing queries or pages.");
  lines.push("- Nothing was deployed.");
  return lines.join("\n");
}
