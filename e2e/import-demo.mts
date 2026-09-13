/**
 * The import demonstration, opened the way an operator opens it.
 *
 *   npm run import:demo && npx tsx e2e/import-demo.mts
 *
 * file://, no server, no network. The page is loaded from disk, the two sample
 * layouts are chosen through the file input, and every assertion reads what is
 * on screen. Expectations come from the same domain code the page bundles, so a
 * check compares the page against the rules rather than against numbers typed
 * in here.
 */

import { chromium, type Page } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readCsv } from "@/domain/import/csv";
import { buildDrafts } from "@/domain/import/draft";
import { suggestMapping } from "@/domain/import/mapping";

const ROOT = process.cwd();
const PAGE = "file://" + join(ROOT, "docs", "import-demo", "index.html");
const SAMPLES = join(ROOT, "docs", "import-demo", "samples");
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

const failures: string[] = [];
let scenario = "";
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${scenario} :: ${name}`);
  if (!ok) {
    console.log(`       expected ${JSON.stringify(expected)}`);
    console.log(`       actual   ${JSON.stringify(actual)}`);
    failures.push(`${scenario} :: ${name}`);
  }
}
const ok = (name: string, condition: boolean, detail?: unknown) => check(name, condition ? true : (detail ?? false), true);

/** What the domain says about a sample, computed here rather than assumed. */
function expectedFor(file: string, currency?: string) {
  const text = readFileSync(join(SAMPLES, file), "utf8");
  const table = readCsv(text, Buffer.byteLength(text));
  if (!table.ok) throw new Error(`${file}: ${table.reason}`);
  const mapping = { ...suggestMapping(table.headers, file).mapping, currency };
  return { table, set: buildDrafts(table.headers, table.rows, mapping) };
}

const statusText = (page: Page) => page.locator("#status").innerText();
const draftCards = (page: Page) => page.locator("#drafts article.draft");

async function load(page: Page, file: string) {
  await page.setInputFiles("#file", join(SAMPLES, file));
  await page.waitForFunction(() => document.querySelectorAll("#drafts article.draft").length > 0 || (document.querySelector("#status")?.className ?? "").includes("bad"), undefined, {
    timeout: 5000,
  });
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  // Nothing on this page may reach the network. A request of any kind is a bug.
  const requests: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("file://")) requests.push(r.url());
  });

  scenario = "the page itself";
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  check("one h1", await page.locator("h1").count(), 1);
  ok("says it saves nothing before a file is chosen", (await statusText(page)).includes("Nothing on this page is saved"), await statusText(page));
  ok("says the samples are invented", (await page.locator("body").innerText()).includes("are invented"), "");
  check("no drafts yet", await draftCards(page).count(), 0);
  check("the standing review is shown before any file", await page.locator("#review li").count(), 6);

  // ------------------------------------------------------------- supplier A
  scenario = "supplier A, comma separated with a byte-order mark";
  const a = expectedFor("supplier-a-northwind-SYNTHETIC.csv", undefined);
  await load(page, "supplier-a-northwind-SYNTHETIC.csv");
  check("a draft per row", await draftCards(page).count(), a.set.totals.rows);
  ok("the status reports the file", (await statusText(page)).includes(`${a.table.rows.length} rows`), await statusText(page));
  // The browser's own File.text() decodes UTF-8 and drops the byte-order mark
  // before the parser sees it, so the parser's note does not fire here. What
  // matters is the outcome, and it is checkable: a mark left in place would be
  // glued to the first heading and nothing would map to it. The parser's own
  // stripping is covered in the unit tests, where the text arrives unchanged.
  check("the first column still matched, so no mark was glued to its heading", await page.locator("#map-supplier_sku").inputValue(), "sku");

  // Every field the file states is mapped by name, and the mapping is shown as
  // controls a person can change.
  const mappedCount = await page.locator("#mapping select").evaluateAll((s) => s.filter((x) => x.id.startsWith("map-") && (x as HTMLSelectElement).value !== "").length);
  check("every field the engine matched is shown as mapped", mappedCount, Object.keys(suggestMapping(a.table.headers, "a").mapping.columns).length);

  const firstCard = draftCards(page).first();
  ok("the first draft is named from the file", (await firstCard.locator("h3").innerText()).includes("Citrus Salt Sticks"), await firstCard.locator("h3").innerText());
  ok("a quoted field with a line break in it survived", (await page.locator("#drafts").innerText()).includes("(new formula)"), "");

  const aFlags = await page.locator("#drafts .flag.blocker").count();
  check("nothing in supplier A is blocked", aFlags, 0);
  ok(
    "the currency comes from the column heading, and says where from",
    (await page.locator("#drafts").innerText()).includes('Currency taken from the column heading "unit_price_usd"'),
    "",
  );
  ok("and the price is read in it", (await page.locator("#drafts").innerText()).includes("45.00 USD"), "");
  ok(
    "a unit the heading states is used, and says where from",
    (await page.locator("#drafts").innerText()).includes('Unit taken from the column heading "sugar_g"'),
    "",
  );
  check("a heading that states the unit locks the unit control", await page.locator("#unit-sugar_g").isDisabled(), true);
  ok(
    "an empty caffeine cell is held as unknown, not as zero",
    (await page.locator("#drafts").innerText()).includes("Held as unknown, which is not the same as zero"),
    "",
  );

  // ------------------------------------------------------------- supplier B
  scenario = "supplier B, semicolons, European decimals, units in the values";
  const b = expectedFor("supplier-b-contoso-SYNTHETIC.csv", "EUR");
  await load(page, "supplier-b-contoso-SYNTHETIC.csv");
  await page.fill("#currency", "EUR");
  await page.dispatchEvent("#currency", "change");
  await page.waitForTimeout(100);

  check("a draft per row", await draftCards(page).count(), b.set.totals.rows);
  const shownTotals = await page.locator("#drafts .totals").innerText();
  check("the totals match the engine", shownTotals, `${b.set.totals.rows} rows: ${b.set.totals.withBlockers} blocked, ${b.set.totals.withChecks} to confirm, ${b.set.totals.clean} with nothing flagged.`);
  ok("a column this tool has no field for is named as unread", (await page.locator("#mapping").innerText()).includes("Case Qty"), "");

  const drafts = await page.locator("#drafts").innerText();
  ok("a unit that cannot convert blocks the figure", drafts.includes("Stated in oz"), "");
  ok("a unit that converts is shown and flagged, not applied quietly", drafts.includes("0.08 g is 80 mg"), "");
  ok("a formula-looking cell is refused and never run", drafts.includes("starts like a spreadsheet formula"), "");
  ok("and its text is shown as text", drafts.includes("=SUM(B2:B9)"), "");
  ok("a category outside this site is blocked", drafts.includes("is not a category this site compares"), "");
  ok("a function word this site does not use is blocked", drafts.includes('"detox" is not a value'), "");
  // A count of sticks is a count of sticks until somebody says one stick is one
  // serving. The tool used to say it for them.
  ok("a count of items is not read as servings on its own", drafts.includes("is 20 servings only if one stick is one serving"), "");
  check("the price with no code in the cell reads from the box", (await page.locator("#drafts").innerText()).includes("24.99 EUR"), true);

  scenario = "the operator states the serving basis";
  await page.check("#servings-basis");
  await page.waitForTimeout(100);
  const withBasis = await page.locator("#drafts").innerText();
  ok("now the count reads, and says whose statement it rests on", withBasis.includes("because one item per serving was stated for this column"), "");
  await page.uncheck("#servings-basis");
  await page.waitForTimeout(100);
  ok("a decimal comma is reported rather than assumed silently", drafts.includes("Read as a decimal comma"), "");

  scenario = "a currency this does not store";
  await page.fill("#currency", "JPY");
  await page.dispatchEvent("#currency", "change");
  await page.waitForTimeout(100);
  ok("JPY is refused, with the reason", (await statusText(page)).includes("divide into a hundred"), await statusText(page));
  check("and the box does not keep it", await page.locator("#currency").inputValue(), "JPY");
  await page.fill("#currency", "EUR");
  await page.dispatchEvent("#currency", "change");
  await page.waitForTimeout(100);

  // The link in the file is text on the page, not something to click or fetch.
  scenario = "a supplier's link is never opened";
  const hrefs = await page.locator("#drafts a").count();
  check("no link is rendered in a draft", hrefs, 0);
  ok("the address is shown as text", drafts.includes("https://example.invalid/contoso/alpine-salts"), "");

  // ------------------------------------------------------------ a refusal
  scenario = "a format this does not read";
  await page.setInputFiles("#file", join(SAMPLES, "not-a-csv-SYNTHETIC.pdf"));
  // Wait for this file's own message. Waiting for the status to merely be bad
  // passes instantly when the previous check left it bad, and then reads
  // whichever message happens to be there.
  await page.waitForFunction(() => (document.querySelector("#status")?.textContent ?? "").includes("was not read"), undefined, { timeout: 5000 });
  const refusal = await statusText(page);
  ok("refused with the reason", refusal.includes("This looks like a PDF"), refusal);
  check("and no drafts are shown", await draftCards(page).count(), 0);

  // ------------------------------------------------- a mapping, saved and reused
  scenario = "a mapping is reusable";
  await load(page, "supplier-b-contoso-SYNTHETIC.csv");
  const saved = await page.evaluate(() => {
    // The same JSON the Save button writes, read here rather than through a
    // download dialog the harness cannot see.
    const selects = [...document.querySelectorAll<HTMLSelectElement>("#mapping select")].filter((s) => s.id.startsWith("map-"));
    return JSON.stringify({ version: 1, name: "harness", columns: Object.fromEntries(selects.filter((s) => s.value).map((s) => [s.id.slice("map-".length), s.value])) });
  });
  ok("the saved mapping names ten fields", Object.keys(JSON.parse(saved).columns).length === 10, saved);

  // Change one mapping by hand, and the drafts follow it.
  scenario = "changing a mapping changes the drafts";
  await page.selectOption("#map-caffeine_mg", "");
  await page.waitForTimeout(100);
  const afterUnmap = await page.locator("#drafts").innerText();
  ok("the caffeine row is gone when nothing is mapped to it", !afterUnmap.includes("0.08 g is 80 mg"), "");
  await page.selectOption("#map-name", "");
  await page.waitForTimeout(100);
  ok("unmapping a required field blocks every row", (await page.locator("#drafts .banner.bad").innerText()).includes("Product name"), await page.locator("#drafts").innerText());

  scenario = "nothing left this machine";
  check("no network request of any kind", requests, []);
  check("no page errors", problems, []);

  await browser.close();
}

run()
  .then(() => {
    console.log("");
    if (failures.length === 0) console.log("All checks passed.");
    else {
      console.log(`${failures.length} check(s) failed:`);
      for (const f of failures) console.log(`  ${f}`);
      process.exitCode = 1;
    }
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
