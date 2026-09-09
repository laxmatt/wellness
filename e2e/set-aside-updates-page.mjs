/**
 * Does setting a constraint aside change what the category page shows?
 *
 * Not the provider's state: the page. The grid, the "N of M shown" count and
 * the band that names the constraints are what a shopper sees, and the
 * provider has been right while the page disagreed before.
 *
 *   node e2e/set-aside-updates-page.mjs
 *
 * Nothing is paid for. The real page, the real panel and the real route all
 * run; only the model is replaced, by a stub server this script starts and
 * points the app at. Set ASSISTANT_TEST_BASE_URL if the app is not on :3000,
 * and start that app with OPENAI_BASE_URL pointing at MODEL_STUB_URL and its
 * DATABASE_URL on the disposable test database, so a scripted call never
 * reaches the spend ledger the paid runs are recorded in.
 */

import { createServer } from "node:http";
import { chromium } from "playwright";

const BASE = process.env.ASSISTANT_TEST_BASE_URL ?? "http://localhost:3000";
// The container's Chromium: a different build from the one the npm package
// expects, so it is named rather than discovered.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const STUB_PORT = Number(process.env.MODEL_STUB_PORT ?? 3999);

const usd = (amount) => ({ amount, currency: "USD" });
const intent = (hard) => ({ reply: "Noted.", hard, soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] });

// Turn one: the sugar limit and the budget, and the site asks for the function
// it did not get. Turn two: the model answers only the question, so the route
// merges and asks about what it would otherwise have dropped.
const TURNS = [
  intent([
    { key: "sugar_g", op: "eq", value: 0 },
    { key: "price_per_serving_minor", op: "lt", value: usd(2) },
  ]),
  intent([{ key: "function", op: "includes", value: "electrolytes" }]),
];

let turn = 0;
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const chosen = TURNS[Math.min(turn++, TURNS.length - 1)];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(chosen) } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
    );
  });
});
await new Promise((r) => stub.listen(STUB_PORT, r));

