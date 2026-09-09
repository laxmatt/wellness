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
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) {
    console.log(`       expected ${JSON.stringify(expected)}`);
    console.log(`       actual   ${JSON.stringify(actual)}`);
    failures.push(name);
  }
}

const shownCount = (page) => page.getByText(/^\d+ of \d+ shown$/).first().textContent().then((t) => t?.trim());

// Product cards only: the retailer anchors point at the same pages.
const cardHrefs = (page) =>
  page
    .locator("a[href^='/products/']")
    .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("href")).filter((h) => !h.includes("#")))].sort());

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
const page = await browser.newPage();
page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));

try {
  await page.goto(`${BASE}/wellness-drinks`, { waitUntil: "domcontentloaded" });
  await report(page, "load");
  check("the page starts unfiltered", await shownCount(page), "6 of 6 shown");

  await page.getByRole("button", { name: "Help me choose" }).first().click();
  const input = page.getByPlaceholder(/what matters to you/i);
  await input.fill("Zero sugar electrolytes under $2 a serving");
  await input.press("Enter");

  await page.getByText("Which function suits you?").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Apply", exact: true }).first().click();
  await page.waitForTimeout(400);

  await report(page, "Apply on turn one");
  check("the page counts the two constraints", await shownCount(page), "2 of 6 shown");
  check("the page shows the two zero-sugar drinks under $2", await cardHrefs(page), [
    "/products/celsius-sparkling-orange-12-pack",
    "/products/lmnt-citrus-salt-30-stick-packs",
  ]);

  await input.fill("electrolytes, and forget the budget");
  await input.press("Enter");
  await page.getByText(/Did you want to drop/).waitFor({ timeout: 20000 });

  await page.getByRole("button", { name: /Set aside price per serving/ }).click();
  await page.waitForTimeout(400);

  // What the application holds now is zero sugar plus electrolytes, and one
  // product satisfies both.
  await report(page, "Set aside price per serving");
  check("the page counts what is left after setting the budget aside", await shownCount(page), "1 of 6 shown");
  check("the page shows only the zero-sugar electrolyte drink", await cardHrefs(page), ["/products/lmnt-citrus-salt-30-stick-packs"]);
  check("the page still names the constraints it is matching on", (await band(page)) !== null, true);
} finally {
  await browser.close();
  stub.close();
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed: ${failures.join("; ")}`);
process.exit(failures.length === 0 ? 0 : 1);
