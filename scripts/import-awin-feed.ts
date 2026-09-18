/**
 * Read the Sweat Kingdom Awin feed, audit it, and import chosen families as
 * drafts.
 *
 *   npm run feed:sweatkingdom -- --audit
 *   npm run feed:sweatkingdom
 *   npm run feed:sweatkingdom -- --write
 *   npm run feed:sweatkingdom -- --update <id>
 *   npm run feed:sweatkingdom -- --check-images
 *
 * One partner, one feed. See `src/domain/intake/awin-sweat-kingdom.ts` for why
 * this is not a general importer.
 *
 * It reports by default, creates only what is missing, and never replaces a
 * record a reviewer has touched unless that record is named. Nothing it writes
 * is published: saunas are an unpublished category and every record is a draft.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { readCsv } from "@/domain/import/csv";
import { auditFeed, buildFromFeed, isSaunaFamily, type FeedRow } from "@/domain/intake/awin-sweat-kingdom";
import { planIntake } from "@/domain/intake/plan";
import { Id, type Brand, type Merchant, type Product } from "@/domain/product";
import { loadLocalCatalog, validateCatalog, type LoadedCatalog } from "@/providers/catalog/LocalCatalogProvider";

const ROOT = process.cwd();
const CATALOG_DIR = join(ROOT, "catalog");
const FEED = join(ROOT, "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv");
const READ_ON = "2026-09-13";
const MERCHANT_ID = "sweat-kingdom-store";

/**
 * The families chosen for this preview, by a person, from the audit.
 *
 * Five of thirty-eight: three that the feed sells in one configuration and two
 * it sells in eighteen, so both shapes are exercised. Every one is classified
 * as a sauna by the feed itself.
 */
const PREVIEW_PATHS = [
  "/products/the-sweat-box-1-person",
  "/products/the-deluxe-sweat-cabin",
  "/products/the-ascent",
  "/products/the-large-barrel-sauna-6-person",
  "/products/the-summit",
];

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function recordPath(kind: "products" | "brands" | "merchants", id: string): string {
  if (!Id.safeParse(id).success) throw new Error(`"${id}" is not a record id.`);
  const path = resolve(CATALOG_DIR, kind, `${id}.json`);
  if (!path.startsWith(resolve(CATALOG_DIR) + sep)) throw new Error(`Refusing to write outside the catalogue: ${path}`);
  return path;
}

function write(kind: "products" | "brands" | "merchants", id: string, data: unknown): void {
  mkdirSync(join(CATALOG_DIR, kind), { recursive: true });
  writeFileSync(recordPath(kind, id), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function rowsFromFeed(): FeedRow[] {
  if (!existsSync(FEED)) die(`No feed at ${FEED}.`);
  const text = readFileSync(FEED, "utf8");
  const table = readCsv(text, Buffer.byteLength(text, "utf8"));
  if (!table.ok) die(`The feed could not be read: ${table.reason}`);
  return table.rows.map((row) => Object.fromEntries(table.headers.map((h, i) => [h, row[i] ?? ""])));
}

const args = process.argv.slice(2);
const rows = rowsFromFeed();

if (args.includes("--audit")) {
  const audit = auditFeed(rows);
  console.log(`${audit.rows} rows, ${audit.families.length} product families, ${audit.populated.length} columns carrying a value, ${audit.empty.length} empty in every row.`);
  console.log(`\nEmpty in every row: ${audit.empty.join(", ")}`);
  console.log(`\n${"rows".padStart(5)} ${"imgs".padStart(5)} ${"stock".padStart(6)}  ${"price".padEnd(20)} ${"sauna?".padEnd(7)} path`);
  for (const f of audit.families) {
    const range = f.minMinor === f.maxMinor ? `$${(f.minMinor / 100).toLocaleString("en-US")}` : `$${(f.minMinor / 100).toLocaleString("en-US")}-$${(f.maxMinor / 100).toLocaleString("en-US")}`;
    console.log(`${String(f.rows.length).padStart(5)} ${String(f.imageCount).padStart(5)} ${String(f.inStock).padStart(6)}  ${range.padEnd(20)} ${(isSaunaFamily(f) ? "yes" : "no").padEnd(7)} ${f.path}`);
  }
  const saunas = audit.families.filter(isSaunaFamily);
  console.log(`\n${saunas.length} families the feed classifies as saunas, ${saunas.reduce((n, f) => n + f.rows.length, 0)} rows.`);
  process.exit(0);
}

async function checkImages(): Promise<never> {
  // Reachability only. Nothing is downloaded, stored or republished, and a
  // reachable image is not a licensed one.
  const audit = auditFeed(rows);
  const urls = [...new Set(audit.families.filter((f) => PREVIEW_PATHS.includes(f.path)).map((f) => (f.chosen.image_link ?? "").trim()))];
  console.log(`Checking ${urls.length} image URLs from the chosen families.\n`);
  let reachable = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      const type = res.headers.get("content-type") ?? "";
      const ok = res.ok && type.startsWith("image/");
      if (ok) reachable++;
      console.log(`  ${ok ? "ok  " : "FAIL"} ${res.status} ${type || "(no type)"}  ${url}`);
    } catch (e) {
      console.log(`  FAIL unreachable from here: ${e instanceof Error ? e.message : String(e)}\n       ${url}`);
    }
  }
  console.log(`\n${reachable} of ${urls.length} reachable as images.`);
  process.exit(reachable === urls.length ? 0 : 1);
}

