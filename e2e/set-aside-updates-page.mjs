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

// A no-match search. The relaxation offer used to name the constraint each
// route KEPT, so pressing it removed the only one the route's product met.
const NO_MATCH_TURN = intent([
  { key: "chiller_included", op: "eq", value: true },
  { key: "price", op: "lte", value: usd(5000) },
]);

// Three constraints where no single removal admits anything: no chiller tub is
// under $50 or runs without plumbing, and nothing at all is under $50.
const NO_SINGLE_WAY_OUT_TURN = intent([
  { key: "chiller_included", op: "eq", value: true },
  { key: "price", op: "lte", value: usd(50) },
  { key: "plumbing", op: "eq", value: "none" },
]);

// Eight red-light panels, ranked by price alone.
const CHEAPEST_TURN = { ...intent([]), soft: [{ key: "price", direction: "prefer_low", weight: 1 }] };

// Two bounds on one key, plus one on another. Removing the unrelated one must
// leave both bounds standing: an entry per constraint rather than per key kept
// only the first, and the page then showed everything above $1.40.
const RANGE_TURN = intent([
  { key: "price_per_serving_minor", op: "gte", value: usd(1.4) },
  { key: "price_per_serving_minor", op: "lt", value: usd(1.6) },
  { key: "sugar_g", op: "eq", value: 0 },
]);

let turn = 0;
let script = TURNS;
let categoryPath = "wellness-drinks";
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const chosen = script[Math.min(turn++, script.length - 1)];
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
const gridCards = (page) =>
  page.evaluate(() => {
    // Some category pages carry a second grid with the same classes for the
    // winners row, whose children are links rather than product cards. The
    // product grid is the one built out of <article> cards.
    const grid = [...document.querySelectorAll("div")]
      .filter((d) => d.className.includes("lg:grid-cols-4") && d.className.includes("gap-5"))
      .sort((a, b) => b.querySelectorAll(":scope > article").length - a.querySelectorAll(":scope > article").length)[0];
    if (!grid) return ["(no grid found)"];
    // One href per card, in the order the cards render. A card links to its own
    // product more than once, and scraping the grid's links flat mixed a card's
    // repeats into what looked like extra products.
    return [...grid.children]
      .map((card) => card.querySelector("a[href^='/products/']")?.getAttribute("href"))
      .filter((h) => typeof h === "string" && !h.includes("#"));
  });

const cardHrefs = async (page) => [...(await gridCards(page))].sort();

// The grid in the order it renders, not as a set.
const gridOrder = (page) => gridCards(page);

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

