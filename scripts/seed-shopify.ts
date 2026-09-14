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
 * It also writes down the two partners that cannot be read, so the inventory
 * says why they are absent rather than leaving somebody to wonder.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { ingestionRoot } from "@/providers/ingestion/root";
import { BLOCKED_PARTNERS, SHOPIFY_PARTNERS, shopifyProfile } from "./shopify-partners";

const store = new IngestionStore(ingestionRoot());
const ON = new Date().toISOString().slice(0, 10);

function main(): void {
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
    console.log(`${partner.name}: ${partner.state}.`);
  }
  console.log(`\nNothing is approved and nothing is imported. Open the tool to read the counts:\n  WELLNESS_INGESTION_ADMIN=1 npm run ingestion:server`);
}

if (process.argv[1]?.endsWith("seed-shopify.ts")) main();
