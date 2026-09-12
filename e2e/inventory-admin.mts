/**
 * The inventory tool, and the storefront it changes, both running.
 *
 *   WELLNESS_PREVIEW_INVENTORY=1 npx tsx e2e/inventory-admin.mts
 *
 * This starts the operator server and a storefront in development mode, drives
 * the page in a real browser, and reads the storefront over HTTP after each
 * change. The point of reading it over HTTP is the claim that needs proving: an
 * approval reaches pages a running server is already serving, with nothing
 * restarted and nothing rebuilt.
 *
 * It wants an empty preview catalogue and it empties it again at the end, so it
 * does not quietly throw away work somebody staged.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright";

const ROOT = process.cwd();
const PREVIEW = join(ROOT, "catalog-preview");
const SAMPLE = join(ROOT, "docs", "import-demo", "samples", "supplier-a-northwind-SYNTHETIC.csv");
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const TOOL_PORT = Number(process.env.INVENTORY_PORT ?? 4329);
const SITE_PORT = Number(process.env.STOREFRONT_PORT ?? 3129);
const TOOL = `http://127.0.0.1:${TOOL_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;

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

function stagedCount(): number {
  const dir = join(PREVIEW, "products");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).length : 0;
}

async function waitFor(url: string, what: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${what} did not come up at ${url}`);
}

function launch(command: string, args: string[], env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", () => {});
  child.stderr?.on("data", () => {});
  return child;
}

/** What the storefront is serving right now, over HTTP, from the already-running process. */
async function servedCategory(): Promise<string> {
  // One retry. A development server compiles a route on first request and can
  // drop a connection while it does; a dropped socket is not an answer about
  // what the storefront is serving.
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await fetch(`${SITE}/wellness-drinks`, { cache: "no-store" })).text();
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** The products a running storefront is listing, by slug. */
async function servedProducts(): Promise<string[]> {
  const html = await servedCategory();
  return [...new Set([...html.matchAll(/\/products\/([a-z0-9-]+)/g)].map((m) => m[1]))].sort();
}

const cardFor = (page: Page, id: string) => page.locator(`[data-record="${id}"]`).first();
const ENERGY = "preview-northwind-hydration-berry-sparkling-energy-12-cans";

