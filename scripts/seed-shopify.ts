/**
 * Register the three Shopify partners in the local ingestion workspace.
 *
 *   npm run ingestion:seed:shopify
 *
 * Sources and first mapping profiles, nothing approved and nothing imported.
 * The profiles name the words these stores are expected to use in their own
 * structured fields; the counts and the reasons come from the first snapshot,
 * and a person approves them in the tool after reading those.
 *
 * It also writes down the partners with no catalogue to read, with their
 * programme facts and any compliance requirement nobody has cleared, so the
 * inventory says why they are absent rather than leaving somebody to wonder.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { ingestionRoot } from "@/providers/ingestion/root";
import { PROGRAMMES, RECORDING_RULES, secretsIn } from "@/domain/affiliate/programmes";
import type { MappingProfile } from "@/domain/ingestion/profile";
import { BLOCKED_PARTNERS, SHOPIFY_PARTNERS, shopifyProfile } from "./shopify-partners";

/**
 * A last gate before anything a person typed reaches the disk.
 *
 * Programme facts are copied out of a dashboard by hand, and a hand slips. A
 * session cookie or a one-time setup link pasted into a referral field would
 * sit in the workspace and, worse, would look like it belonged there. Nothing
 * here tries to be clever: it refuses the write and names the field.
 */
function refuseSecrets(): void {
  for (const programme of PROGRAMMES) {
    const found = secretsIn(programme);
    if (found.length > 0) {
      throw new Error(
        `${programme.merchantName}: ${found.map((f) => `${f.field} contains "${f.matched}"`).join(", ")}. ${RECORDING_RULES.neverRecorded} Nothing was written.`,
      );
    }
  }
}

/**
 * Whether two mappings say the same thing about a file.
 *
 * Everything that decides what a row becomes, and nothing about who wrote it or
 * when. A seed run on a new day must not look like a changed mapping.
 */
function sameRules(a: MappingProfile, b: MappingProfile): boolean {
  const rules = (p: MappingProfile) => JSON.stringify({ grouping: p.grouping, columns: p.columns, attributes: p.attributes, exclusions: p.exclusions, families: p.families });
  return rules(a) === rules(b);
}

const store = new IngestionStore(ingestionRoot());
const ON = new Date().toISOString().slice(0, 10);

function main(): void {
  refuseSecrets();
  for (const source of SHOPIFY_PARTNERS) {
    store.saveSource(source);
    const existing = store.profiles(source.id);
    const latest = existing[existing.length - 1];
    const wanted = shopifyProfile(source, ON, source.merchantName);
    if (existing.length === 0) {
      store.saveProfile(wanted);
      console.log(`${source.name}: source and mapping v1 written, unapproved.`);
    } else if (sameRules(latest, wanted)) {
      console.log(`${source.name}: source written; mapping v${latest.version} already matches this seed, nothing added.`);
    } else {
      // A new version, never an edit. The first real preflight showed the
      // seeded rules excluding nothing at all, and a workspace seeded before
      // that still holds them: without this, re-running the seed reports
      // "already here" and leaves a person with the mapping that failed.
      // Anything approved stays approved and stays on disk; this is offered
      // beside it and a person loads and approves it.
      const version = existing.length + 1;
      store.saveProfile({ ...wanted, version });
      console.log(`${source.name}: source written; mapping v${version} added, unapproved, because the seeded rules have changed since v${latest.version}. Load it in the tool, read the counts, then approve.`);
    }
    const snapshot = join(process.cwd(), "intake", "shopify", `${source.id}.json`);
    console.log(`  snapshot: ${existsSync(snapshot) ? snapshot.replace(`${process.cwd()}/`, "") : "not fetched yet — run `npm run fetch:shopify -- " + source.id + "` on a machine that can reach the store"}`);
  }

  const dir = join(ingestionRoot(), "blocked");
  mkdirSync(dir, { recursive: true });
  for (const partner of BLOCKED_PARTNERS) {
    writeFileSync(join(dir, `${partner.id}.json`), `${JSON.stringify({ ...partner, recordedOn: ON }, null, 2)}\n`, "utf8");
    const review = partner.complianceReview === "required" ? ` compliance review required (${(partner.compliance ?? []).filter((c) => c.state === "outstanding").length} outstanding)` : "";
    console.log(`${partner.name}: ${partner.state}.${review}`);
  }
  console.log(`\nNothing is approved and nothing is imported. Open the tool to read the counts:\n  WELLNESS_INGESTION_ADMIN=1 npm run ingestion:server`);
}

if (process.argv[1]?.endsWith("seed-shopify.ts")) main();
