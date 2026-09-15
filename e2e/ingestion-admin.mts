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
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = process.cwd();
const WORKSPACE = "ingestion-e2e";
const WORKSPACE_DIR = join(ROOT, WORKSPACE);
/**
 * Where this check puts the snapshot it generates, instead of somebody's real
 * intake. The server resolves it inside the project and refuses anything else.
 */
const SNAPSHOTS = "ingestion-e2e-snapshots";
const SNAPSHOTS_DIR = join(ROOT, SNAPSHOTS);
const FEED = join(ROOT, "intake", "sweat-kingdom", "awin-125462-f3219-2026-09-13.csv");
const TOPTURE_SNAPSHOT = join(ROOT, "src", "__tests__", "fixtures", "shopify", "topture-shopify.json");
const SELECT_SNAPSHOT = join(ROOT, "src", "__tests__", "fixtures", "shopify", "select-saunas-shopify.json");
const PORT = Number(process.env.INGESTION_PORT ?? 4331);
const TOOL = `http://127.0.0.1:${PORT}`;
const ASCENT = "sweat-kingdom-the-ascent";
const CABIN = "sweat-kingdom-the-sweat-cabin";
const BLACKOUT = "sweat-kingdom-the-sweat-cabin-blackout-edition";
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
type DraftFile = { name: string; description: string; offers: { url: string; affiliate: { status: string }; source: { url: string } }[] };
const draft = (id: string): DraftFile => JSON.parse(readFileSync(join(WORKSPACE_DIR, "drafts", "products", `${id}.json`), "utf8"));
const catalogCount = (): number => readdirSync(join(ROOT, "catalog", "products")).length;
const planFiles = (): string[] => {
  const dir = join(WORKSPACE_DIR, "plans");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
};

