/**
 * Carrying a signed plan out: the one place in this project that writes a
 * partner's records into `catalog/`.
 *
 * It exists because an owner asked for it, and it is deliberately narrow. It
 * takes a plan somebody signed, rebuilds the records that plan describes from
 * the workspace it was signed against, checks that the plan still describes
 * what is there, validates the whole catalogue with the change in it, and only
 * then writes. Nothing is written if anything about that sequence disagrees.
 *
 * Four refusals, and each is a case where writing would be worse than stopping.
 *
 * **A plan that does not name itself.** The identifier is a hash of what was
 * decided. A file whose contents no longer hash to its own name was edited
 * after it was signed, and what it says somebody decided is not what they
 * decided.
 *
 * **A workspace that has moved.** The plan names the exact bytes it was
 * reviewed against. Executing it against a later import would promote records
 * nobody looked at under the authority of a signature about different ones.
 *
 * **A record the plan did not name.** Only the selected families are written.
 *
 * **A catalogue that would not validate.** Checked whole, family integrity
 * included, before the first file is opened.
 *
 * Publishing is a separate argument from promoting and it is a parameter here,
 * not an assumption: `status` says what these records arrive as, and the caller
 * has to say it.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { categoryById } from "@/domain/categories";
import { familyIssues } from "@/domain/family";
import { planIdMatches, type SignedPlan } from "@/domain/promotion/signed";
import { Id, type Brand, type Merchant, type Product, type ProductStatus } from "@/domain/product";
import { loadLocalCatalog, validateCatalog } from "@/providers/catalog/LocalCatalogProvider";
import type { IngestionStore } from "./IngestionStore";
import { planPromotion } from "./promote";

export type ExecuteInput = {
  store: IngestionStore;
  catalogDir: string;
  planId: string;
  /** What the promoted records arrive as. Promotion and publication are two decisions. */
  status: ProductStatus;
  today: string;
  /** Write, or work out what would be written and report it. */
  dryRun: boolean;
};

export type ExecuteOutcome =
  | { ok: true; written: { products: string[]; brands: string[]; merchants: string[] }; unchanged: string[]; plan: SignedPlan }
  | { ok: false; errors: string[] };

function pathIn(root: string, kind: string, id: string): string {
  if (!Id.safeParse(id).success) throw new Error(`"${id}" is not a record id, so no filename is built from it.`);
  const path = resolve(root, kind, `${id}.json`);
  if (!path.startsWith(resolve(root) + sep)) throw new Error(`Refusing to write outside the catalogue: ${path}`);
  return path;
}

