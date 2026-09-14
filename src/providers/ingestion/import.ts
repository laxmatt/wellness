/**
 * An import, start to finish, in one place the tests can run.
 *
 * The server is a thin wrapper around this: it parses a request, calls one of
 * these, and draws the answer. Keeping the whole sequence here is what lets the
 * repeat-import behaviour be tested as the thing that actually runs rather than
 * as a re-implementation of it that agrees with itself.
 *
 * The order is the safety property. Nothing is written until the report says it
 * can be, the file is kept before anything is derived from it and refused if it
 * carries a credential, and the resulting drafts are validated against the
 * catalogue they would join before a single file is touched. A half-written
 * import is worse than a refused one.
 */

import { categoryById } from "@/domain/categories";
import { adapterFor, type SourceTable } from "@/domain/ingestion/adapter";
import { nextSnapshot } from "@/domain/ingestion/merge";
import { preflight, type Preflight } from "@/domain/ingestion/preflight";
import { isApproved, type MappingProfile, type PartnerSource } from "@/domain/ingestion/profile";
import type { RecordFields } from "@/domain/ingestion/record";
import type { Brand, Merchant, Product } from "@/domain/product";
import { loadLocalCatalog, validateCatalog, type CatalogRecords } from "@/providers/catalog/LocalCatalogProvider";
import type { CredentialFinding, IngestionStore, SourceState } from "./IngestionStore";

export type ReportInput = {
  store: IngestionStore;
  catalogDir: string;
  source: PartnerSource;
  profile: MappingProfile;
  table: SourceTable;
  fileName: string;
  today: string;
};

export function buildReport(input: ReportInput): Preflight {
  const category = categoryById(input.source.categoryId);
  if (!category) throw new Error(`${input.source.name} names category "${input.source.categoryId}", which this site does not define.`);
  const catalog = loadLocalCatalog(input.catalogDir);
  return preflight({
    table: input.table,
    profile: input.profile,
    source: input.source,
    category,
    fileName: input.fileName,
    today: input.today,
    workspace: input.store.draftsById(),
    catalogIds: new Set(catalog.products.map((p) => p.id)),
    snapshot: input.store.snapshot(input.source.id),
    lastSuccessfulRefresh: input.store.state(input.source.id).lastSuccessfulRefresh,
  });
}

/** Drafts have to be valid in the catalogue they would join, not merely parse on their own. */
export function draftIssues(catalogDir: string, drafts: CatalogRecords): string[] {
  const catalog = loadLocalCatalog(catalogDir);
  const productIds = new Set(drafts.products.map((p) => p.id));
  const brandIds = new Set(drafts.brands.map((b) => b.id));
  const merchantIds = new Set(drafts.merchants.map((m) => m.id));
  return validateCatalog({
    categories: catalog.categories,
    // A draft shadowing a catalogue record replaces it here, because that is
    // what promoting it would do. Holding both would trip the uniqueness check
    // over a collision that does not exist yet.
    products: [...catalog.products.filter((p) => !productIds.has(p.id)), ...drafts.products],
    brands: [...catalog.brands.filter((b) => !brandIds.has(b.id)), ...drafts.brands],
    merchants: [...catalog.merchants.filter((m) => !merchantIds.has(m.id)), ...drafts.merchants],
  }).map((i) => `${i.file}: ${i.message}`);
}

export type ImportInput = {
  store: IngestionStore;
  catalogDir: string;
  sourceId: string;
  version: number;
  fileName: string;
  text: string;
  today: string;
};

export type ImportOutcome =
  | { ok: true; report: Preflight; written: string[]; upload: { path: string; hash: string; bytes: number } }
  | { ok: false; errors: string[]; report?: Preflight; blockers?: string[]; refusals?: string[]; findings?: CredentialFinding[] };

