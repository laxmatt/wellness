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
 * What it does not do: read a figure out of a sentence, or record any rights
 * evidence. Capacity and style are read from explicit tokens in the retailer's
 * own model names by rules the owner approved, and every value carries the
 * rule, the profile version that approved it, the whole title it read and
 * exactly what matched. Heating type and placement are read from nothing,
 * because this feed states neither anywhere, and they stay Not stated.
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

    // The records the catalogue already holds. Merged field by field, and a
    // field the two disagree on has to be decided rather than guessed.
    //
    // Exactly four fields may move, and only because the approved rules below
    // now read them: the model name, the retailer's own title kept beside it,
    // the capacity and the style. Anything else disagreeing means somebody
    // edited a record here, or the feed moved, and either way a person decides
    // rather than this script.
    const DERIVED = ["name", "source_title", "attr:capacity_max_people", "attr:sauna_style"];
    const catalog = loadLocalCatalog(CATALOG);
    const profile = store.profile(SWEAT_KINGDOM.id, 1)!;
    const shadows = [];
    let moved = 0;
    for (const existing of catalog.products.filter((p) => drafts.some((d) => d.id === p.id))) {
      const diff = shadowDiff(existing, store.draft(existing.id)!, profile, SWEAT_KINGDOM.merchantId);
      const unexpected = diff.contested.filter((key) => !DERIVED.includes(key));
      if (unexpected.length > 0) {
        die(
          `${existing.id} disagrees with the feed on ${unexpected.length} field(s) the approved rules do not derive, so an exact merge is not possible and nothing was written.`,
          diff.fields
            .filter((f) => unexpected.includes(f.key))
            .map((f) => `${f.key} (${f.ownership}): catalogue ${JSON.stringify(f.existing)} vs feed ${JSON.stringify(f.draft)}`),
        );
      }
      // Every contested field is one the rules derive, so the rules decide it.
      const fields = Object.fromEntries(diff.contested.map((key) => [key, "draft" as const]));
      shadows.push({
        id: existing.id,
        choice: "merge_fields" as const,
        fields,
        note:
          diff.contested.length === 0
            ? "Every mapped field agrees to the byte; the merge preserves the catalogue record and refreshes the feed-owned fields to the same values."
            : `Re-derived by approved rules in mapping profile v${profile.version}: ${diff.contested.join(", ")}. Every other mapped field agrees to the byte.`,
      });
      moved += diff.contested.length;
      console.log(`  ${existing.id}: ${diff.contested.length === 0 ? "every mapped field agrees" : `re-derives ${diff.contested.join(", ")}`}, nothing else moved.`);
    }
    console.log(`${moved} field(s) re-derived across ${shadows.length} record(s) the catalogue already held.`);

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
