/**
 * The whole ingestion flow, in a real browser, on the real Sweat Kingdom feed.
 *
 *   WELLNESS_INGESTION_ADMIN=1 npm run e2e:ingestion
 *
 * Upload, inspect the columns, load a saved mapping, see what it would do,
 * approve it, import drafts, edit a listing by hand, upload the same file again
 * and watch the edit survive. That sequence is the thing that was asked for, so
 * it is driven through the page rather than asserted against the domain code
 * the unit tests already cover.
 *
 * It runs against its own workspace directory and removes it at the end, so it
 * cannot throw away anything somebody imported. It runs the project's own `tsx`
 * through the Node already running it rather than looking `npx` up on PATH, and
 * it asks Playwright where its browser is rather than naming a path that exists
 * on one machine. `CHROMIUM_PATH` still overrides. It starts no storefront,
 * because there is nothing to look at: drafts live in a directory the site does
 * not read, and publishing them is not part of this flow.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = process.cwd();
const WORKSPACE = "ingestion-e2e";
const WORKSPACE_DIR = join(ROOT, WORKSPACE);
const FEED = join(ROOT, "intake", "sweat-kingdom", "awin-125462-f3219-2026-09-13.csv");
const PORT = Number(process.env.INGESTION_PORT ?? 4331);
const TOOL = `http://127.0.0.1:${PORT}`;
const ASCENT = "sweat-kingdom-the-ascent";
const EDITED = "The Ascent (6 person) — checked by hand";

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

const draftFiles = (): string[] => {
  const dir = join(WORKSPACE_DIR, "drafts", "products");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
};
const draft = (id: string): { name: string; description: string } => JSON.parse(readFileSync(join(WORKSPACE_DIR, "drafts", "products", `${id}.json`), "utf8"));
const catalogCount = (): number => readdirSync(join(ROOT, "catalog", "products")).length;

async function waitFor(url: string, what: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`${what} did not come up at ${url}`);
}

const require_ = createRequire(import.meta.url);

/**
 * The project's own `tsx`, run by the Node already running this.
 *
 * Not `npx`. `npx` is a shell lookup on PATH for a program that may not be
 * there, and on a machine where it is not there the failure is an ENOENT with
 * nothing in it about what this check wanted. `tsx` is a declared dependency of
 * this project, so it is resolved from the dependency tree and handed to
 * `process.execPath`: the same interpreter, the same tree, no PATH.
 */
function tsxCli(): string {
  const manifest = require_.resolve("tsx/package.json");
  const bin = (require_(manifest) as { bin?: string | Record<string, string> }).bin;
  const entry = typeof bin === "string" ? bin : (bin?.tsx ?? Object.values(bin ?? {})[0]);
  if (!entry) throw new Error(`The tsx package at ${manifest} declares no executable, so this check cannot run its scripts.`);
  return resolve(dirname(manifest), entry);
}

/**
 * Which Chromium to drive, without naming a path on one machine.
 *
 * `CHROMIUM_PATH` wins, so an environment that keeps its browser somewhere of
 * its own still works. Failing that, Playwright's own answer, which already
 * honours `PLAYWRIGHT_BROWSERS_PATH` and is right on any machine where
 * `playwright install` has run. Failing that, a browser sitting in the
 * configured browsers directory under a plain name, which is how some
 * pre-provisioned images ship one: Playwright's answer names the build its
 * version expects, and an image carrying a different build has the browser
 * without having that path.
 *
 * When none of them is there this returns nothing and Playwright raises its
 * own error, which says how to install a browser. A guess would say ENOENT on
 * a path nobody chose.
 */