async function open(withScript = TURNS, category = "wellness-drinks") {
  turn = 0;
  script = withScript;
  categoryPath = category;
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log(`  page error: ${e.message}`));
  await page.goto(`${BASE}/${categoryPath}`, { waitUntil: "domcontentloaded" });
  // The launcher renders before React hydrates, so a click can land on a
  // button that is not listening yet. Click until the panel's input appears.
  const launcher = page.getByRole("button", { name: "Help me choose" }).first();
  for (let attempt = 0; attempt < 5; attempt++) {
    await launcher.click();
    try {
      await page.getByPlaceholder(/what matters to you/i).waitFor({ timeout: 3000 });
      return page;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  throw new Error("the assistant panel never opened");
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
  // 5. Two constraints on one key, and an unrelated removal.
  {
    scenario = "two bounds on one key";
    const page = await open([RANGE_TURN]);
    await say(page, "Something between $1.40 and $1.60 a serving with no sugar");
    await page.getByRole("button", { name: "Apply", exact: true }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    await page.waitForTimeout(300);
    await report(page, "Apply two price bounds and zero sugar");
    check("counts all three constraints", await shownCount(page), "1 of 6 shown");
    check("shows the one product inside both bounds", await cardHrefs(page), [SLUG.lmnt]);

    // Zero sugar is on a different key, so removing it must not touch either
    // bound. Keeping only the first would admit everything at or above $1.40.
    await page.getByRole("button", { name: /Remove this constraint/ }).filter({ hasText: /zero total sugar/ }).click();
    await page.waitForTimeout(300);
    await report(page, "chip removal of the unrelated zero-sugar constraint");
    check("keeps both bounds after an unrelated removal", await shownCount(page), "1 of 6 shown");
    check("still shows only the product inside both bounds", await cardHrefs(page), [SLUG.lmnt]);
    check("names both bounds as one entry", await band(page), "From your answersprice per serving of $1.40 or more, price per serving under $1.60Remove");
    await page.close();
  }
  // 6. The relaxation offer, pressed before Apply and after it.
  const COLD = {
    edge: "/products/edge-theory-labs-edge-tub-elite",
    plunge: "/products/plunge-original",
    renu: "/products/renu-therapy-cold-stoic-2-0",
    ice400: "/products/ice-barrel-400",
    ice500: "/products/ice-barrel-500",
    pod: "/products/the-cold-pod-88-gallon",
  };

  for (const order of ["before Apply", "after Apply"]) {
    scenario = `no-match alternative ${order}`;
    const page = await open([NO_MATCH_TURN], "cold-plunge");
    await say(page, "A tub with a chiller, up to $5,000.");
    await page.getByText(/No products match/).first().waitFor({ timeout: 20000 });
    await report(page, "the no-match reply");
    // Nothing has been applied yet, so the page is still whole.
    check("the page is untouched until something is applied", await shownCount(page), "6 of 6 shown");

    if (order === "after Apply") {
      await page.getByRole("button", { name: "Apply", exact: true }).first().click();
      await page.waitForTimeout(300);
      await report(page, "Apply the no-match proposal");
      check("applying a no-match proposal shows nothing", await shownCount(page), "0 of 6 shown");
      check("and no products", await cardHrefs(page), []);
    }

    // Set aside the budget. The route that keeps the chiller is the one this
    // comes from, and its product fails the budget, so dropping the budget is
    // what admits it.
    await setAside(page, "price of \\$5,000 or less");
    await report(page, `set aside the budget, ${order}`);
    check("the chiller requirement is what remains", await shownCount(page), "3 of 6 shown");
    check("and the chiller tubs are what is shown", await cardHrefs(page), [COLD.edge, COLD.plunge, COLD.renu].sort());
    check("the band names the constraint still standing", await band(page), "From your answerschiller includedRemove");
    await page.close();
  }

  // 7. Three constraints, where dropping one still leaves nothing.
  {
    scenario = "no single way out";
    const page = await open([NO_SINGLE_WAY_OUT_TURN], "cold-plunge");
    await say(page, "A tub with a chiller under $50 that needs no plumbing.");
    await page.getByText(/No products match/).first().waitFor({ timeout: 20000 });
    await report(page, "the three-constraint no-match reply");

    const said = await page.getByText(/Setting aside any single one of them still leaves nothing/).count();
    check("the reply does not promise that one removal is enough", said > 0, true);
    const promised = await page.getByText(/so one of them would have to be relaxed/).count();
    check("and does not say the opposite", promised, 0);

    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    await page.waitForTimeout(300);
    await setAside(page, "price of \\$50 or less");
    await report(page, "set aside the budget, two constraints left");
    // Honest: still nothing, because the other two admit nothing together.
    check("still nothing, as the reply said", await shownCount(page), "0 of 6 shown");
    check("and no products", await cardHrefs(page), []);
    check("the band names both constraints still standing", await band(page), "From your answerschiller included; Power and plumbing set to \"None. Fill with a hose\"Remove");
    await page.close();
  }

  // 8. Eight products, ranked by the preference, on the page.
  {
    scenario = "cheapest ordering on the page";
    const page = await open([CHEAPEST_TURN], "red-light");
    await say(page, "Whichever red light panel is least expensive.");
    await page.getByRole("button", { name: "Apply", exact: true }).first().waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Apply", exact: true }).first().click();
    await page.waitForTimeout(300);
    await report(page, "Apply a price preference over eight panels");
    check("all eight are shown", await shownCount(page), "8 of 8 shown");
    // The grid's own order, cheapest first. Ordering by the four ids the
    // engine names left everything from the fifth in catalogue order, and a
    // panel scoring 0 sat above one scoring 24.3.
    check("the grid is in the engine's order, all the way down", await gridOrder(page), [
      "/products/hooga-hg300",
      "/products/mito-red-light-mitomin-2-0",
      "/products/hooga-pro1500",
      "/products/bon-charge-max",
      "/products/mito-red-light-mitopro-1500-plus",
      "/products/infraredi-flex-max",
      "/products/platinumled-biomax-900",
      "/products/joovv-solo-3-0",
    ]);
    await page.close();
  }
} finally {
  await browser.close();
  stub.close();
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
process.exit(failures.length === 0 ? 0 : 1);
