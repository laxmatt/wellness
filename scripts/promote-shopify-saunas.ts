/**
 * Promote the currently reviewed Shopify sauna drafts, partner by partner.
 *
 *   npm run promote:shopify-saunas              # dry run
 *   npm run promote:shopify-saunas -- --write   # write catalog and signed plans
 *
 * Inventory mapping and draft review happen in the local ingestion tool. This
 * command only carries out an approved, current workspace; it never fetches a
 * feed and it never mixes two partners that happen to share a category.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderPlan } from "@/domain/promotion/signed";
import { executePlan } from "@/providers/ingestion/execute";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { planPromotion, signPromotion } from "@/providers/ingestion/promote";

const ROOT = process.cwd();
const CATALOG = join(ROOT, "catalog");
const PLANS = join(ROOT, "docs/promotion-plans");
const REVIEWER = "Matt (site owner), relayed through Codex";
const TODAY = new Date().toISOString().slice(0, 10);
const SOURCES = ["select-saunas-shopify", "topture-shopify"];

function stop(message: string, details: string[] = []): never {
  console.error(`Stopped. ${message}`);
  for (const detail of details) console.error(`  ${detail}`);
  process.exit(1);
}

function main(): void {
  const write = process.argv.includes("--write");
  const store = new IngestionStore(join(ROOT, "ingestion"));

  for (const sourceId of SOURCES) {
    const choice = planPromotion({ store, catalogDir: CATALOG, sourceId, request: { familyIds: [], shadows: [], reviewer: REVIEWER }, today: TODAY });
    if (!choice.ok) stop(`${sourceId} cannot be reviewed.`, choice.errors);

    const familyIds = choice.plan.selectable.map((family) => family.id);
    const request = {
      familyIds,
      shadows: [],
      reviewer: REVIEWER,
      acceptedRisks: [{
        code: "image_rights" as const,
        about: "all",
        acceptedBy: REVIEWER,
        because: "The owner decided that an approved partner directing Wellness Fit Check to its official inventory feed is sufficient permission to use the product images supplied in that feed; no separate written image permission is required.",
      }],
    };

    const planned = planPromotion({ store, catalogDir: CATALOG, sourceId, request, today: TODAY });
    if (!planned.ok) stop(`${sourceId} cannot build a promotion plan.`, planned.errors);
    if (planned.plan.blockers.length > 0) stop(`${sourceId} still has blockers.`, planned.plan.blockers.map((b) => `${b.code}: ${b.message}`));

    if (!write) {
      console.log(`Would publish ${planned.plan.selectedRecordIds.length} products from ${sourceId}.`);
      continue;
    }

    const existing = store.plan(planned.plan.planId);
    const signed = existing ? { ok: true as const, plan: existing, document: renderPlan(existing) } : signPromotion({ store, catalogDir: CATALOG, sourceId, request, today: TODAY });
    if (!signed.ok) stop(`${sourceId} cannot sign its promotion plan.`, signed.errors);
    const result = executePlan({ store, catalogDir: CATALOG, planId: signed.plan.planId, status: "published", today: TODAY, dryRun: false });
    if (!result.ok) stop(`${sourceId} cannot execute its signed plan.`, result.errors);

    console.log(`Published ${result.written.products.length} products from ${sourceId}.`);
    mkdirSync(PLANS, { recursive: true });
    writeFileSync(join(PLANS, `${signed.plan.planId}.json`), `${JSON.stringify(signed.plan, null, 2)}\n`, "utf8");
    writeFileSync(join(PLANS, `${signed.plan.planId}.md`), `${renderPlan(signed.plan)}\n`, "utf8");
  }
}

main();