function chromiumPath(): string | undefined {
  const named = process.env.CHROMIUM_PATH?.trim();
  if (named) return named;
  try {
    const own = chromium.executablePath();
    if (own && existsSync(own)) return own;
  } catch {
    // Playwright has no path for this platform. Its own error is better than one made up here.
  }
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (browsers) {
    for (const candidate of [join(browsers, "chromium"), join(browsers, "chrome")]) {
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function launch(command: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
  return child;
}

const pill = (page: Page, testId: string, nth = 1) => page.locator(`[data-testid="${testId}"] .pill`).nth(nth - 1);

async function run() {
  if (existsSync(WORKSPACE_DIR)) rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  const env = { WELLNESS_INGESTION_ADMIN: "1", INGESTION_PORT: String(PORT), INGESTION_DIR: WORKSPACE };

  // The source and a first mapping, as an administrator would have typed them.
  // Unapproved: approving it is one of the steps below.
  const tsx = tsxCli();
  await new Promise<void>((done, reject) => {
    const seed = launch(process.execPath, [tsx, "scripts/ingestion-seed.ts"], env);
    seed.on("error", reject);
    seed.on("exit", (code) => (code === 0 ? done() : reject(new Error(`the seed exited with ${code}`))));
  });

  const catalogBefore = catalogCount();
  const tool = launch(process.execPath, [tsx, "scripts/ingestion-server.ts"], env);
  const executablePath = chromiumPath();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  try {
    await waitFor(`${TOOL}/`, "the ingestion tool");
    const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
    await page.goto(TOOL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="source-select"]');

    scenario = "source";
    await page.locator('[data-testid="source-select"]').selectOption("sweat-kingdom-awin");
    await page.waitForSelector('[data-testid="profile-v1"]');
    check("the seeded mapping is not approved", await pill(page, "profile-v1").textContent(), "not approved");

    scenario = "upload";
    await page.setInputFiles('[data-testid="file-input"]', FEED);
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 30_000 });
    check("all 62 columns are detected", await page.locator('[data-testid="columns"] tr').count(), 63);
    ok("the mapping editor is offered", await page.locator('[data-testid="target-table"]').isVisible());

    scenario = "mapping";
    await page.locator('[data-testid="load-v1"]').click();
    check("the issued tracking link is what the offer links to", await page.locator('[data-testid="column-link"]').inputValue(), "aw_deep_link");
    check("rows group on the merchant's own product page", await page.locator('[data-testid="grouping-column"]').inputValue(), "link");
    check("the name is not the feed's to change on its own", await page.locator('[data-testid="ownership-name"]').inputValue(), "review_on_change");

    scenario = "check";
    await page.locator('[data-testid="check"]').click();
    await page.waitForSelector('[data-testid="preflight"]', { timeout: 30_000 });
    check("17 records out of 225 rows", await page.locator('[data-testid^="plan-"]').count(), 17);
    ok(
      "and 15 things a shopper chooses between",
      (await page.locator('[data-testid="comparison-counts"]').textContent())?.startsWith("17 source records, 15 things") === true,
      await page.locator('[data-testid="comparison-counts"]').textContent(),
    );
    check(
      "the blackout cabin is compared as part of the cabin",
      await page.locator('[data-testid="family-sweat-kingdom-the-sweat-cabin-blackout-edition"] td').first().locator(".mono").textContent(),
      "sweat-kingdom-the-sweat-cabin",
    );
    check(
      "and the blackout pod as part of the pod",
      await page.locator('[data-testid="family-sweat-kingdom-the-sweat-pod-blackout-edition"] td').first().locator(".mono").textContent(),
      "sweat-kingdom-the-sweat-pod",
    );
    check("nothing else was folded into anything", await page.locator('[data-testid="families"] tr').count(), 3);
    check("a price filter this mapping fills", await pill(page, "coverage-price").textContent(), "price");
    check("and how many records it fills it for", await page.locator('[data-testid="coverage-price"] td').nth(2).textContent(), "17 of 17");
    check("a heating filter nothing fills", await pill(page, "coverage-sauna_type").textContent(), "unmapped");
    check("a capacity filter an unapproved rule would fill", await pill(page, "coverage-capacity_max_people").textContent(), "extracted");
    check("and fills for nobody while it is unapproved", await page.locator('[data-testid="coverage-capacity_max_people"] td').nth(2).textContent(), "0 of 17");
    ok("rows the feed does not call saunas are excluded and counted", (await page.locator('[data-testid="excluded-details"] summary').textContent())?.includes("rows excluded") === true);
    ok("importing is blocked while nobody has approved the mapping", (await page.locator('[data-testid="preflight"] .err').first().textContent())?.includes("has not been approved") === true);
    check("nothing has been written", draftFiles().length, 0);

    scenario = "approve";
    await page.locator('[data-testid="approver"]').fill("e2e reviewer");
    await page.locator('[data-testid="approve-profile"]').click();
    await page.waitForSelector('[data-testid="message"]');
    ok("the approval is signed and dated", (await pill(page, "profile-v1").textContent())?.startsWith("approved by e2e reviewer") === true);
    check("approving still writes no records", draftFiles().length, 0);

    scenario = "import";
    await page.locator('[data-testid="import"]').click();
    await page.waitForSelector(`[data-testid="draft-${ASCENT}"]`, { timeout: 60_000 });
    check("17 drafts on disk", draftFiles().length, 17);
    ok("and the message says nothing was published", (await page.locator('[data-testid="message"]').textContent())?.includes("Nothing is published") === true);
    check("the catalogue was not touched", catalogCount(), catalogBefore);

    scenario = "edit";
    await page.locator(`[data-testid="edit-${ASCENT}"]`).click();
    await page.locator(`[data-testid="edit-name-${ASCENT}"]`).fill(EDITED);
    await page.locator(`[data-testid="save-edit-${ASCENT}"]`).click();
    await page.waitForSelector('[data-testid="message"]');
    check("the edit is on disk", draft(ASCENT).name, EDITED);

    scenario = "again";
    // The same file, uploaded again, the way a refresh would arrive.
    await page.setInputFiles('[data-testid="file-input"]', FEED);
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 30_000 });
    await page.locator('[data-testid="import"]').click();
    await page.waitForSelector('[data-testid="preflight"]', { timeout: 60_000 });
    check("the edited name survives the refresh", draft(ASCENT).name, EDITED);
    check("still 17 drafts and no duplicates", draftFiles().length, 17);
    ok(
      "and the report says why it was held rather than overwritten",
      (await page.locator(`[data-testid="outcome-${ASCENT}-name"] .pill`).textContent()) === "held_local",
      await page.locator(`[data-testid="outcome-${ASCENT}-name"] .pill`).textContent(),
    );
    ok("nothing else moved either", (await page.locator('[data-testid="preflight"] p').first().textContent())?.includes("17 unchanged") === true);
    ok("and the refresh date is recorded", (await page.locator('[data-testid="staleness"]').textContent())?.includes("Last successful refresh") === true);
    ok("and the 15 comparables survive the refresh", (await page.locator('[data-testid="comparison-counts"]').textContent())?.startsWith("17 source records, 15 things") === true);
  } finally {
    await browser.close();
    tool.kill("SIGTERM");
    rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  }

  console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
