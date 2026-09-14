/**
 * Launching saunas: the Sweat Kingdom feed, reviewed, signed and carried out.
 *
 *   npm run promote:saunas              # work it out and print it, write nothing
 *   npm run promote:saunas -- --write   # write catalog/ and the signed plan
 *
 * One command, reproducible from a clean checkout, because everything it needs
 * is committed: the feed in `intake/`, the mapping in `ingestion-seed.ts`, and
 * the decisions below. It builds a workspace in a temporary directory, imports
 * the feed, records the owner's decisions, signs a plan, and carries it out.
 *
 * Two of those decisions are the owner's and are written down as his rather
 * than dressed up as findings.
 *
 * **The image rights are unresolved and the site is publishing anyway.** The
 * pictures come from an affiliate feed. Nobody has read the programme's
 * creative terms, no licence has been recorded, and none is invented here. The
 * risk is accepted by name in the signed plan, and every image on every record
 * goes on carrying a note saying the rights are unverified. Accepting that they
 * are unknown is the opposite of recording that they are settled.
 *
 * **The five records the catalogue already held are merged, not replaced.**
 * They were built from this same feed by the partner adapter, and every mapped
 * field agrees to the byte, so the merge takes nothing away. The script proves
 * that rather than assuming it: if any field of any of the five disagreed, it
 * would stop and say which.
 *
 * What it does not do: infer a specification from a title, approve the capacity
 * extraction rule, or record any rights evidence.
 */

import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shadowDiff } from "@/domain/promotion/shadow";
import { renderPlan } from "@/domain/promotion/signed";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { executePlan } from "@/providers/ingestion/execute";
import { runIngestionImport } from "@/providers/ingestion/import";
import { planPromotion, signPromotion } from "@/providers/ingestion/promote";
import { FIRST_PROFILE, SWEAT_KINGDOM } from "./ingestion-seed";

const ROOT = process.cwd();
const CATALOG = join(ROOT, "catalog");
const FEED = join(ROOT, "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv");
const PLANS = join(ROOT, "docs/promotion-plans");

/** Pinned, so the same decisions produce the same plan identifier on any day. */
const ON = "2026-09-14";
const REVIEWER = "Matt (site owner), relayed through Codex";

/**
 * The one risk accepted, in the owner's own terms.
 *
 * Not evidence. It says the rights are unknown and that publication went ahead
 * regardless, which is a different sentence from any sentence about permission.
 */
const IMAGE_RIGHTS_RISK = {
  code: "image_rights" as const,
  about: "all",
  acceptedBy: REVIEWER,
  because:
    "The owner has confirmed the launch in the knowledge that the feed images carry no recorded permission, that no sauna comparison specification is stated anywhere in this feed, and that five records already in the catalogue are being merged. The images stay marked unverified on every record.",
};

function die(message: string, detail: string[] = []): never {
  console.error(`Stopped. ${message}`);
  for (const line of detail) console.error(`  ${line}`);
  process.exit(1);
}

function main(): void {
  const write = process.argv.includes("--write");
  const dir = mkdtempSync(join(tmpdir(), "promote-saunas-"));
  try {
    const store = new IngestionStore(dir);
    store.saveSource(SWEAT_KINGDOM);
    store.saveProfile(FIRST_PROFILE(1, ON));
    store.approveProfile(SWEAT_KINGDOM.id, 1, REVIEWER, ON);

    const raw = readFileSync(FEED, "utf8");
    const imported = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "awin-125462-f3219-2026-09-13.csv", text: raw, today: ON });
    if (!imported.ok) die("the feed would not import.", imported.errors);
    const drafts = store.drafts().products;
    console.log(`Imported ${drafts.length} source records from ${imported.report.rows} rows.`);

    // Every family, and only ever whole families.
    const families = planPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request: { familyIds: [], shadows: [], reviewer: REVIEWER }, today: ON });
    if (!families.ok) die("the plan would not build.", families.errors);
    const familyIds = families.plan.selectable.map((f) => f.id);
    console.log(`${familyIds.length} comparison families, ${families.plan.sourceRecords} source records.`);

    // The five the catalogue already holds. Merged field by field, and the
    // merge is only valid if there is nothing to argue about: a field the two
    // disagree on would have to be decided by a person, so this stops.
    const catalog = loadLocalCatalog(CATALOG);
    const profile = store.profile(SWEAT_KINGDOM.id, 1)!;
    const shadows = [];
    for (const existing of catalog.products.filter((p) => drafts.some((d) => d.id === p.id))) {
      const diff = shadowDiff(existing, store.draft(existing.id)!, profile, SWEAT_KINGDOM.merchantId);
      if (diff.contested.length > 0) {
        die(
          `${existing.id} disagrees with the feed on ${diff.contested.length} field(s), so an exact merge is not possible and nothing was written.`,
          diff.fields.filter((f) => !f.same).map((f) => `${f.key} (${f.ownership}): catalogue ${JSON.stringify(f.existing)} vs feed ${JSON.stringify(f.draft)}`),
        );
      }
      // Nothing contested, so a merge takes every field from the side that owns
      // it and changes none of them. The record keeps its editorial and
      // review-on-change values because they are the same values.
      shadows.push({ id: existing.id, choice: "merge_fields" as const, fields: {}, note: "Every mapped field agrees to the byte; the merge preserves the catalogue record and refreshes the feed-owned fields to the same values." });
      console.log(`  ${existing.id}: every mapped field agrees, merged with nothing lost.`);
    }

    const request = { familyIds, shadows, reviewer: REVIEWER, acceptedRisks: [IMAGE_RIGHTS_RISK] };
    const built = planPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request, today: ON });
    if (!built.ok) die("the plan would not build.", built.errors);
    if (built.plan.blockers.length > 0) {
      die("the plan has blockers that nobody accepted, so nothing was written.", built.plan.blockers.map((b) => `${b.code}: ${b.message}`));
    }
    console.log(`\nPlan ${built.plan.planId}: ${built.plan.selectedRecordIds.length} records in ${built.plan.selectedFamilyIds.length} families.`);
    console.log(`Accepted despite: ${built.plan.accepted.map((a) => `${a.blocker.code} (${a.blocker.about})`).join(", ") || "nothing"}, ${built.plan.accepted.length} blocker(s).`);
    console.log(`The catalogue afterwards: ${built.plan.hypotheticalProducts} products, ${built.plan.hypotheticalFamilies} comparable saunas.`);

    const signed = signPromotion({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, request, today: ON });
    if (!signed.ok) die("the plan would not sign.", signed.errors);

    const outcome = executePlan({ store, catalogDir: CATALOG, planId: signed.plan.planId, status: "published", today: ON, dryRun: !write });
    if (!outcome.ok) die("the plan would not carry out.", outcome.errors);

    console.log(`\n${write ? "Wrote" : "Would write"} ${outcome.written.products.length} products, ${outcome.written.brands.length} brands, ${outcome.written.merchants.length} merchants.`);
    if (outcome.unchanged.length > 0) console.log(`${outcome.unchanged.length} already identical on disk.`);

    if (write) {
      mkdirSync(PLANS, { recursive: true });
      writeFileSync(join(PLANS, `${signed.plan.planId}.json`), `${JSON.stringify(signed.plan, null, 2)}\n`, "utf8");
      writeFileSync(join(PLANS, `${signed.plan.planId}.md`), `${renderPlan(signed.plan)}\n`, "utf8");
      console.log(`Signed plan saved to docs/promotion-plans/${signed.plan.planId}.{json,md}`);
    } else {
      console.log("\nNothing was written. Re-run with --write to carry it out.");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