async function run() {
  if (stagedCount() > 0) {
    console.error(`This check wants an empty preview catalogue and ${PREVIEW} is not empty.\nRun: WELLNESS_PREVIEW_INVENTORY=1 npm run inventory -- clear`);
    process.exit(2);
  }

  const env = { WELLNESS_PREVIEW_INVENTORY: "1", INVENTORY_PORT: String(TOOL_PORT), STOREFRONT_URL: SITE };
  const tool = launch("npx", ["tsx", "scripts/inventory-server.ts"], env);
  const site = launch("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(SITE_PORT)], env);
  const browser = await chromium.launch({ executablePath: EXECUTABLE });

  try {
    await waitFor(`${TOOL}/`, "the inventory tool");
    await waitFor(`${SITE}/wellness-drinks`, "the storefront");

    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
    page.on("dialog", (d) => void d.accept());
    await page.goto(TOOL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("h2");

    scenario = "upload";
    await page.locator('[data-field="supplier"]').fill("Northwind Hydration");
    await page.locator('[data-field="supplier"]').blur();
    await page.setInputFiles('input[type="file"]', SAMPLE);
    await page.waitForSelector(".draft", { timeout: 15_000 });
    check("every row is shown", await page.locator(".draft").count(), 5);
    ok("nothing is blocked in this file", (await page.locator(".draft.blocked").count()) === 0);
    const stageButton = page.getByRole("button", { name: /^Stage 5 drafts$/ });
    ok("the button offers to stage all five", await stageButton.isVisible());

    scenario = "stage";
    await stageButton.click();
    await page.waitForSelector(".record", { timeout: 15_000 });
    check("five records are staged", await page.locator(".record").count(), 5);
    check("and they are on disk", stagedCount(), 5);
    ok("none of them is in the storefront yet", !(await servedProducts()).some((slug) => slug.startsWith("preview-")));

    scenario = "edit";
    await cardFor(page, ENERGY).getByRole("button", { name: "Edit" }).click();
    await page.waitForSelector(`[data-record="${ENERGY}"][data-editing="true"]`);
    const form = page.locator(`[data-record="${ENERGY}"][data-editing="true"]`);

    // A figure typed by hand is read exactly as a cell in a file is read.
    await form.locator('[data-field="servings_per_pack"]').fill("1.5");
    await form.getByRole("button", { name: "Save" }).click();
    await page.waitForSelector('[data-error="servings_per_pack"]', { timeout: 10_000 });
    ok("a count with a decimal point is refused", (await page.locator('[data-error="servings_per_pack"]').first().innerText()).includes("whole"));
    ok("and the form is still open, with nothing saved", await form.isVisible());

    await form.locator('[data-field="servings_per_pack"]').fill("12");
    await form.locator('[data-field="offer.price"]').fill("17.50");
    await form.locator('[data-field="name"]').fill("Berry Sparkling Energy, 12 cans (checked)");
    await form.getByRole("button", { name: "Save" }).click();
    await page.waitForSelector(`[data-record="${ENERGY}"]:not([data-editing])`, { timeout: 10_000 });
    ok("the new name is shown", (await cardFor(page, ENERGY).innerText()).includes("(checked)"));
    ok("and the new price", (await cardFor(page, ENERGY).innerText()).includes("17.50"));
    // The pill is upper-cased by the stylesheet, and innerText reads what is rendered.
    ok("the edited figure is still demo data", (await cardFor(page, ENERGY).innerText()).toLowerCase().includes("demo data: invented, answers no filter"));

    scenario = "approve";
    await cardFor(page, ENERGY).getByRole("button", { name: "Approve" }).click();
    await page.waitForSelector(`[data-record="${ENERGY}"][data-status="published"]`, { timeout: 10_000 });
    ok("the record says it is in the storefront", (await cardFor(page, ENERGY).innerText()).includes("in the storefront"));

    const afterApproval = await servedCategory();
    ok("the running storefront serves it, with no restart", afterApproval.includes("Berry Sparkling Energy, 12 cans (checked)"));
    const product = await fetch(`${SITE}/products/preview-northwind-hydration-berry-sparkling-energy-12-cans`);
    check("its product page is served", product.status, 200);
    const productHtml = await product.text();
    ok("the product page carries the edited name", productHtml.includes("(checked)"));
    ok("and every figure on it is labelled demo data", productHtml.includes("Demo data"));
    const compare = await fetch(`${SITE}/compare?ids=preview-northwind-hydration-berry-sparkling-energy-12-cans,celsius-sparkling-orange-12`);
    ok("it can be compared", (await compare.text()).includes("(checked)"));

    scenario = "hide";
    await cardFor(page, ENERGY).getByRole("button", { name: "Hide" }).click();
    await page.waitForSelector(`[data-record="${ENERGY}"][data-status="hidden"]`, { timeout: 10_000 });
    ok("the running storefront drops it again", !(await servedCategory()).includes("(checked)"));
    check("and its product page is gone", (await fetch(`${SITE}/products/preview-northwind-hydration-berry-sparkling-energy-12-cans`)).status, 404);

    scenario = "unhide";
    await cardFor(page, ENERGY).getByRole("button", { name: "Unhide" }).click();
    await page.waitForSelector(`[data-record="${ENERGY}"][data-status="published"]`, { timeout: 10_000 });
    ok("unhiding puts it back", (await servedCategory()).includes("(checked)"));

    scenario = "remove";
    await cardFor(page, ENERGY).getByRole("button", { name: "Remove" }).click();
    await page.waitForSelector(`[data-record="${ENERGY}"]`, { state: "detached", timeout: 10_000 });
    check("one fewer record is staged", stagedCount(), 4);
    ok("and the storefront has dropped it", !(await servedCategory()).includes("(checked)"));

    scenario = "the real catalogue";
    const stillThere = await servedCategory();
    for (const real of ["Sparkling Orange", "Hydration Multiplier", "Root Beer"]) ok(`${real} is still in the storefront`, stillThere.includes(real));
  } finally {
    await browser.close();
    tool.kill("SIGTERM");
    site.kill("SIGTERM");
    rmSync(PREVIEW, { recursive: true, force: true });
  }

  console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
