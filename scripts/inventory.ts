/**
 * Stage a supplier file into a local preview catalogue, review it, and publish
 * it to the storefront on this machine.
 *
 *   npm run inventory -- stage --file docs/import-demo/samples/supplier-a-northwind-SYNTHETIC.csv \
 *     --supplier "Northwind Hydration" --priced-on 2026-09-12
 *   npm run inventory -- list
 *   npm run inventory -- show <id>
 *   npm run inventory -- approve <id>
 *   npm run inventory -- hide <id>
 *   npm run inventory -- unhide <id>
 *   npm run inventory -- remove <id>
 *   npm run inventory -- clear
 *
 * The same operations in a browser, on this machine:
 *
 *   WELLNESS_PREVIEW_INVENTORY=1 npm run inventory:review
 *
 * A command line, not a route. There is no HTTP endpoint here, so there is
 * nothing to leave unauthenticated: the only way to reach this is a shell on
 * the machine the catalogue lives on.
 *
 * This file parses arguments and prints. The rules live in
 * `src/domain/inventory/` and the writing in `PreviewStore`, so the tests
 * exercise the same code an operator does rather than a copy of it.
 *
 * What it will not do:
 *   - write anywhere but `catalog-preview/`. See `PreviewStore`.
 *   - touch `catalog/`. The preview catalogue only ever adds records, and a
 *     staged record that collides with a real id or slug is refused.
 *   - write anything at all until the merged catalogue still validates.
 *   - run where this is not somebody's own machine. Every command asks
 *     `previewInventoryDecision` first, and the flag alone is not enough.
 *   - publish anywhere. "Published" here means visible in the storefront
 *     running on this machine.
 *   - reach the network, call a model, or open any address in a file.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, readCsv } from "@/domain/import/csv";
import { buildDrafts } from "@/domain/import/draft";
import { MAX_MAPPING_BYTES, parseMapping, suggestMapping, type ColumnMapping } from "@/domain/import/mapping";
import { SUPPORTED_CURRENCIES } from "@/domain/import/values";
import { previewFileName } from "@/domain/inventory/identity";
import { stageDrafts } from "@/domain/inventory/stage";
import { STATUS_WORDS, transition, type InventoryAction } from "@/domain/inventory/status";
import type { ProductStatus } from "@/domain/product";
import { PREVIEW_INVENTORY_FLAG, previewInventoryDecision } from "@/lib/preview-inventory";
import { loadLocalCatalog, type CatalogRecords } from "@/providers/catalog/LocalCatalogProvider";
import { PreviewStore, refusalsFor } from "@/providers/catalog/PreviewStore";

const ROOT = process.cwd();
const CATALOG_DIR = join(ROOT, "catalog");
const store = new PreviewStore(join(ROOT, "catalog-preview"));

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Nothing is written until the whole merged catalogue still validates. */
function assertMergeable(records: CatalogRecords): void {
  const refusals = refusalsFor(loadLocalCatalog(CATALOG_DIR), records);
  if (refusals.length === 0) return;
  die(["Refused. The catalogue would not be valid with these records in it, so nothing was written.", ...refusals.map((r) => `  ${r}`)].join("\n"));
}

// ---------------------------------------------------------------- arguments

type Args = { command: string; positional: string[]; flags: Map<string, string | true> };

const FLAGS_WITH_VALUES = new Set(["file", "supplier", "priced-on", "mapping", "currency"]);
const BOOLEAN_FLAGS = new Set(["servings-basis", "replace"]);

function parseArgs(argv: string[]): Args {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = (eq === -1 ? arg.slice(2) : arg.slice(2, eq)).trim();
    // A repeated flag is refused rather than resolved. Deciding that the first
    // one wins, or the last, is a decision somebody has to be told about.
    if (flags.has(name)) die(`--${name} was given more than once. Give it once.`);
    if (BOOLEAN_FLAGS.has(name)) {
      if (eq !== -1) die(`--${name} takes no value.`);
      flags.set(name, true);
      continue;
    }
    if (!FLAGS_WITH_VALUES.has(name)) die(`--${name} is not a flag this command knows.`);
    const value = eq === -1 ? rest[++i] : arg.slice(eq + 1);
    if (value === undefined || value.startsWith("--")) die(`--${name} needs a value.`);
    flags.set(name, value);
  }
  return { command: command ?? "", positional, flags };
}

const stringFlag = (args: Args, name: string): string | undefined => {
  const v = args.flags.get(name);
  return typeof v === "string" ? v : undefined;
};

/** A calendar date, round-tripped, so 2026-02-30 is refused rather than rolled over. */
function readDate(text: string, what: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) die(`${what} has to be a date written YYYY-MM-DD. "${text}" is not.`);
  const d = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text) die(`${what} "${text}" is not a date on the calendar.`);
  return text;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function readTextFile(path: string, limitBytes: number, what: string): string {
  if (!existsSync(path)) die(`No file at ${path}.`);
  const size = statSync(path).size;
  if (size > limitBytes) die(`${what} is ${Math.round(size / 1000)} kB. This reads up to ${Math.round(limitBytes / 1000)} kB.`);
  return readFileSync(path, "utf8");
}

