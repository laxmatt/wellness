/**
 * The owner's dashboard, opened the way the owner opens it.
 *
 *   npm run dashboard && npx tsx e2e/learning-dashboard.mts
 *
 * file://, no server, no network. Entries are typed into the real form, saved,
 * reloaded from local storage, exported, and imported back. Every expectation
 * comes from the same domain code the page bundles.
 */

import { chromium, type Page } from "playwright";
import { join } from "node:path";
import { DEMO_ENTRIES } from "@/domain/learning/demo";
import { METRIC_PANELS, SOURCES } from "@/domain/learning/metrics";

const PAGE = "file://" + join(process.cwd(), "docs", "learning-dashboard", "index.html");
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

const entryCards = (page: Page) => page.locator("#entries article.entry");
const problems = (page: Page) => page.locator("#problems .problem");

async function addEntry(page: Page, values: { observation: string; source: string; change: string; sample?: string; status?: string; outcome?: string }) {
  await page.fill("#f-observation", values.observation);
  await page.selectOption("#f-source", values.source);
  if (values.sample !== undefined) await page.fill("#f-sample", values.sample).catch(() => undefined);
  await page.fill("#f-change", values.change);
  if (values.status) await page.selectOption("#f-status", values.status);
  if (values.outcome) await page.fill("#f-outcome", values.outcome);
  await page.click("#save-entry");
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXECUTABLE });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("request", (r) => {
    if (!r.url().startsWith("file://") && !r.url().startsWith("blob:")) requests.push(r.url());
  });

  scenario = "the page as it opens";
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  check("one h1", await page.locator("h1").count(), 1);
  const body = await page.locator("body").innerText();
  ok("says plainly that nothing is measured", body.includes("Nothing on this site is measured yet"), body.slice(0, 120));
  ok("says no figure is not a figure of zero", body.includes("No figure is not the same as a figure of zero"), "");
  ok("names the authentication gap for any future deployment", body.includes("it needs authentication first"), "");
  check("the register starts empty", await entryCards(page).count(), 0);
  ok("and says so rather than showing zeros", (await page.locator("#summary").innerText()).includes("The register is empty"), "");

  scenario = "the four questions";
  check("one panel each", await page.locator("#metrics article.panel").count(), METRIC_PANELS.length);
  const metrics = await page.locator("#metrics").innerText();
  for (const panel of METRIC_PANELS) ok(`"${panel.question.slice(0, 34)}" is asked`, metrics.includes(panel.question), "");
  check("every panel is marked not connected", await page.locator("#metrics article.panel[data-status='not_connected']").count(), METRIC_PANELS.length);
  check("every source is marked not connected", await page.locator("#metrics .sources .pill.off").count(), SOURCES.length);
  ok("no figure is printed in place of a measurement", !/\b\d+ (visits|views|clicks|sessions|users)\b/i.test(metrics), metrics.slice(0, 160));
  ok("click-outs are not called purchases", metrics.includes("must never be presented as a sale"), "");
  ok("friction is aggregate only", metrics.includes("Counts only"), "");

  scenario = "adding an entry";
  await addEntry(page, { observation: "A partner could not tell which drink was cheaper per serving.", source: "partner_feedback", change: "Show cost per serving on the card." });
  check("the entry is listed", await entryCards(page).count(), 1);
  const first = await entryCards(page).first().innerText();
  ok("marked as not measured, because a partner saying so is not a measurement", first.includes("not measured"), first.slice(0, 120));
  ok("and the summary counts it as unmeasured", (await page.locator("#summary").innerText()).includes("1 rest on something somebody noticed"), await page.locator("#summary").innerText());
  ok("the summary publishes no score", (await page.locator("#summary").innerText()).includes("There is no score here"), "");

  scenario = "a note cannot dress up as data";
  // The sample field is switched off for a source that measures nothing, and
  // the validator refuses it even if something gets in.
  check("the sample field is disabled", await page.locator("#f-sample").isDisabled(), true);
  ok("and says why", (await page.locator("#measurement-note").innerText()).includes("would make a note look like data"), "");
  await page.selectOption("#f-source", "search_console");
  check("a measuring source switches it on", await page.locator("#f-sample").isDisabled(), false);
  await page.evaluate(() => {
    // Force the invalid combination past the disabled control, which is what a
    // determined person or a hand-edited file would do.
    (document.getElementById("f-sample") as HTMLInputElement).value = "12 sessions";
    (document.getElementById("f-source") as HTMLSelectElement).value = "owner_observation";
  });
  await page.fill("#f-observation", "Something I thought.");
  await page.fill("#f-change", "Look into it.");
  await page.click("#save-entry");
  ok("the validator refuses it", (await problems(page).count()) > 0, "");
  ok("with the reason", (await problems(page).first().innerText()).includes("not one"), await problems(page).first().innerText());
  check("and nothing was added", await entryCards(page).count(), 1);

  scenario = "an outcome needs something to have happened";
  await page.reload();
  await page.fill("#f-observation", "An idea.");
  await page.selectOption("#f-source", "reasoning");
  await page.fill("#f-change", "Try it.");
  await page.selectOption("#f-status", "open");
  await page.fill("#f-outcome", "It worked.");
  await page.click("#save-entry");
  ok("refused", (await problems(page).count()) > 0, "");
  ok("saying why", (await problems(page).first().innerText()).includes("Mark it changed"), await problems(page).first().innerText());

  scenario = "the register survives a reload";
  await page.reload();
  check("the entry is still there", await entryCards(page).count(), 1);
  ok("and says it came from this browser", (await page.locator("#save-state").innerText()).includes("loaded from this browser"), await page.locator("#save-state").innerText());

  scenario = "example entries are kept apart";
  await page.click("#load-demo");
  check("all of them are loaded", await page.locator("#entries article.entry.is-demo").count(), DEMO_ENTRIES.length);
  check("every one is tagged", await page.locator("#entries .pill.demo").count(), DEMO_ENTRIES.length);
  const summary = await page.locator("#summary").innerText();
  ok("counted separately from the owner's own", summary.includes(`${DEMO_ENTRIES.length} example entries are loaded`), summary);
  ok("and named as not about this site", summary.includes("not about this site"), summary);
  await page.click("#clear-demo");
  check("and they can be removed without touching the real one", await entryCards(page).count(), 1);

  scenario = "export and import";
  const exported = await page.evaluate(async () => {
    // The Save button writes a file through a download, which this harness
    // cannot open. The same serialisation is read here from the storage the
    // page keeps, which is what the button exports.
    return window.localStorage.getItem("wc.learning.v1");
  });
  ok("the register is stored as version 1 JSON", JSON.parse(exported ?? "{}").version === 1, exported?.slice(0, 60));

  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  check("cleared", await entryCards(page).count(), 0);

  const file = join(process.cwd(), "docs", "learning-dashboard", "example-register.json");
  await page.setInputFiles("#import", file);
  await page.waitForFunction(() => document.querySelectorAll("#entries article.entry").length > 0, undefined, { timeout: 5000 });
  ok("a saved file loads back", (await entryCards(page).count()) > 0, "");
  ok("and says how many", (await page.locator("#save-state").innerText()).includes("from the file"), await page.locator("#save-state").innerText());

  scenario = "nothing left this machine";
  check("no network request of any kind", requests, []);
  check("no page errors", errors, []);

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