export function runIngestionImport(input: ImportInput): ImportOutcome {
  const { store, catalogDir, sourceId, version, fileName, text, today } = input;
  const source = store.source(sourceId);
  if (!source) return { ok: false, errors: [`There is no partner source called "${sourceId}".`] };
  const profile = store.profile(sourceId, version);
  if (!profile) return { ok: false, errors: [`There is no version ${version} of ${source.name}'s mapping.`] };
  if (!isApproved(profile)) {
    return { ok: false, errors: [`Version ${version} has not been approved. Approving a mapping and importing drafts are two decisions, and the first has not been made.`] };
  }

  const adapter = adapterFor(source.format);
  if (!adapter.ok) return { ok: false, errors: [adapter.reason] };
  const read = adapter.adapter.read(text, Buffer.byteLength(text, "utf8"));
  if (!read.ok) return { ok: false, errors: [read.reason] };

  const report = buildReport({ store, catalogDir, source, profile, table: read.table, fileName, today });
  if (report.blockers.length > 0) return { ok: false, errors: ["This import was refused, and nothing was written."], blockers: report.blockers, report };

  const saved = store.saveUpload(source.id, fileName, text, today);
  if (!saved.ok) return { ok: false, errors: [saved.reason], findings: saved.findings, report };

  // Unchanged records are left alone on disk. Rewriting one would move its
  // note, which says what the last import did to it, and a file whose contents
  // changed for no reason is a diff somebody has to read to find that out.
  const writing = report.plans.filter((p) => p.product !== undefined && p.action !== "unchanged");
  const existing = store.drafts();
  const merchant: Merchant = {
    id: source.merchantId,
    slug: source.merchantId,
    name: source.merchantName,
    ...(source.merchantWebsite ? { websiteUrl: source.merchantWebsite } : {}),
    ...(source.affiliate.network ? { network: source.affiliate.network } : {}),
    markets: ["US"],
  };
  const merchants = [...existing.merchants.filter((m) => m.id !== merchant.id), merchant];
  const brands: Brand[] = [...existing.brands];
  for (const plan of writing) {
    if (plan.brand && !brands.some((b) => b.id === plan.brand!.id)) brands.push(plan.brand);
  }
  const products: Product[] = [...existing.products.filter((p) => !writing.some((w) => w.id === p.id)), ...writing.map((w) => w.product!)];

  const issues = draftIssues(catalogDir, { products, brands, merchants });
  if (issues.length > 0) {
    return { ok: false, errors: ["These drafts would not be valid in the catalogue they would join, so nothing was written."], refusals: issues, report };
  }

  for (const m of merchants) store.writeDraft("merchants", m.id, m);
  for (const b of brands) store.writeDraft("brands", b.id, b);
  for (const plan of writing) store.writeDraft("products", plan.id, plan.product!);

  const previous = store.state(source.id);
  const snapshot: Record<string, RecordFields> = { ...(previous.snapshot as Record<string, RecordFields>) };
  const conflicts: SourceState["conflicts"] = { ...previous.conflicts };
  for (const plan of report.plans) {
    if (plan.product === undefined) continue;
    snapshot[plan.id] = nextSnapshot(plan.outcomes, previous.snapshot[plan.id] as RecordFields | undefined);
    // Open disagreements outlive the run that found them, so a reviewer looking
    // at a draft next week sees them without the feed in front of them.
    const open = plan.outcomes.filter((o) => o.outcome === "conflict").map((o) => ({ key: o.key, label: o.label, incoming: o.incoming, current: o.current, last: o.last }));
    if (open.length > 0) conflicts[plan.id] = open;
    else delete conflicts[plan.id];
  }
  store.saveState({
    sourceId: source.id,
    lastSuccessfulRefresh: today,
    lastProfileVersion: profile.version,
    lastFile: fileName,
    lastUploadHash: saved.hash,
    snapshot,
    conflicts,
  });

  return { ok: true, report, written: writing.map((w) => w.id), upload: { path: saved.path, hash: saved.hash, bytes: saved.bytes } };
}