const failures = [];
let scenario = "";
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${scenario} :: ${name}`);
  if (!ok) {
    console.log(`       expected ${JSON.stringify(expected)}`);
    console.log(`       actual   ${JSON.stringify(actual)}`);
    failures.push(`${scenario} :: ${name}`);
  }
}

const shownCount = (page) => page.getByText(/^\d+ of \d+ shown$/).first().textContent().then((t) => t?.trim());

// The filtered grid only. The page also links to products from the winners
// row and the ranking sections, which are not what the filters govern, and
// counting those made a correct grid look wrong. Anchored to the "N of M
// shown" control, which sits in the same block as the grid it describes.
const cardHrefs = (page) =>
  page.evaluate(() => {
    const grid = [...document.querySelectorAll("div")].find(
      (d) => d.className.includes("lg:grid-cols-4") && d.className.includes("gap-5"),
    );
    if (!grid) return ["(no grid found)"];
    return [
      ...new Set(
        [...grid.querySelectorAll("a[href^='/products/']")].map((a) => a.getAttribute("href")).filter((h) => h && !h.includes("#")),
      ),
    ].sort();
  });

const band = async (page) => {
  const el = page.getByText("From your answers");
  return (await el.count()) === 0 ? null : ((await el.locator("xpath=..").textContent()) ?? "").replace(/\s+/g, " ").trim();
};

async function report(page, label) {
  console.log(`\n--- page after: ${label}`);
  console.log(`    count:    ${await shownCount(page)}`);
  console.log(`    products: ${JSON.stringify(await cardHrefs(page))}`);
  console.log(`    band:     ${JSON.stringify(await band(page))}`);
}

const browser = await chromium.launch({ executablePath: EXECUTABLE });

// Product ids, as the page links to them, so a claim about what is shown is
// about what a shopper can click.
const SLUG = {
  ag1: "/products/ag1-greens-powder-30-servings",
  celsius: "/products/celsius-sparkling-orange-12-pack",
  cure: "/products/cure-hydration-lemonade-14-pack",
  liquidiv: "/products/liquid-iv-hydration-multiplier-lemon-lime-16",
  lmnt: "/products/lmnt-citrus-salt-30-stick-packs",
  olipop: "/products/olipop-classic-root-beer-12-pack",
};
const ALL_SIX = Object.values(SLUG).sort();

async function open() {
  turn = 0;
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
  await page.goto(`${BASE}/wellness-drinks`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Help me choose" }).first().click();
  return page;
}

const inputOf = (page) => page.getByPlaceholder(/what matters to you/i);

async function say(page, text) {
  const input = inputOf(page);
  await input.fill(text);
  await input.press("Enter");
}

// Turn one, then the mixed answer that makes the site keep two constraints and
// offer to set each aside.
async function upToTheMixedAnswer(page, { apply }) {
  await say(page, "Zero sugar electrolytes under $2 a serving");
  try {
    await page.getByText("Which function suits you?").waitFor({ timeout: 20000 });
  } catch (e) {
    const panel = await page.locator("#assistant-panel").innerText().catch(() => "(no panel)");
    console.log(`  panel said:\n${panel.split("\n").slice(0, 12).join("\n")}`);
    throw e;
  }
  if (apply) {
    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    await page.waitForTimeout(300);
    await report(page, "Apply on turn one");
    check("the page counts the two constraints", await shownCount(page), "2 of 6 shown");
    check("the page shows the two zero-sugar drinks under $2", await cardHrefs(page), [SLUG.celsius, SLUG.lmnt].sort());
  }
  await say(page, "electrolytes, and forget the budget");
  await page.getByText(/Did you want to drop/).waitFor({ timeout: 20000 });
  if (!apply) {
    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    await page.waitForTimeout(300);
  }
}

async function setAside(page, label) {
  await page.getByRole("button", { name: new RegExp(`Set aside ${label}`) }).click();
  await page.waitForTimeout(300);
}

try {
  // 1. Apply, then the alternative.
  {
    scenario = "Apply then alternative";
    const page = await open();
    await report(page, "load");
    check("the page starts unfiltered", await shownCount(page), "6 of 6 shown");
    await upToTheMixedAnswer(page, { apply: true });
    await setAside(page, "price per serving under \\$2");
    await report(page, "Set aside price per serving");
    check("counts what remains", await shownCount(page), "1 of 6 shown");
    check("shows the zero-sugar electrolyte drink only", await cardHrefs(page), [SLUG.lmnt]);
    check("names the constraints still standing", await band(page), "From your answerszero total sugar; function includes ElectrolytesRemove");
    await page.close();
  }

  // 2. The alternative before Apply. The proposal is applied without the one
  //    constraint, so the page must land on the same place.
  {
    scenario = "alternative before Apply";
    const page = await open();
    await say(page, "Zero sugar electrolytes under $2 a serving");
    await page.getByText("Which function suits you?").waitFor({ timeout: 20000 });
    await say(page, "electrolytes, and forget the budget");
    await page.getByText(/Did you want to drop/).waitFor({ timeout: 20000 });
    await setAside(page, "price per serving under \\$2");
    await report(page, "Set aside price per serving, no Apply pressed");
    check("counts what remains", await shownCount(page), "1 of 6 shown");
    check("shows the zero-sugar electrolyte drink only", await cardHrefs(page), [SLUG.lmnt]);
    check("names the constraints still standing", await band(page), "From your answerszero total sugar; function includes ElectrolytesRemove");
    await page.close();
  }

  // 3. Two successive alternatives. The second must answer from what the first
  //    left, not from a set precomputed for removing one.
  {
    scenario = "two successive alternatives";
    const page = await open();
    await upToTheMixedAnswer(page, { apply: true });
    await setAside(page, "price per serving under \\$2");
    await report(page, "first: set aside price per serving");
    check("counts what remains after one", await shownCount(page), "1 of 6 shown");
    await setAside(page, "zero total sugar");
    await report(page, "second: set aside zero total sugar");
    check("counts what remains after two", await shownCount(page), "3 of 6 shown");
    check("shows every electrolyte drink", await cardHrefs(page), [SLUG.cure, SLUG.liquidiv, SLUG.lmnt].sort());
    check("names only the constraint still standing", await band(page), "From your answersfunction includes ElectrolytesRemove");
    await page.close();
  }

  // 4. The constraint chip's own remove control, which published the same null.
  {
    scenario = "constraint chip removal";
    const page = await open();
    await upToTheMixedAnswer(page, { apply: true });
    // Apply the merged proposal, so all three constraints are on the page and
    // its chips. Without this the chips carry only the first two, and a
    // removal is correct on two constraints rather than three.
    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    await page.waitForTimeout(300);
    await report(page, "Apply the merged proposal");
    check("the page counts all three constraints", await shownCount(page), "1 of 6 shown");

    await page.getByRole("button", { name: /Remove this constraint/ }).filter({ hasText: /price per serving/ }).click();
    await page.waitForTimeout(300);
    await report(page, "chip removal of price per serving");
    check("counts what remains", await shownCount(page), "1 of 6 shown");
    check("shows the zero-sugar electrolyte drink only", await cardHrefs(page), [SLUG.lmnt]);

    await page.getByRole("button", { name: /Remove this constraint/ }).filter({ hasText: /zero total sugar/ }).click();
    await page.waitForTimeout(300);
    await report(page, "chip removal of zero total sugar");
    check("counts what remains after two chip removals", await shownCount(page), "3 of 6 shown");
    check("shows every electrolyte drink", await cardHrefs(page), [SLUG.cure, SLUG.liquidiv, SLUG.lmnt].sort());

    await page.getByRole("button", { name: /Remove this constraint/ }).filter({ hasText: /function includes/ }).click();
    await page.waitForTimeout(300);
    await report(page, "chip removal of the last constraint");
    check("returns to unfiltered when nothing is left", await shownCount(page), "6 of 6 shown");
    check("shows every product", await cardHrefs(page), ALL_SIX);
    await page.close();
  }
} finally {
  await browser.close();
  stub.close();
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
process.exit(failures.length === 0 ? 0 : 1);
