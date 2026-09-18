/**
 * The promotion planner, wired to the workspace and the catalogue.
 *
 * The server is a thin wrapper around these two calls, and signing rebuilds the
 * plan from what is on disk rather than trusting one handed in. A plan the
 * client composed would be a plan whose blockers the client decided, which is
 * the opposite of the point.
 *
 * Nothing here writes to `catalog/`. It reads the catalogue to work out what a
 * promotion would produce, and the only thing it ever writes is a signed plan
 * in the ingestion workspace.
 */

import { categoryById } from "@/domain/categories";
import { isApproved } from "@/domain/ingestion/profile";
import { buildPromotionPlan, type PlanRequest, type PromotionPlan } from "@/domain/promotion/plan";
import { renderPlan, signPlan, type SignedPlan } from "@/domain/promotion/signed";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";
import type { IngestionStore } from "./IngestionStore";

export type PlanContext = {
  store: IngestionStore;
  catalogDir: string;
  sourceId: string;
  request: PlanRequest;
  today: string;
};

export type PlanOutcome = { ok: true; plan: PromotionPlan } | { ok: false; errors: string[] };

export function planPromotion(ctx: PlanContext): PlanOutcome {
  const { store, sourceId } = ctx;
  const source = store.source(sourceId);
  if (!source) return { ok: false, errors: [`There is no partner source called "${sourceId}".`] };

  const state = store.state(sourceId);
  const version = state.lastProfileVersion;
  if (version === undefined) {
    return { ok: false, errors: [`Nothing has been imported for ${source.name} yet, so there are no drafts to plan a promotion from.`] };
  }
  const profile = store.profile(sourceId, version);
  if (!profile) return { ok: false, errors: [`The last import used mapping v${version} and that version is no longer in the workspace.`] };
  if (!isApproved(profile)) return { ok: false, errors: [`Mapping v${version} is not approved, so the drafts under it are not reviewable for promotion.`] };

  const category = categoryById(source.categoryId);
  if (!category) return { ok: false, errors: [`${source.name} names category "${source.categoryId}", which this site does not define.`] };

  const workspace = store.drafts();
  const drafts = workspace.products.filter((p) => p.categoryId === source.categoryId);
  return {
    ok: true,
    plan: buildPromotionPlan({
      source,
      profile,
      category,
      catalog: loadLocalCatalog(ctx.catalogDir),
      drafts,
      draftBrands: workspace.brands,
      draftMerchants: workspace.merchants,
      rights: store.allRights(),
      state: {
        lastFile: state.lastFile,
        lastUploadHash: state.lastUploadHash,
        lastSuccessfulRefresh: state.lastSuccessfulRefresh,
        snapshot: state.snapshot,
        conflicts: state.conflicts,
      },
      request: ctx.request,
      today: ctx.today,
    }),
  };
}

export type SignOutcome = { ok: true; plan: SignedPlan; document: string } | { ok: false; errors: string[] };

/**
 * Sign the plan the workspace produces right now.
 *
 * Signing performs no catalogue write. It writes one file into the ingestion
 * workspace and nothing else, and there is no call anywhere in this project
 * that carries a signed plan out.
 */
export function signPromotion(ctx: PlanContext): SignOutcome {
  const built = planPromotion(ctx);
  if (!built.ok) return { ok: false, errors: built.errors };
  const signed = signPlan(built.plan, ctx.request.reviewer, ctx.today);
  if (!signed.ok) return { ok: false, errors: signed.errors };
  try {
    ctx.store.savePlan(signed.plan);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
  return { ok: true, plan: signed.plan, document: renderPlan(signed.plan) };
}