/** Every byte of the catalogue. The promotion planner must not move one. */
function catalogFingerprint(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else parts.push(`${path}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
    }
  };
  walk(join(ROOT, "catalog"));
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

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

const ACTIVITY = '[data-testid="activity"]';

/**
 * Do something that talks to the tool, and wait for the tool to have finished
 * it.
 *
 * Not `waitForSelector`. Every element this page draws exists before most
 * actions and still exists after them, so waiting for one to appear proves
 * nothing and passes immediately on a machine where the request has not
 * returned yet. The page counts finished requests in `data-completed`, and the
 * count goes up after the answer is folded into its state and before the
 * redraw, so a higher count with the page idle is the only thing that says the
 * screen is showing the result of this action.
 *
 * No sleeps anywhere: every wait below is on a value that changed.
 */
async function act(page: Page, what: () => Promise<unknown>): Promise<void> {
  const before = Number((await page.locator(ACTIVITY).getAttribute("data-completed")) ?? "0");
  await what();
  await page.waitForFunction(
    (n: number) => {
      const node = document.querySelector('[data-testid="activity"]');
      return node !== null && node.getAttribute("data-state") === "idle" && Number(node.getAttribute("data-completed") ?? "0") > n;
    },
    before,
    { timeout: 60_000 },
  );
}

/** Wait for an attribute to hold a value, for the things a click changes without asking the tool. */
async function attributeBecomes(page: Page, selector: string, attribute: string, value: string): Promise<void> {
  await page.waitForFunction(
    ([s, a, v]: string[]) => document.querySelector(s)?.getAttribute(a) === v,
    [selector, attribute, value],
    { timeout: 30_000 },
  );
}

const attribute = async (page: Page, selector: string, name: string): Promise<string | null> => page.locator(selector).getAttribute(name);

/** For a refusal the page makes on its own, without asking the tool. */
async function textBecomes(page: Page, selector: string, substring: string): Promise<void> {
  await page.waitForFunction(
    ([s, t]: string[]) => (document.querySelector(s)?.textContent ?? "").includes(t),
    [selector, substring],
    { timeout: 30_000 },
  );
}

/**
 * A snapshot in the shape `npm run fetch:shopify` writes, big enough to have
 * met the bound that refused the real Select Saunas catalogue.
 *
 * Most of a real product's bytes are `body_html`, and that markup is dense with
 * the quotes that make JSON escaping cost something, so the generated one is
 * too. Anything smaller would pass a ceiling it was never tested against.
 */
function generateSnapshot(count: number): string {
  const copy = "Eastern White Cedar staves, stainless steel bands, and a tempered glass door. ".repeat(12);
  const products = Array.from({ length: count }, (_, n) => {
    const i = n + 1;
    return {
      id: 100_000 + i,
      title: `Hooga Outdoor Barrel Sauna - Model ${i}`,
      handle: `hooga-barrel-model-${i}`,
      vendor: "Hooga",
      product_type: "Outdoor Sauna",
      tags: ["sauna", "barrel", "cedar"],
      body_html: `<div class="product-description" id="d-${i}" data-model="${i}"><p>The <strong>Model ${i}</strong> is a "flat roof" barrel sauna.</p><img src="https://cdn.shopify.com/s/files/1/0/m-${i}.jpg" alt="Model ${i}" /><p>${copy}</p></div>`,
      created_at: "2025-01-02T10:00:00-05:00",
      updated_at: "2026-09-15T08:00:00-04:00",
      options: [{ name: "Heater" }],
      images: [{ src: `https://cdn.shopify.com/s/files/1/0/m-${i}.jpg`, position: 1 }],
      variants: [
        { id: 200_000 + i, title: "Electric", sku: `HOO-${i}-E`, price: `${8000 + i}.00`, available: true, position: 1, updated_at: "2026-09-15T08:00:00-04:00" },
        { id: 300_000 + i, title: "Wood", sku: `HOO-${i}-W`, price: `${9000 + i}.00`, available: false, position: 2, updated_at: "2026-09-15T08:00:00-04:00" },
      ],
    };
  });
  return JSON.stringify({
    sourceId: "hooga-shopify",
    storeUrl: "https://hoogahealth.com",
    requested: ["https://hoogahealth.com/products.json?limit=250&page=1"],
    pages: Math.ceil(count / 250),
    productCount: count,
    variantCount: count * 2,
    fetchedAt: "2026-09-15T08:00:00.000Z",
    products,
  });
}