function runImport(): void {
  const doWrite = args.includes("--write");
  const updateAt = args.indexOf("--update");
  const updateId = updateAt === -1 ? undefined : args[updateAt + 1];
  if (updateAt !== -1 && !updateId) die("--update needs the id of the record to replace.");
  if (doWrite && updateId) die("Use --write or --update, not both.");

  const built = buildFromFeed(rows, { paths: PREVIEW_PATHS, readOn: READ_ON, feedFile: "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv", merchantId: MERCHANT_ID, categoryId: "saunas" });
  for (const r of built.refusals) {
    console.log(`\n${r.path} was not built:`);
    for (const reason of r.reasons) console.log(`  - ${reason}`);
  }
  if (built.products.length === 0) die("\nNothing could be built, so nothing was written.");

  const catalog: LoadedCatalog = loadLocalCatalog(CATALOG_DIR);
  const plan = planIntake(catalog.products, built.products);
  console.log(`\n${built.products.length} records from ${PREVIEW_PATHS.length} chosen families.`);
  for (const r of plan.records) {
    const mark = r.action === "create" ? "new      " : r.action === "unchanged" ? "unchanged" : "DIFFERS  ";
    console.log(`  ${mark} ${r.id}${r.reviewed ? "   (no longer a draft: a person has moved this on)" : ""}`);
    if (r.differences.length > 0) console.log(`            disagrees on: ${r.differences.join(", ")}`);
  }

  const creating = built.products.filter((p) => plan.creates.includes(p.id));
  const replacing = updateId ? built.products.filter((p) => p.id === updateId) : [];
  if (updateId && replacing.length === 0) die(`\n"${updateId}" is not a record this feed builds.`);
  const toWrite = doWrite ? creating : replacing;

  if (!doWrite && !updateId) {
    console.log(`\nReport only. ${plan.creates.length} would be created, ${plan.differs.length} differ and would be left alone, ${plan.unchanged.length} already match.`);
    console.log(`Write the new ones:       npm run feed:sweatkingdom -- --write`);
    if (plan.differs.length > 0) console.log(`Replace one that differs: npm run feed:sweatkingdom -- --update ${plan.differs[0]}`);
    process.exit(0);
  }
  if (toWrite.length === 0) {
    console.log("\nNothing to write.");
    process.exit(0);
  }

  const ids = new Set(toWrite.map((p) => p.id));
  const merged: LoadedCatalog = {
    categories: catalog.categories,
    products: [...catalog.products.filter((p) => !ids.has(p.id)), ...toWrite],
    brands: [...catalog.brands.filter((b) => !built.brands.some((x) => x.id === b.id)), ...built.brands],
    merchants: [...catalog.merchants.filter((m) => m.id !== built.merchant.id), built.merchant],
  };
  const issues = validateCatalog(merged);
  if (issues.length > 0) die(["\nRefused. The catalogue would not be valid with these records in it, so nothing was written.", ...issues.map((i) => `  ${i.file}: ${i.message}`)].join("\n"));

  for (const b of built.brands.filter((b: Brand) => !catalog.brands.some((x) => x.id === b.id))) write("brands", b.id, b);
  const m: Merchant = built.merchant;
  write("merchants", m.id, m);
  for (const p of toWrite as Product[]) write("products", p.id, p);
  console.log(`\nWrote ${toWrite.length} product${toWrite.length === 1 ? "" : "s"}. Every one is a draft in an unpublished category.`);
}

if (args.includes("--check-images")) {
  void checkImages();
} else {
  runImport();
}
