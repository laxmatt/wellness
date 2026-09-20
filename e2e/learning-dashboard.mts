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
import { rmSync, writeFileSync } from "node:fs";
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

  scenario = "a sample belongs to anything somebody looked at";
  // Watching people is evidence with a sample in it. Only a source that
  // observed nothing is refused one.
  await page.selectOption("#f-source", "usability_session");
  check("watching people can carry a sample", await page.locator("#f-sample").isDisabled(), false);
  ok("and is still marked as observed rather than measured", (await page.locator("#measurement-note").innerText()).includes("observed rather than measured"), await page.locator("#measurement-note").innerText());
  await page.selectOption("#f-source", "search_console");
  check("so can a measurement", await page.locator("#f-sample").isDisabled(), false);
  await page.selectOption("#f-source", "reasoning");
  check("reasoning cannot", await page.locator("#f-sample").isDisabled(), true);
  ok("and says why", (await page.locator("#measurement-note").innerText()).includes("nothing a sample size could be a sample of"), "");

  await page.evaluate(() => {
    // Forced past the disabled control, which is what a determined person or a
    // hand-edited file would do.
    (document.getElementById("f-sample") as HTMLInputElement).value = "12 sessions";
    (document.getElementById("f-source") as HTMLSelectElement).value = "reasoning";
  });
  await page.fill("#f-observation", "Something I worked out.");
  await page.click("#save-entry");
  ok("the validator refuses it anyway", (await problems(page).count()) > 0, "");
  ok("with the reason", (await problems(page).first().innerText()).includes("sample of"), await problems(page).first().innerText());
  check("and nothing was added", await entryCards(page).count(), 1);

  scenario = "an observation is worth keeping before you know what to do";
  await page.reload();
  await page.fill("#f-observation", "Somebody scrolled past the picks entirely.");
  await page.selectOption("#f-source", "owner_observation");
  await page.click("#save-entry");
  check("saved with no proposed change", await entryCards(page).count(), 2);
  check("and nothing was refused", await problems(page).count(), 0);

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
  check("both entries are still there", await entryCards(page).count(), 2);
  ok("and says it came from this browser", (await page.locator("#save-state").innerText()).includes("loaded from this browser"), await page.locator("#save-state").innerText());

  scenario = "example entries are kept apart";
  await page.click("#load-demo");
  check("all of them are loaded", await page.locator("#entries article.entry.is-demo").count(), DEMO_ENTRIES.length);
  check("every one is tagged", await page.locator("#entries .pill.demo").count(), DEMO_ENTRIES.length);
  const summary = await page.locator("#summary").innerText();
  ok("counted separately from the owner's own", summary.includes(`${DEMO_ENTRIES.length} example entries are loaded`), summary);
  ok("and named as not about this site", summary.includes("not about this site"), summary);
  await page.click("#clear-demo");
  check("and they can be removed without touching the real ones", await entryCards(page).count(), 2);

  scenario = "importing never destroys what is here";
  // The first version replaced everything the moment a file was chosen, even
  // when every entry in it had been rejected.
  await page.reload();
  const before = await entryCards(page).count();
  ok("there is something to lose", before > 0, before);

  const tmp = join(process.cwd(), "docs", "learning-dashboard", ".harness-tmp.json");
  writeFileSync(tmp, JSON.stringify({ version: 1, entries: [null, "not an entry"] }));
  await page.setInputFiles("#import", tmp);
  await page.waitForSelector("#pending .banner", { timeout: 5000 });
  check("nothing was applied", await entryCards(page).count(), before);
  const rejected = await page.locator("#pending").innerText();
  ok("the file is reported as read and not applied", rejected.includes("read, and not applied"), rejected.slice(0, 120));
  ok("with nothing in it to load", rejected.includes("nothing in it to load"), rejected.slice(0, 200));
  check("and no way to replace with nothing", await page.locator("#pending button", { hasText: "Replace" }).count(), 0);
  await page.locator("#pending button", { hasText: "Cancel" }).click();
  check("cancelling leaves it alone", await entryCards(page).count(), before);

  scenario = "a good file waits for a decision";
  writeFileSync(tmp, JSON.stringify({ version: 1, entries: [{ id: "imported-1", observation: "From a file.", evidence: { source: "reasoning" }, status: "open", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" }] }));
  await page.setInputFiles("#import", tmp);
  await page.waitForSelector("#pending .banner", { timeout: 5000 });
  check("still nothing applied", await entryCards(page).count(), before);
  ok("both choices are offered", (await page.locator("#pending button").count()) === 3, await page.locator("#pending").innerText());

  await page.locator("#pending button", { hasText: "Add these" }).click();
  await page.waitForFunction((n) => document.querySelectorAll("#entries article.entry").length === n, before + 1, { timeout: 5000 });
  check("merging keeps what was here and adds the file", await entryCards(page).count(), before + 1);
  ok("and says so", (await page.locator("#save-state").innerText()).includes("Added 1 entry"), await page.locator("#save-state").innerText());

  scenario = "replacing is explicit";
  await page.setInputFiles("#import", tmp);
  await page.waitForSelector("#pending .banner", { timeout: 5000 });
  await page.locator("#pending button", { hasText: "Replace all" }).click();
  await page.waitForFunction(() => document.querySelectorAll("#entries article.entry").length === 1, undefined, { timeout: 5000 });
  check("only the file's entry remains", await entryCards(page).count(), 1);
  rmSync(tmp, { force: true });

  scenario = "unreadable storage is not written over";
  await page.evaluate(() => window.localStorage.setItem("wc.learning.v1", "{ this is not json"));
  await page.reload();
  await page.waitForSelector("#rescue .banner", { timeout: 5000 });
  const rescue = await page.locator("#rescue").innerText();
  ok("the page says the saved notes could not be read", rescue.includes("Saved notes could not be read"), rescue.slice(0, 120));
  ok("and that nothing has been written over them", rescue.includes("Nothing has been written over the stored text"), rescue.slice(0, 220));
  ok("the status line agrees, rather than saying nothing is saved", (await page.locator("#save-state").innerText()).includes("could not be read"), await page.locator("#save-state").innerText());

  // Writing while the old text is unread would destroy it, so it is refused.
  await page.fill("#f-observation", "Something new.");
  await page.selectOption("#f-source", "reasoning");
  await page.click("#save-entry");
  const stored = await page.evaluate(() => window.localStorage.getItem("wc.learning.v1"));
  check("the unread text is still exactly as it was", stored, "{ this is not json");
  ok("and the refusal is on screen", (await page.locator("#save-state").innerText()).includes("Nothing was saved"), await page.locator("#save-state").innerText());

  await page.locator("#rescue button", { hasText: "start a new register" }).click();
  await page.waitForFunction(() => !document.getElementById("rescue")!.innerText.includes("could not be read"), undefined, { timeout: 5000 });
  ok("and it can be cleared deliberately once the owner has a copy", (await page.evaluate(() => window.localStorage.getItem("wc.learning.v1")))?.startsWith("{") === true, "");

  scenario = "a stored register that only partly reads";
  // The one that nearly got away. Valid JSON, one entry the tool could not
  // have written: the readable ones were shown, the warning was overwritten a
  // moment later by "loaded from this browser", and the next save wrote the
  // smaller set over the original with no sign the other note had existed.
  const partial = JSON.stringify({
    version: 1,
    entries: [
      { id: "keeps", observation: "This one reads.", evidence: { source: "reasoning" }, status: "open", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: "loses", observation: "This one has no timestamp.", evidence: { source: "reasoning" }, status: "open" },
    ],
  });
  await page.evaluate((text) => window.localStorage.setItem("wc.learning.v1", text), partial);
  await page.reload();
  await page.waitForSelector("#rescue .banner", { timeout: 5000 });

  check("the readable entry is shown", await entryCards(page).count(), 1);
  const partialBanner = await page.locator("#rescue").innerText();
  ok("the page says part of it could not be read", partialBanner.includes("Part of the saved notes could not be read"), partialBanner.slice(0, 140));
  ok("and names what was left out", partialBanner.includes("updatedAt"), partialBanner.slice(0, 260));
  ok("the status line agrees rather than saying it loaded", (await page.locator("#save-state").innerText()).includes("Part of the saved notes"), await page.locator("#save-state").innerText());

  // Editing and saving must not quietly write the smaller set over it.
  await page.fill("#f-observation", "Something new while the warning stands.");
  await page.selectOption("#f-source", "reasoning");
  await page.click("#save-entry");
  check("the stored text is still every byte of the original", await page.evaluate(() => window.localStorage.getItem("wc.learning.v1")), partial);
  ok("and the refusal explains itself", (await page.locator("#save-state").innerText()).includes("less than it holds"), await page.locator("#save-state").innerText());

  await page.locator("#rescue button", { hasText: "keep the readable ones" }).click();
  await page.waitForFunction(() => !document.getElementById("rescue")!.innerText.includes("could not be read"), undefined, { timeout: 5000 });
  const afterChoice = await page.evaluate(() => window.localStorage.getItem("wc.learning.v1"));
  ok("only an explicit press replaces it", afterChoice !== partial, "");
  ok("and what it kept is the readable one", (afterChoice ?? "").includes("This one reads."), "");
  ok("the one that could not be read is gone, deliberately", !(afterChoice ?? "").includes("This one has no timestamp"), "");

  scenario = "export and import";
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await addEntry(page, { observation: "One to export.", source: "reasoning", change: "" });
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
  await page.waitForSelector("#pending .banner", { timeout: 5000 });
  check("into an empty register, it still waits to be told", await entryCards(page).count(), 0);
  await page.locator("#pending button", { hasText: "Replace all" }).click();
  await page.waitForFunction((n) => document.querySelectorAll("#entries article.entry").length === n, DEMO_ENTRIES.length, { timeout: 5000 });
  check("a saved file loads back in full", await entryCards(page).count(), DEMO_ENTRIES.length);
  ok("and says where from", (await page.locator("#save-state").innerText()).includes("example-register.json"), await page.locator("#save-state").innerText());

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