// ------------------------------------------------------------------ staging

function stage(args: Args): void {
  const file = stringFlag(args, "file") ?? die("stage needs --file <path to a supplier CSV>.");
  const supplier = stringFlag(args, "supplier") ?? die('stage needs --supplier "<who supplied this file>". The file rarely says, and a price belongs to a named merchant.');
  const pricedOn = readDate(
    stringFlag(args, "priced-on") ?? die("stage needs --priced-on YYYY-MM-DD: the date you state these prices were current. The date you downloaded the file is not that date."),
    "--priced-on",
  );

  const text = readTextFile(file, LIMITS.bytes, "This file");
  const table = readCsv(text, Buffer.byteLength(text, "utf8"));
  if (!table.ok) die(`Refused: ${table.reason}`);
  for (const note of table.notes) console.log(`Note: ${note}`);
  if (table.truncated > 0) console.log(`Note: ${table.truncated} rows past the ${LIMITS.rows}-row limit were not read.`);

  let mapping: ColumnMapping;
  const mappingPath = stringFlag(args, "mapping");
  if (mappingPath) {
    const parsed = parseMapping(readTextFile(mappingPath, MAX_MAPPING_BYTES, "This mapping file"), table.headers);
    if (!parsed.ok) die(`Refused: ${parsed.reason}`);
    for (const note of parsed.notes) console.log(`Mapping: ${note}`);
    mapping = parsed.mapping;
  } else {
    const suggestion = suggestMapping(table.headers, "Suggested");
    for (const h of suggestion.unmapped) console.log(`Unread column: "${h}"`);
    mapping = suggestion.mapping;
  }

  const currency = stringFlag(args, "currency");
  if (currency) {
    const code = currency.toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(code)) die(`--currency ${currency} is not a currency this reads. It handles ${SUPPORTED_CURRENCIES.join(", ")}.`);
    mapping = { ...mapping, currency: code };
  }
  if (args.flags.get("servings-basis") === true) mapping = { ...mapping, servingsBasis: true };

  const drafts = buildDrafts(table.headers, table.rows, mapping);
  const result = stageDrafts(drafts, { supplierName: supplier, sourceFile: file, pricedOn, stagedOn: today() });

  if (result.fatal.length > 0) die(["Nothing can be staged from this file.", ...result.fatal.map((f) => `  ${f}`)].join("\n"));

  for (const refusal of result.refusals) {
    console.log(`\nRow ${refusal.row} (${refusal.label}) was not staged:`);
    for (const reason of refusal.reasons) console.log(`  - ${reason}`);
  }
  if (result.staged.length === 0) die("\nNo row could be staged. Nothing was written.");

  const existing = store.records();
  const clashes = result.staged.filter((s) => existing.products.some((p) => p.id === s.product.id));
  if (clashes.length > 0 && args.flags.get("replace") !== true) {
    die(
      [
        `\n${clashes.length} of these are already staged: ${clashes.map((c) => c.product.id).join(", ")}.`,
        "Re-staging would throw away any edits made to them and reset an approved record to a draft.",
        "Pass --replace if that is what you want, or remove them first.",
      ].join("\n"),
    );
  }

  const stagedIds = new Set(result.staged.map((s) => s.product.id));
  assertMergeable({
    products: [...existing.products.filter((p) => !stagedIds.has(p.id)), ...result.staged.map((s) => s.product)],
    brands: [...existing.brands.filter((b) => !result.brands.some((x) => x.id === b.id)), ...result.brands],
    merchants: [...existing.merchants.filter((m) => m.id !== result.merchant?.id), ...(result.merchant ? [result.merchant] : [])],
  });

  if (result.merchant) store.write("merchants", result.merchant.id, result.merchant);
  for (const brand of result.brands) store.write("brands", brand.id, brand);
  for (const s of result.staged) store.write("products", s.product.id, s.product);

  console.log(`\nStaged ${result.staged.length} of ${drafts.totals.rows} rows as drafts in catalog-preview/.`);
  for (const s of result.staged) console.log(`  ${s.product.id}  (row ${s.row})`);
  console.log("\nNothing is visible in the storefront yet. Every one of these is a draft, and every shopper read asks for published records only.");
  console.log(`Read one with:    npm run inventory -- show ${result.staged[0].product.id}`);
  console.log(`Then approve it:  npm run inventory -- approve ${result.staged[0].product.id}`);
}

// ---------------------------------------------------------------- reviewing

