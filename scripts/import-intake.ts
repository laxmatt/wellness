/**
 * Import an approved reading into the catalogue as drafts.
 *
 *   npm run intake -- intake/saunas/2026-09-13-approved.json
 *   npm run intake -- intake/saunas/2026-09-13-approved.json --write
 *   npm run intake -- intake/saunas/2026-09-13-approved.json --update <id>
 *
 * Reports by default. `--write` creates records that are not there yet and
 * touches nothing else. `--update` replaces one named record, because replacing
 * a record a reviewer may have edited is a decision somebody makes about that
 * record, not a side effect of running an import twice.
 *
 * What it will not do:
 *   - publish. Every record it writes is a draft, and every shopper read in
 *     `src/lib/queries.ts` asks for published records only.
 *   - replace an existing record without being told to, by name.
 *   - write anything until the whole merged catalogue validates.
 *   - invent a price, a link, an image or a stock claim. See
 *     `src/domain/intake/record.ts`.
 *   - reach the network. The file was read elsewhere and is read here as text.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { IntakeFile, toCatalogRecords } from "@/domain/intake/record";
import { planIntake } from "@/domain/intake/plan";
import { Id, type Brand, type Merchant, type Product } from "@/domain/product";
import { loadLocalCatalog, validateCatalog, type LoadedCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { allCategories, categoryById } from "@/domain/categories";

const ROOT = process.cwd();
const CATALOG_DIR = join(ROOT, "catalog");
/** A file of readings is a few kilobytes. Anything large enough to matter is not one. */
const MAX_INTAKE_BYTES = 512_000;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Built from a validated id, and checked to land inside the catalogue. */
function recordPath(kind: "products" | "brands" | "merchants", id: string): string {
  if (!Id.safeParse(id).success) throw new Error(`"${id}" is not a record id.`);
  const path = resolve(CATALOG_DIR, kind, `${id}.json`);
  if (!path.startsWith(resolve(CATALOG_DIR) + sep)) throw new Error(`Refusing to write outside the catalogue: ${path}`);
  return path;
}

function write(kind: "products" | "brands" | "merchants", id: string, data: unknown): void {
  const path = recordPath(kind, id);
  mkdirSync(join(CATALOG_DIR, kind), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--")) ?? die("Give the intake file: npm run intake -- <path>");
const doWrite = args.includes("--write");
const updateAt = args.indexOf("--update");
const updateId = updateAt === -1 ? undefined : args[updateAt + 1];
if (updateAt !== -1 && !updateId) die("--update needs the id of the record to replace.");
if (doWrite && updateId) die("Use --write or --update, not both. One creates what is missing; the other replaces one named record.");

if (!existsSync(file)) die(`No file at ${file}.`);
const raw = readFileSync(file, "utf8");
if (Buffer.byteLength(raw, "utf8") > MAX_INTAKE_BYTES) die(`${file} is larger than ${MAX_INTAKE_BYTES / 1000} kB, which is not the shape of a reading.`);

let json: unknown;
try {
  json = JSON.parse(raw);
} catch (e) {
  die(`${file} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
}
const parsedFile = IntakeFile.safeParse(json);
if (!parsedFile.success) die(`${file} is not an intake file:\n${z.prettifyError(parsedFile.error)}`);
const intake = parsedFile.data;

if (!categoryById(intake.categoryId)) {
  die(`No category "${intake.categoryId}". This repository holds ${allCategories.map((c) => c.id).join(", ")}.`);
}

const { records, refusals } = toCatalogRecords(intake);
for (const refusal of refusals) {
  console.log(`\n${refusal.key} was not built:`);
  for (const reason of refusal.reasons) console.log(`  - ${reason}`);
}
if (records.products.length === 0) die("\nNothing could be built from this file, so nothing was written.");

const catalog: LoadedCatalog = loadLocalCatalog(CATALOG_DIR);
const plan = planIntake(catalog.products, records.products);

console.log(`\n${file}: ${intake.products.length} readings, ${records.products.length} records built, category "${intake.categoryId}".`);
for (const r of plan.records) {
  const mark = r.action === "create" ? "new      " : r.action === "unchanged" ? "unchanged" : "DIFFERS  ";
  console.log(`  ${mark} ${r.id}${r.reviewed ? "   (no longer a draft: a person has moved this on)" : ""}`);
  if (r.differences.length > 0) console.log(`            the catalogue and the reading disagree on: ${r.differences.join(", ")}`);
}

// Which records this run would actually write. Never a record that exists,
// unless it was named.
const creating = records.products.filter((p) => plan.creates.includes(p.id));
const replacing = updateId ? records.products.filter((p) => p.id === updateId) : [];
if (updateId && replacing.length === 0) die(`\n"${updateId}" is not a record in this intake file.`);

const toWrite = doWrite ? creating : replacing;
if (!doWrite && !updateId) {
  console.log(`\nReport only. ${plan.creates.length} would be created, ${plan.differs.length} differ and would be left alone, ${plan.unchanged.length} are already as the reading says.`);
  console.log(`Write the new ones:        npm run intake -- ${file} --write`);
  if (plan.differs.length > 0) console.log(`Replace one that differs:  npm run intake -- ${file} --update ${plan.differs[0]}`);
  process.exit(0);
}
if (toWrite.length === 0) {
  console.log("\nNothing to write.");
  process.exit(0);
}

// Everything, merged, before anything is written. A record that would make the
// catalogue invalid is not a record to fix afterwards.
const writingIds = new Set(toWrite.map((p) => p.id));
const merged: LoadedCatalog = {
  categories: catalog.categories,
  products: [...catalog.products.filter((p) => !writingIds.has(p.id)), ...toWrite],
  brands: [...catalog.brands.filter((b) => !records.brands.some((x) => x.id === b.id)), ...records.brands],
  merchants: [...catalog.merchants.filter((m) => !records.merchants.some((x) => x.id === m.id)), ...records.merchants],
};
const issues = validateCatalog(merged);
if (issues.length > 0) {
  die(["\nRefused. The catalogue would not be valid with these records in it, so nothing was written.", ...issues.map((i) => `  ${i.file}: ${i.message}`)].join("\n"));
}

const newBrands = records.brands.filter((b: Brand) => !catalog.brands.some((x) => x.id === b.id));
const newMerchants = records.merchants.filter((m: Merchant) => !catalog.merchants.some((x) => x.id === m.id));
for (const b of newBrands) write("brands", b.id, b);
for (const m of newMerchants) write("merchants", m.id, m);
for (const p of toWrite as Product[]) write("products", p.id, p);

console.log(`\nWrote ${toWrite.length} product${toWrite.length === 1 ? "" : "s"}, ${newBrands.length} brand${newBrands.length === 1 ? "" : "s"}, ${newMerchants.length} merchant${newMerchants.length === 1 ? "" : "s"}.`);
console.log("Every product is a draft. Nothing is in the storefront, and the sauna category is not published.");
console.log("Read one:  npm run catalog:check");
