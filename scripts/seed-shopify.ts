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

const store = new IngestionStore(ingestionRoot());
const ON = new Date().toISOString().slice(0, 10);

function main(): void {
  refuseSecrets();
  for (const source of SHOPIFY_PARTNERS) {
    store.saveSource(source);
    const existing = store.profiles(source.id);
    if (existing.length === 0) {
      store.saveProfile(shopifyProfile(source, ON, source.merchantName));
      console.log(`${source.name}: source and mapping v1 written, unapproved.`);
    } else {
      console.log(`${source.name}: source written; ${existing.length} mapping version(s) already here, none overwritten.`);
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