async function run() {
  if (existsSync(WORKSPACE_DIR)) rmSync(WORKSPACE_DIR, { recursive: true, force: true });
  const env = { WELLNESS_INGESTION_ADMIN: "1", INGESTION_PORT: String(PORT), INGESTION_DIR: WORKSPACE, SNAPSHOT_DIR: SNAPSHOTS };

  // A catalogue the size of a real storefront. Generated rather than committed:
  // a megabyte of invented marketing copy in the repository would be read one
  // day as a real partner's, and it is noise in every diff until then.
  if (existsSync(SNAPSHOTS_DIR)) rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const bigSnapshot = join(SNAPSHOTS_DIR, "hooga-shopify.json");
  writeFileSync(bigSnapshot, generateSnapshot(737), "utf8");
  const bigBytes = statSync(bigSnapshot).size;

  // The source and a first mapping, as an administrator would have typed them.
  // Unapproved: approving it is one of the steps below.
  const tsx = tsxCli();
  await new Promise<void>((done, reject) => {
    const seed = launch(process.execPath, [tsx, "scripts/ingestion-seed.ts"], env);
    seed.on("error", reject);
    seed.on("exit", (code) => (code === 0 ? done() : reject(new Error(`the seed exited with ${code}`))));
  });

  await new Promise<void>((done, reject) => {
    const seed = launch(process.execPath, [tsx, "scripts/seed-shopify.ts"], env);
    seed.on("error", reject);
    seed.on("exit", (code) => (code === 0 ? done() : reject(new Error(`the Shopify seed exited with ${code}`))));
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
    await act(page, () => page.setInputFiles('[data-testid="file-input"]', FEED));
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 30_000 });
    check("all 62 columns are detected", await page.locator('[data-testid="columns"] tr').count(), 63);
    ok("the mapping editor is offered", await page.locator('[data-testid="target-table"]').isVisible());

    scenario = "mapping";
    await page.locator('[data-testid="load-v1"]').click();
    check("the issued tracking link is what the offer links to", await page.locator('[data-testid="column-link"]').inputValue(), "aw_deep_link");
    check("rows group on the merchant's own product page", await page.locator('[data-testid="grouping-column"]').inputValue(), "link");
    check("the name is not the feed's to change on its own", await page.locator('[data-testid="ownership-name"]').inputValue(), "review_on_change");

    scenario = "check";
    await act(page, () => page.locator('[data-testid="check"]').click());
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
    check("a capacity filter an approved rule fills", await pill(page, "coverage-capacity_max_people").textContent(), "extracted");
    check("for every record, out of the retailer's own model names", await page.locator('[data-testid="coverage-capacity_max_people"] td').nth(2).textContent(), "17 of 17");
    check("a style filter the same rules fill for most of them", await pill(page, "coverage-sauna_style").textContent(), "extracted");
    check("and leave unfilled where the name says nothing", await page.locator('[data-testid="coverage-sauna_style"] td').nth(2).textContent(), "11 of 17");
    ok("rows the feed does not call saunas are excluded and counted", (await page.locator('[data-testid="excluded-details"] summary').textContent())?.includes("rows excluded") === true);
    ok("importing is blocked while nobody has approved the mapping", (await page.locator('[data-testid="preflight"] .err').first().textContent())?.includes("has not been approved") === true);
    check("nothing has been written", draftFiles().length, 0);

    scenario = "approve";
    await page.locator('[data-testid="approver"]').fill("e2e reviewer");
    await act(page, () => page.locator('[data-testid="approve-profile"]').click());
    ok("the approval is signed and dated", (await pill(page, "profile-v1").textContent())?.startsWith("approved by e2e reviewer") === true);
    check("approving still writes no records", draftFiles().length, 0);

    scenario = "import";
    await act(page, () => page.locator('[data-testid="import"]').click());
    await page.waitForSelector(`[data-testid="draft-${ASCENT}"]`, { timeout: 60_000 });
    check("17 drafts on disk", draftFiles().length, 17);
    ok("and the message says nothing was published", (await page.locator('[data-testid="message"]').textContent())?.includes("Nothing is published") === true);
    check("the catalogue was not touched", catalogCount(), catalogBefore);

    scenario = "edit";
    await page.locator(`[data-testid="edit-${ASCENT}"]`).click();
    await page.locator(`[data-testid="edit-name-${ASCENT}"]`).fill(EDITED);
    await act(page, () => page.locator(`[data-testid="save-edit-${ASCENT}"]`).click());
    check("the edit is on disk", draft(ASCENT).name, EDITED);

    scenario = "again";
    // The same file, uploaded again, the way a refresh would arrive.
    await act(page, () => page.setInputFiles('[data-testid="file-input"]', FEED));
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 30_000 });
    await act(page, () => page.locator('[data-testid="import"]').click());
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

    scenario = "promote";
    const catalogBytes = catalogFingerprint();
    await act(page, () => page.locator('[data-testid="build-plan"]').click());
    ok("nothing selected is said plainly", (await page.locator('[data-testid="blocker-no_selection"]').count()) === 1);
    ok(
      "a blackout configuration has no checkbox of its own",
      (await page.locator(`[data-testid="pick-box-${BLACKOUT}"]`).count()) === 0,
    );
    ok(
      "it is listed as coming with the model it is a finish of",
      (await page.locator(`[data-testid="pick-${CABIN}"]`).textContent())?.includes(BLACKOUT) === true,
    );
    check("all 15 families are offered", await page.locator('[data-testid^="pick-box-"]').count(), 15);

    // A checkbox asks the tool nothing, so the authoritative signal is what the
    // build button says it would ask for.
    await page.locator(`[data-testid="pick-box-${CABIN}"]`).check();
    await page.locator(`[data-testid="pick-box-${ASCENT}"]`).check();
    await attributeBecomes(page, '[data-testid="build-plan"]', "data-selected", "2");
    await act(page, () => page.locator('[data-testid="build-plan"]').click());
    check("two families selected", await attribute(page, '[data-testid="promotion-counts"]', "data-selected"), "2");
    check("three records in the selection", await attribute(page, '[data-testid="promotion-counts"]', "data-records"), "3");
    check("17 source records still in view", await attribute(page, '[data-testid="promotion-counts"]', "data-source-records"), "17");
    check("and 15 comparison families", await attribute(page, '[data-testid="promotion-counts"]', "data-families"), "15");
    check("three pictures with no permission", await attribute(page, '[data-testid="promotion-status"]', "data-image-rights"), "3");
    // Since the saunas launch every one of these ids is in the catalogue, so
    // each selected record is a collision that has to be answered.
    check("every selected record collides with the catalogue", await attribute(page, '[data-testid="promotion-status"]', "data-shadow-unresolved"), "3");
    check("the plan is not signable", await attribute(page, '[data-testid="promotion-status"]', "data-signable"), "false");
    ok("and signing is refused", await page.locator('[data-testid="sign-plan"]').isDisabled());

    scenario = "rights";
    for (const id of [CABIN, BLACKOUT, ASCENT]) {
      await page.locator(`[data-testid="record-rights-${id}"]`).click();
      await page.waitForSelector('[data-testid="rights-form"]');
      await page.locator('[data-testid="rights-evidence"]').fill("Awin programme terms for advertiser 125462, creative clause, read on this date and saved beside the partner file.");
      await act(page, () => page.locator('[data-testid="save-rights"]').click());
    }
    await act(page, () => page.locator('[data-testid="build-plan"]').click());
    check("no picture is unresolved now", await attribute(page, '[data-testid="promotion-status"]', "data-image-rights"), "0");
    for (const id of [CABIN, BLACKOUT, ASCENT]) {
      check(`${id} is cleared`, await attribute(page, `[data-testid="rights-${id}"]`, "data-state"), "cleared");
    }
    check("but the collisions still are not", await attribute(page, '[data-testid="promotion-status"]', "data-shadow-unresolved"), "3");

    scenario = "shadow";
    ok("the difference is shown field by field", (await page.locator(`[data-testid="shadow-diff-${ASCENT}"] tr`).count()) > 5);
    check("and nothing is chosen by default", await attribute(page, `[data-testid="shadow-${ASCENT}"]`, "data-choice"), "unresolved");
    for (const id of [CABIN, BLACKOUT, ASCENT]) {
      await page.locator(`[data-testid="shadow-${id}-replace_with_draft"]`).check();
      await attributeBecomes(page, `[data-testid="shadow-${id}"]`, "data-choice", "replace_with_draft");
    }
    await act(page, () => page.locator('[data-testid="build-plan"]').click());
    for (const id of [CABIN, BLACKOUT, ASCENT]) {
      check(`${id} is answered`, await attribute(page, `[data-testid="shadow-${id}"]`, "data-resolved"), "true");
    }
    check("nothing is unresolved", await attribute(page, '[data-testid="promotion-status"]', "data-blockers"), "0");
    check("the plan is signable", await attribute(page, '[data-testid="promotion-status"]', "data-signable"), "true");
    ok("and signing is offered", !(await page.locator('[data-testid="sign-plan"]').isDisabled()));
    ok("carrying it out is not", await page.locator('[data-testid="execute-plan"]').isDisabled());
    check("nothing has been written to the catalogue", catalogFingerprint(), catalogBytes);
    check("and no plan is signed yet", planFiles().length, 0);

    scenario = "sign";
    // An unsigned approval is refused on the page, with no request sent.
    const beforeRefusal = Number(await attribute(page, ACTIVITY, "data-completed"));
    await page.locator('[data-testid="sign-plan"]').click();
    await textBecomes(page, '[data-testid="message"]', "An approval nobody signed is not one");
    check("signing with no name asks the tool nothing", await attribute(page, ACTIVITY, "data-completed"), String(beforeRefusal));
    check("and writes no plan", planFiles().length, 0);

    await page.locator('[data-testid="plan-reviewer"]').fill("e2e reviewer");
    await act(page, () => page.locator('[data-testid="sign-plan"]').click());
    await page.waitForSelector('[data-testid="plan-document"]', { timeout: 30_000 });
    check("one plan is on disk", planFiles().length, 1);
    check("the catalogue is still untouched", catalogFingerprint(), catalogBytes);
    check("and still has the same number of products", catalogCount(), catalogBefore);
    const document_ = (await page.locator('[data-testid="plan-document"]').textContent()) ?? "";
    ok("the plan says nothing was promoted or published", document_.includes("Nothing has been promoted or published"));
    ok("it names who signed it", document_.includes("Signed by e2e reviewer"));
    ok("it names the file and the mapping", document_.includes("mapping profile v1"));
    ok("it records the collision decision", document_.includes("replace_with_draft"));
    ok("and it lists the comparison fields this feed does not fill", document_.includes("Comparison fields missing:"));
    ok("the history shows it as not carried out", (await page.locator('[data-testid="plan-history"]').textContent())?.includes("not carried out") === true);

    scenario = "serialised";
    // Two actions asked for at once. The tool runs one at a time and says so,
    // which is what stops a redraw landing in the middle of the other.
    const completedBefore = Number(await attribute(page, ACTIVITY, "data-completed"));
    await page.evaluate(() => {
      for (const id of ["build-plan", "build-plan"]) {
        document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click();
      }
    });
    await page.waitForFunction(
      (n: number) => {
        const node = document.querySelector('[data-testid="activity"]');
        return node !== null && node.getAttribute("data-state") === "idle" && Number(node.getAttribute("data-completed") ?? "0") > n;
      },
      completedBefore,
      { timeout: 60_000 },
    );
    check("the tool is idle again", await attribute(page, ACTIVITY, "data-state"), "idle");
    check("with nothing left queued", await attribute(page, ACTIVITY, "data-queued"), "0");
    ok(
      "and it ran the actions one at a time",
      Number(await attribute(page, ACTIVITY, "data-completed")) - completedBefore <= 2,
      await attribute(page, ACTIVITY, "data-completed"),
    );

    scenario = "shopify";
    // A second partner, in a different format, through the same flow.
    await page.locator('[data-testid="source-select"]').selectOption("topture-shopify");
    await page.waitForSelector('[data-testid="profile-v1"]');
    await act(page, () => page.setInputFiles('[data-testid="file-input"]', TOPTURE_SNAPSHOT));
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 30_000 });
    ok("a Shopify snapshot reads into rows", (await page.locator('[data-testid="columns"] tr').count()) > 1);
    await page.locator('[data-testid="load-v1"]').click();
    await act(page, () => page.locator('[data-testid="check"]').click());
    check("two complete saunas out of the store's aisles", await page.locator('[data-testid="preflight"] [data-testid^="plan-"]').count(), 2);
    const excluded = (await page.locator('[data-testid="excluded-details"]').textContent()) ?? "";
    for (const reason of ["A heater is a part", "An accessory is not a complete sauna", "A cold plunge belongs to another category"]) {
      ok(`excluded, and says why: "${reason}"`, excluded.includes(reason), excluded.slice(0, 160));
    }
    ok("nothing is imported before the rules are approved", (await page.locator('[data-testid="preflight"] .err').first().textContent())?.includes("has not been approved") === true);

    await page.locator('[data-testid="approver"]').fill("e2e reviewer");
    await act(page, () => page.locator('[data-testid="approve-profile"]').click());
    await act(page, () => page.locator('[data-testid="import"]').click());
    ok("two Topture drafts", (await page.locator('[data-testid="draft-topture-dundalk-luna-4-person"]').count()) === 1);

    scenario = "affiliate links";
    // The transformation a person verified in Topture's own dashboard: the
    // store's product address with ref=MATTORR added, and the variant it
    // already carried still on it.
    const luna = draft("topture-dundalk-luna-4-person");
    check("the offer link carries the verified parameter", luna.offers[0].url, "https://topture.com/products/dundalk-luna-4-person?variant=1011&ref=MATTORR");
    check("and the offer says it pays", luna.offers[0].affiliate.status, "affiliate");
    // Provenance keeps the plain address: that is where the facts were read,
    // not where a shopper is sent.
    check("provenance keeps the plain address", luna.offers[0].source.url, "https://topture.com/products/dundalk-luna-4-person?variant=1011");
    ok("and nothing points anywhere but the merchant", luna.offers.every((o) => new URL(o.url).origin === "https://topture.com"));

    scenario = "cross-partner";
    await page.locator('[data-testid="source-select"]').selectOption("select-saunas-shopify");
    await page.waitForSelector('[data-testid="profile-v1"]');
    await act(page, () => page.setInputFiles('[data-testid="file-input"]', SELECT_SNAPSHOT));
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 30_000 });
    await page.locator('[data-testid="load-v1"]').click();
    await page.locator('[data-testid="approver"]').fill("e2e reviewer");
    await act(page, () => page.locator('[data-testid="approve-profile"]').click());
    await act(page, () => page.locator('[data-testid="import"]').click());

    await page.waitForSelector('[data-testid="canonical-counts"]', { timeout: 30_000 });
    check("nothing settled by an identifier", await attribute(page, '[data-testid="canonical-counts"]', "data-confirmed"), "0");
    check("one match waiting on a person", await attribute(page, '[data-testid="canonical-counts"]', "data-queued"), "1");
    const group = page.locator('[data-testid^="canonical-"][data-strength]').first();
    check("and it is a proposal, not a merge", await group.getAttribute("data-strength"), "proposed");
    ok("naming both partners", ((await group.textContent()) ?? "").includes("topture-shopify") && ((await group.textContent()) ?? "").includes("select-saunas-shopify"));
    // Nothing merged. Each partner's record is still its own draft with its own
    // price, and the match is a queued proposal beside them.
    for (const id of ["topture-dundalk-luna-4-person", "select-saunas-dundalk-luna-4-person"]) {
      check(`${id} is still its own draft`, await page.locator(`[data-testid="draft-${id}"]`).count(), 1);
    }

    scenario = "blocked";
    for (const id of ["lifepro", "therasage", "saunabox"]) {
      ok(`${id} is recorded as having no catalogue to read`, (await page.locator(`[data-testid="blocked-${id}"]`).count()) === 1);
    }
    ok("Lifepro still says the store refused the request", ((await page.locator('[data-testid="blocked-lifepro"]').textContent()) ?? "").includes("403"));
    // The portal review is done, and the record says what it found rather than
    // what it was waiting for.
    check("Therasage's portal review is recorded as complete", await page.locator('[data-testid="blocked-therasage"]').getAttribute("data-state"), "portal_review_complete_no_bulk_feed");
    ok("with the finding, not the old blocker", ((await page.locator('[data-testid="blocked-therasage"]').textContent()) ?? "").includes("no inventory feed"));
    ok("its rate, window and coupon are on screen", ((await page.locator('[data-testid="blocked-programme-therasage"]').textContent()) ?? "").includes("10% · 30-day referral window · coupon WELLNESSFITCHECK"));
    ok("and the link a person has to copy", ((await page.locator('[data-testid="blocked-link-therasage"]').textContent()) ?? "").startsWith("https://therasage.com/discount/WELLNESSFITCHECK?rfsn="));

    scenario = "compliance";
    check("the compliance review is raised once, for one partner", await page.locator('[data-testid="compliance-review"]').count(), 1);
    check("naming both outstanding requirements", await page.locator('[data-testid="compliance-review"]').getAttribute("data-outstanding"), "2");
    check("Therasage carries the flag", await page.locator('[data-testid="blocked-therasage"]').getAttribute("data-compliance"), "required");
    for (const id of ["lifepro", "saunabox"]) {
      check(`${id} does not`, await page.locator(`[data-testid="blocked-${id}"]`).getAttribute("data-compliance"), "clear");
    }
    for (const requirement of ["therasage-disclosure", "therasage-placement"]) {
      check(`${requirement} is outstanding`, await page.locator(`[data-testid="compliance-${requirement}"]`).getAttribute("data-state"), "outstanding");
    }
    ok("SAUNABOX shows its rate and code and no setup link", ((await page.locator('[data-testid="blocked-programme-saunabox"]').textContent()) ?? "").includes("5% · tracking code MATT41058"));
    check("and no link to copy, because none was issued", await page.locator('[data-testid="blocked-link-saunabox"]').count(), 0);

    scenario = "no secrets on screen";
    const screen = (await page.locator("body").textContent()) ?? "";
    for (const forbidden of ["password", "Set-Cookie", "sessionid", "complete-signup", "Authorization"]) {
      ok(`the tool shows no ${forbidden}`, !screen.toLowerCase().includes(forbidden.toLowerCase()));
    }

    scenario = "a whole storefront";
    // The blocker a real fetch found: Select Saunas is 737 products and 6,333
    // kB, valid inside every bound the adapter states, and the tool refused it
    // with "that is more than 1200 kB" because the transport had been sized
    // from the ceiling written for partner price files.
    ok(`the generated catalogue is past that bound (${Math.round(bigBytes / 1000)} kB)`, bigBytes > 1_200_000);
    await page.locator('[data-testid="source-select"]').selectOption("hooga-shopify");
    await page.waitForSelector('[data-testid="profile-v1"]');
    await act(page, () => page.setInputFiles('[data-testid="file-input"]', bigSnapshot));
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 60_000 });
    check("it uploads through the browser and reads", await attribute(page, '[data-testid="file-chosen"]', "data-route"), "upload");
    ok("every variant became a row", ((await page.locator('[data-testid="file"]').textContent()) ?? "").includes("1474 rows"));

    scenario = "read from disk";
    // The same catalogue, by the route that does not make it travel. The page
    // sends a partner id; the server works out the file. No command takes a
    // path, so there is nothing to point elsewhere.
    ok("the snapshot on this machine is offered beside the partner", (await page.locator('[data-testid="use-snapshot-hooga-shopify"]').count()) === 1);
    check("with its real size", await attribute(page, '[data-testid="snapshot-hooga-shopify"]', "data-bytes"), String(bigBytes));
    await act(page, () => page.locator('[data-testid="use-snapshot-hooga-shopify"]').click());
    await page.waitForSelector('[data-testid="target-table"]', { timeout: 60_000 });
    check("the server read it, not the browser", await attribute(page, '[data-testid="file-chosen"]', "data-route"), "snapshot");
    ok("and got the same rows", ((await page.locator('[data-testid="file"]').textContent()) ?? "").includes("1474 rows"));

    await page.locator('[data-testid="load-v1"]').click();
    await act(page, () => page.locator('[data-testid="check"]').click());
    ok("a preflight over the whole catalogue", (await page.locator('[data-testid="preflight"] [data-testid^="plan-"]').count()) > 100);
    ok("still refusing to import on rules nobody approved", (await page.locator('[data-testid="preflight"] .err').first().textContent())?.includes("has not been approved") === true);
    check("and the catalogue is still untouched", catalogCount(), catalogBefore);

  } finally {
    await browser.close();
    tool.kill("SIGTERM");
    rmSync(WORKSPACE_DIR, { recursive: true, force: true });
    rmSync(SNAPSHOTS_DIR, { recursive: true, force: true });
  }

  console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} failed:\n  ${failures.join("\n  ")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