function list(): void {
  const records = store.records();
  if (records.products.length === 0) {
    console.log('Nothing is staged. Run: npm run inventory -- stage --file <csv> --supplier "<name>" --priced-on YYYY-MM-DD');
    return;
  }
  const order: ProductStatus[] = ["draft", "published", "hidden", "discontinued"];
  const sorted = [...records.products].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.id.localeCompare(b.id));
  for (const p of sorted) console.log(`${p.status.padEnd(10)} ${p.id}\n           ${p.name}`);
  console.log(`\n${records.products.length} staged, ${records.products.filter((p) => p.status === "published").length} in the storefront.`);
}

const WITHHELD = [
  "",
  "  Every figure above reads as demo data or as not stated, so none of them",
  "  answers a filter, ranks this product or reaches the assistant. That is not",
  "  a defect in the import: it is what a figure from an invented file is worth.",
  "  A figure becomes a fact here when a reviewer records where it came from.",
].join("\n");

function show(id: string): void {
  const p = attempt(() => store.product(id));
  console.log(p.name);
  console.log(`  id        ${p.id}   (the supplier's own code is not this: it is in identifiers.merchantSkus)`);
  console.log(`  status    ${STATUS_WORDS[p.status]}`);
  console.log(`  brand     ${p.brandId}`);
  console.log(`  source    ${p.source.ref ?? "not recorded"}`);
  for (const [merchantId, sku] of Object.entries(p.identifiers.merchantSkus)) console.log(`  sku       ${sku} at ${merchantId}`);
  for (const o of p.offers) console.log(`  offer     ${(o.priceMinor / 100).toFixed(2)} ${o.currency} at ${o.merchantId}, stated current on ${o.lastChecked}\n            ${o.url}`);
  console.log("  figures");
  for (const [key, sv] of Object.entries(p.attributes)) {
    const value = sv.value === undefined ? "not stated in the file" : JSON.stringify(sv.value);
    console.log(`    ${key.padEnd(20)} ${value}   [${sv.verification}]`);
  }
  console.log(WITHHELD);
  console.log(`\nEdit it at catalog-preview/products/${previewFileName(p.id)} and run show again, or edit it in a browser:`);
  console.log(`  ${PREVIEW_INVENTORY_FLAG}=1 npm run inventory:review`);
}

// --------------------------------------------------------------- publishing

function act(id: string, action: InventoryAction): void {
  const product = attempt(() => store.product(id));
  const next = transition(product.status, action);
  if (!next.ok) die(`"${id}": ${next.error}`);
  const updated = { ...product, status: next.to };
  const records = store.records();
  assertMergeable({ ...records, products: records.products.map((p) => (p.id === id ? updated : p)) });
  store.write("products", id, updated);
  console.log(`${id} is now ${STATUS_WORDS[next.to]}.`);
  if (next.to === "published") {
    console.log(WITHHELD);
    console.log(`\nStart the site with ${PREVIEW_INVENTORY_FLAG}=1 to see it.`);
  }
}

function attempt<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    return die(e instanceof Error ? e.message : String(e));
  }
}

// --------------------------------------------------------------------- main

const args = parseArgs(process.argv.slice(2));

const decision = previewInventoryDecision(process.env);
if (!decision.allowed) {
  die(
    [
      "Refused.",
      `  ${decision.reason}`,
      "",
      "This tool writes invented products into a local preview catalogue. It runs on",
      `an operator's own machine and nowhere else. Set ${PREVIEW_INVENTORY_FLAG}=1 to use it:`,
      "",
      `  ${PREVIEW_INVENTORY_FLAG}=1 npm run inventory -- list`,
    ].join("\n"),
  );
}

switch (args.command) {
  case "stage":
    stage(args);
    break;
  case "list":
    list();
    break;
  case "show":
    show(args.positional[0] ?? die("show needs a record id."));
    break;
  case "approve":
  case "hide":
  case "unhide":
    act(args.positional[0] ?? die(`${args.command} needs a record id.`), args.command);
    break;
  case "remove":
    attempt(() => store.remove(args.positional[0] ?? die("remove needs a record id.")));
    console.log(`${args.positional[0]} is gone from the preview catalogue. Nothing in catalog/ was touched.`);
    break;
  case "clear": {
    const removed = store.clear();
    console.log(`Removed ${removed} preview record${removed === 1 ? "" : "s"}. Nothing in catalog/ was touched.`);
    break;
  }
  default:
    die(
      [
        "npm run inventory -- <command>",
        "",
        '  stage --file <csv> --supplier "<name>" --priced-on YYYY-MM-DD',
        "        [--mapping <json>] [--currency USD] [--servings-basis] [--replace]",
        "  list",
        "  show <id>",
        "  approve <id>      draft or hidden -> in the storefront on this machine",
        "  hide <id>         published -> out of the storefront, still staged",
        "  unhide <id>       hidden -> back in the storefront",
        "  remove <id>       gone from the preview catalogue",
        "  clear             every preview record gone",
      ].join("\n"),
    );
}