const write = (root: string, kind: string, id: string, data: unknown): void => {
  mkdirSync(join(root, kind), { recursive: true });
  writeFileSync(pathIn(root, kind, id), `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Write an accepted risk onto the records it was accepted about.
 *
 * A risk accepted in a plan file is a risk nobody reading the catalogue can
 * see. If a picture is published with its rights unresolved, the record that
 * carries the picture says so, names who decided it and under which plan, and
 * goes on saying that no licence is recorded. That sentence is the opposite of
 * evidence and is worded so it cannot be read as any.
 */
function stamp(product: Product, plan: SignedPlan): Product {
  const risk = plan.acceptedRisks.find((r) => r.code === "image_rights" && (r.about === product.id || r.about === "all"));
  if (!risk || product.images.length === 0) return product;
  const said = `Published with the right to use this picture still unresolved, accepted by ${risk.acceptedBy} on ${plan.signedOn} under plan ${plan.planId}. That is a decision to publish without permission having been established, not a record that permission exists.`;
  return {
    ...product,
    images: product.images.map((image, i) =>
      i === 0 && image.source ? { ...image, source: { ...image.source, note: [image.source.note, said].filter(Boolean).join(" ") } } : image,
    ),
  };
}

export function executePlan(input: ExecuteInput): ExecuteOutcome {
  const { store, catalogDir, planId, status, today } = input;
  const plan = store.plan(planId);
  if (!plan) return { ok: false, errors: [`There is no signed plan called "${planId}".`] };
  if (!planIdMatches(plan)) {
    return { ok: false, errors: [`${planId} does not hash to its own name, so its contents were changed after it was signed. Nothing was written.`] };
  }
  if (plan.executed) return { ok: false, errors: [`${planId} says it has already been carried out.`] };

  const state = store.state(plan.sourceId);
  if (plan.uploadHash !== undefined && state.lastUploadHash !== plan.uploadHash) {
    return {
      ok: false,
      errors: [
        `${planId} was signed against ${plan.uploadFile ?? "a file"} (sha256 ${plan.uploadHash.slice(0, 16)}…) and the workspace now holds a later import. Carrying this out would promote records nobody reviewed under a signature about different ones. Re-review and sign again.`,
      ],
    };
  }

  // Rebuilt from the workspace, with the plan's own selection and resolutions,
  // rather than from anything the plan carries: the plan is a record of a
  // decision, not a store of records.
  const rebuilt = planPromotion({
    store,
    catalogDir,
    sourceId: plan.sourceId,
    request: {
      familyIds: plan.selectedFamilyIds,
      shadows: plan.shadows.map((s) => ({ id: s.id, choice: s.choice, fields: s.fields, note: s.note })),
      reviewer: plan.signedBy,
      acceptedRisks: plan.acceptedRisks.map((a) => ({ code: a.code as never, about: a.about, acceptedBy: a.acceptedBy, because: a.because })),
    },
    today: plan.builtOn,
  });
  if (!rebuilt.ok) return { ok: false, errors: rebuilt.errors };
  if (rebuilt.plan.planId !== plan.planId) {
    return {
      ok: false,
      errors: [`The workspace no longer produces the plan that was signed: it now describes ${rebuilt.plan.planId}. Nothing was written. Re-review and sign again.`],
    };
  }
  if (rebuilt.plan.blockers.length > 0) {
    return { ok: false, errors: ["This plan has blockers now that it did not have when it was signed, so nothing was written.", ...rebuilt.plan.blockers.map((b) => `${b.code}: ${b.message}`)] };
  }

  const named = new Set(plan.selectedRecordIds);
  const resolved = new Map(rebuilt.plan.shadows.map((s) => [s.id, s.outcome!.product]));
  const workspace = store.drafts();
  const products: Product[] = [];
  for (const family of rebuilt.plan.families) {
    for (const record of family.records) {
      if (!named.has(record.id)) return { ok: false, errors: [`${record.id} is not a record this plan named. Nothing was written.`] };
      const source = resolved.get(record.id) ?? workspace.products.find((p) => p.id === record.id);
      if (!source) return { ok: false, errors: [`${record.id} is not in the workspace any more. Nothing was written.`] };
      products.push(stamp({ ...source, status, lastUpdated: today }, plan));
    }
  }

  const catalog = loadLocalCatalog(catalogDir);
  const ids = new Set(products.map((p) => p.id));
  const brandIds = new Set(products.map((p) => p.brandId));
  const merchantIds = new Set(products.flatMap((p) => p.offers.map((o) => o.merchantId)));
  const brands: Brand[] = workspace.brands.filter((b) => brandIds.has(b.id) && !catalog.brands.some((x) => x.id === b.id));
  const merchants: Merchant[] = workspace.merchants.filter((m) => merchantIds.has(m.id) && !catalog.merchants.some((x) => x.id === m.id));

  const after = {
    categories: catalog.categories,
    products: [...catalog.products.filter((p) => !ids.has(p.id)), ...products],
    brands: [...catalog.brands, ...brands],
    merchants: [...catalog.merchants, ...merchants],
  };
  const issues = [...validateCatalog(after).map((i) => `${i.file}: ${i.message}`), ...familyIssues(after.products).map((i) => `${i.id}: ${i.message}`)];
  if (issues.length > 0) return { ok: false, errors: ["The catalogue would not be valid with these records in it, so nothing was written.", ...issues] };

  for (const product of products) {
    if (!categoryById(product.categoryId)) return { ok: false, errors: [`${product.id} names a category this site does not define.`] };
  }

  // What would actually change on disk. A record whose bytes are identical is
  // left alone so a diff says what moved.
  const existing = new Map(catalog.products.map((p) => [p.id, p]));
  const changed = products.filter((p) => !same(existing.get(p.id), p));
  const unchanged = products.filter((p) => same(existing.get(p.id), p)).map((p) => p.id);
  if (input.dryRun) {
    return { ok: true, written: { products: changed.map((p) => p.id), brands: brands.map((b) => b.id), merchants: merchants.map((m) => m.id) }, unchanged, plan };
  }

  for (const brand of brands) write(catalogDir, "brands", brand.id, brand);
  for (const merchant of merchants) write(catalogDir, "merchants", merchant.id, merchant);
  for (const product of changed) write(catalogDir, "products", product.id, product);

  return { ok: true, written: { products: changed.map((p) => p.id), brands: brands.map((b) => b.id), merchants: merchants.map((m) => m.id) }, unchanged, plan };
}
