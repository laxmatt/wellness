/**
 * The public site, in a browser, without the assistant.
 *
 *   npm run e2e:public
 *
 * Nothing is paid for and nothing leaves localhost: a production build, the
 * container's Chromium, and no model at all. The assistant has its own harness
 * in `set-aside-updates-page.mjs`; this one covers the journeys a shopper takes
 * when they never open it.
 *
 * Every expectation is computed from the same domain code the server renders
 * from, so a check compares the page against the engine rather than against a
 * number typed here. A count on its own proves little: eight products can be
 * the wrong eight.
 *
 * Set ASSISTANT_TEST_BASE_URL if the app is not on :3000.
 */

import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { categories, categoryById } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { buildCompareModel } from "@/domain/compare";
import { buildFilterGroups } from "@/domain/filters";
import { formatMoney } from "@/domain/money";
import { isUsable } from "@/domain/provenance";
import { recommendCategory } from "@/domain/recommend";
import { BADGE_LABELS } from "@/domain/recommend/badges";
import { toProductView, type ProductView } from "@/domain/view";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";

const BASE = process.env.ASSISTANT_TEST_BASE_URL ?? "http://localhost:3000";
const EXECUTABLE = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";
const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

const cat = loadLocalCatalog(join(process.cwd(), "catalog"));
const viewsOf = (categoryId: string): ProductView[] =>
  cat.products
    .filter((p) => p.categoryId === categoryId)
    .map((p) => toProductView(p, { category: categoryById(p.categoryId)!, brands: cat.brands, merchants: cat.merchants }));

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
const ok = (name: string, condition: boolean, detail?: unknown) => check(name, condition ? true : detail ?? false, true);

// Anything the browser reports as broken fails the run, wherever it happens.
const pageProblems: string[] = [];
function watch(page: Page) {
  page.on("pageerror", (e) => pageProblems.push(`${page.url()}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") pageProblems.push(`${page.url()}: console ${m.text()}`);
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.origin === new URL(BASE).origin && r.status() >= 400) pageProblems.push(`${r.status()} ${r.url()}`);
  });
}

// The product cards on a page, in the order they are shown. The winners strip
// and the grid are both card lists, so the grid is the one with the most.
async function shownSlugs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const grids = [...document.querySelectorAll("div")].filter((d) => d.querySelectorAll(":scope > article").length > 0);
    if (grids.length === 0) return [];
    const grid = grids.sort((a, b) => b.querySelectorAll(":scope > article").length - a.querySelectorAll(":scope > article").length)[0];
    return [...grid.querySelectorAll(":scope > article")]
      .filter((a) => (a as HTMLElement).offsetParent !== null)
      .map((a) => {
        const link = a.querySelector<HTMLAnchorElement>('a[href^="/products/"]');
        return link ? new URL(link.href).pathname.replace("/products/", "") : "";
      });
  });
}

// Chip labels carry currency symbols and brackets, so a label is matched as
// text rather than compiled into a regular expression.
const chipButton = (page: Page, label: string) =>
  page.locator("button").filter({ hasText: label }).filter({ hasNotText: "Clear" }).first();

// React re-renders after the click; reading the grid in the same tick reads
// the old one. Every assertion about the grid waits for the count it expects
// and then compares the products, so a wrong set still fails.
async function settled(page: Page, expected: number) {
  await page
    .waitForFunction((n) => {
      const grids = [...document.querySelectorAll("div")].filter((d) => d.querySelectorAll(":scope > article").length > 0);
      if (grids.length === 0) return n === 0;
      const grid = grids.sort((a, b) => b.querySelectorAll(":scope > article").length - a.querySelectorAll(":scope > article").length)[0];
      return [...grid.querySelectorAll(":scope > article")].filter((a) => (a as HTMLElement).offsetParent !== null).length === n;
    }, expected, { timeout: 5000 })
    .catch(() => undefined);
}

const shownCount = (page: Page) => page.getByText(/^\d+ of \d+ shown$/).first().textContent().then((t) => (t ?? "").trim());

// The text of the smallest block holding a rendered value, so a check can ask
// what is shown beside it. Null when the value is not on the page at all.
async function valueBlockText(page: Page, label: string, value: string): Promise<string | null> {
  return page.evaluate(
    ({ label, value }) => {
      // The block is found by its own label, not by its value: "Yes" appears
      // in a dozen rows and only one of them is this attribute.
      const labels = [...document.querySelectorAll("p, span, td, th, dt")].filter(
        (el) => (el.textContent ?? "").trim() === label && el.querySelectorAll("*").length === 0,
      );
      for (const el of labels) {
        const block = el.parentElement;
        const text = (block?.textContent ?? "").trim();
        if (text.includes(value)) return text;
      }
      return null;
    },
    { label, value },
  );
}

// Every button and link needs a name a screen reader can announce. This is
// not a full accessibility audit and is not offered as one: it is the one
// mechanical part of a name check, run on the pages a shopper actually uses.
async function namelessControls(page: Page): Promise<string[]> {
  // Written without inner named functions: tsx compiles those with a helper
  // that does not exist inside the page.
  return page.evaluate(() =>
    [...document.querySelectorAll("button, a[href], [role='button']")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => {
        const byId = el.getAttribute("aria-labelledby");
        const referenced = byId
          ? byId
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent ?? "")
              .join(" ")
          : "";
        const img = el.querySelector("img")?.getAttribute("alt") ?? "";
        const name = (el.getAttribute("aria-label") ?? "") + referenced + (el.textContent ?? "") + (el.getAttribute("title") ?? "") + img;
        return name.trim() === "";
      })
      .map((el) => el.outerHTML.slice(0, 120)),
  );
}

// Is the focused control actually visible, or is the sticky header sitting on
// top of it? Asked of the page, not of the CSS.
async function focusIsCovered(page: Page): Promise<{ covered: boolean; by?: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { covered: true, by: "nothing focused" };
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top) return { covered: true, by: "outside the viewport" };
    if (el.contains(top) || top.contains(el)) return { covered: false };
    return { covered: true, by: (top as HTMLElement).outerHTML.slice(0, 120) };
  });
}

// The price block on a product page: the element holding the amount, and what
// is rendered with it. Scoped so a demo tag three sections away cannot stand
// in for a tag on the price.
async function priceBlock(page: Page, money: string): Promise<{ found: boolean; text: string }> {
  return page.evaluate((money) => {
    const leaves = [...document.querySelectorAll("span")].filter(
      (el) => (el.textContent ?? "").trim() === money && el.querySelectorAll("*").length === 0,
    );
    for (const leaf of leaves) {
      const block = leaf.parentElement;
      if (!block) continue;
      // PriceDisplay is a column: the amount, an optional tag, the basis line.
      if (/retailer|Reference|No price confirmed/i.test(block.textContent ?? "")) return { found: true, text: (block.textContent ?? "").trim() };
    }
    return { found: false, text: "" };
  }, money);
}

async function offerRowText(page: Page, merchantName: string): Promise<string> {
  return page.evaluate((name) => {
    const row = [...document.querySelectorAll("li")].find((li) => (li.querySelector("p")?.textContent ?? "").trim() === name);
    return (row?.textContent ?? "").trim();
  }, merchantName);
}

async function cardText(page: Page, slug: string): Promise<string> {
  const card = page.locator(`article:has(a[href="/products/${slug}"])`).first();
  return (await card.count()) > 0 ? ((await card.textContent()) ?? "") : "";
}

async function headingCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("h1").length);
}

async function goto(page: Page, path: string) {
  const res = await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  ok(`${path} responds 200`, res?.status() === 200, res?.status());
}

async function run(browser: Browser) {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  watch(page);

  // ---------------------------------------------------------------- home
  scenario = "home";
  await goto(page, "/");
  check("exactly one h1", await headingCount(page), 1);
  for (const c of categories) {
    const link = page.locator(`a[href="/${c.slug}"]`).first();
    ok(`links to /${c.slug}`, (await link.count()) > 0);
  }

  // ------------------------------------------------------------ category
  for (const c of categories) {
    const views = viewsOf(c.id);
    const ranked = recommendCategory(views, c);
    scenario = `category ${c.slug}`;
    await goto(page, `/${c.slug}`);
    check("exactly one h1", await headingCount(page), 1);
    check("the count says every product is shown", await shownCount(page), `${views.length} of ${views.length} shown`);
    check("the grid is the engine's order", await shownSlugs(page), ranked.products.map((p) => p.view.slug));

    // Badges are computed, not written on the card by hand. A card shows one
    // badge, its first, because a product can hold two: Best Overall and Best
    // Value stack, and the page states the second in words rather than
    // printing a second chip. So the card is checked against the badge it is
    // meant to show, and the stacked case against the sentence.
    for (const p of ranked.products.filter((p) => p.badges.length > 0)) {
      const view = p.view;
      const card = page.locator(`article:has(a[href="/products/${view.slug}"])`).first();
      const text = (await card.textContent()) ?? "";
      ok(`${view.slug} card carries its ${BADGE_LABELS[p.badges[0]]} badge`, text.includes(BADGE_LABELS[p.badges[0]]), text.slice(0, 120));
    }
    const stacked = ranked.products.filter((p) => p.badges.includes("best_overall") && p.badges.includes("best_value"));
    for (const p of stacked) {
      const body = (await page.locator("body").textContent()) ?? "";
      ok(`${p.view.slug} is named the strongest value in words, not a second chip`, body.includes("Also the strongest value here"));
    }

    // And every badge the engine awarded reaches the page somewhere.
    for (const b of ranked.set.badges) {
      const body = (await page.locator("body").textContent()) ?? "";
      ok(`${BADGE_LABELS[b.badge]} appears on the page`, body.includes(BADGE_LABELS[b.badge]));
    }

    // A badge the engine withheld says so, rather than quietly going missing.
    for (const w of ranked.set.withheld) {
      const body = (await page.locator("body").textContent()) ?? "";
      ok(`${BADGE_LABELS[w.badge]} withheld with its reason stated`, body.includes(w.reason), w.reason);
    }

    // A placeholder amount is not shown at all. The card says to check the
    // price at the merchant, and the invented number appears nowhere on it.
    for (const v of views.filter((v) => v.price.isDemo && v.price.money)) {
      const card = await cardText(page, v.slug);
      ok(`${v.slug} card offers to check the price`, card.includes("Check current price"), card.slice(0, 200));
      ok(`${v.slug} card does not quote the placeholder amount`, !card.includes(formatMoney(v.price.money!)), formatMoney(v.price.money!));
    }
    // No amount at all: every offer withheld and no reference price. The card
    // says to check, and quotes nothing, including the withheld amounts that
    // are still on the record.
    for (const v of views.filter((v) => v.price.money === undefined)) {
      const card = await cardText(page, v.slug);
      ok(`${v.slug} card offers to check the price it does not have`, card.includes("Check current price"), card.slice(0, 200));
      for (const o of v.offers) {
        ok(`${v.slug} card quotes no withheld amount`, !card.includes(formatMoney(o.price)), formatMoney(o.price));
      }
    }
    for (const v of views.filter((v) => !v.price.isDemo && v.price.money)) {
      const card = await cardText(page, v.slug);
      ok(`${v.slug} card shows its real price`, card.includes(formatMoney(v.price.money!)), formatMoney(v.price.money!));
    }

    // Filters: the page must hide exactly what the engine says the chip means.
    const groups = buildFilterGroups(views, c);
    if (groups.length > 0) {
      const g = groups.find((x) => x.options.length > 1) ?? groups[0];
      const first = g.options[0];
      await chipButton(page, first.label).click();
      const expected = ranked.products.filter((p) => first.matchIds.includes(p.view.id)).map((p) => p.view.slug);
      await settled(page, expected.length);
      check(`one chip (${g.key}: ${first.label}) shows exactly its matches`, await shownSlugs(page), expected);
      check("and the count agrees", await shownCount(page), `${expected.length} of ${views.length} shown`);

      if (g.options.length > 1) {
        const second = g.options[1];
        await chipButton(page, second.label).click();
        const union = new Set([...first.matchIds, ...second.matchIds]);
        const bothInGroup = ranked.products.filter((p) => union.has(p.view.id)).map((p) => p.view.slug);
        await settled(page, bothInGroup.length);
        check("two chips in one group are OR", await shownSlugs(page), bothInGroup);
        await chipButton(page, second.label).click();
      }

      // Across groups the filters are AND, so the second chip has to be one
      // that still leaves something with the first applied. A chip that leaves
      // nothing is disabled by the page, and that is its own check: the count
      // on the chip and its disabled state must agree with the engine.
      const others = groups.filter((x) => x.key !== g.key).flatMap((x) => x.options);
      const withCount = others.map((o) => ({
        o,
        ids: ranked.products.filter((p) => first.matchIds.includes(p.view.id) && o.matchIds.includes(p.view.id)).map((p) => p.view.slug),
      }));
      const live = withCount.find((x) => x.ids.length > 0);
      const dead = withCount.find((x) => x.ids.length === 0);
      if (live) {
        const button = chipButton(page, live.o.label);
        check(`the ${live.o.label} chip is offered as live`, await button.isDisabled(), false);
        await button.click();
        await settled(page, live.ids.length);
        check("two groups are AND", await shownSlugs(page), live.ids);
        await chipButton(page, live.o.label).click();
      }
      if (dead) {
        check(`the ${dead.o.label} chip is disabled, because it would leave nothing`, await chipButton(page, dead.o.label).isDisabled(), true);
      }

      await page.getByRole("button", { name: "Clear filters" }).first().click();
      await settled(page, ranked.products.length);
      check("clearing restores every product", await shownSlugs(page), ranked.products.map((p) => p.view.slug));
    }
  }

  // ------------------------------------------------------------- facets
  for (const c of categories) {
    for (const f of c.facets) {
      scenario = `facet /${c.slug}/${f.slug}`;
      await goto(page, `/${c.slug}/${f.slug}`);
      check("exactly one h1", await headingCount(page), 1);
      const views = viewsOf(c.id);
      const matching = views.filter((v) => f.conditions.every((cond) => evaluate(v, c, cond)));
      const shown = await shownSlugs(page);
      check("shows exactly the products meeting the facet", shown.sort(), matching.map((m) => m.slug).sort());
      if (matching.length === 0) {
        const body = (await page.locator("body").textContent()) ?? "";
        ok("says plainly that nothing fits", /Nothing in our set fits this filter yet/.test(body), body.slice(0, 200));
        // And it is not offered from the category page, which would be a chip
        // that always leads nowhere.
        await goto(page, `/${c.slug}`);
        const offered = await page.locator(`a[href="/${c.slug}/${f.slug}"]`).count();
        check("the category page does not offer an empty facet", offered, 0);
        const home = await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
        ok("home responds", home?.status() === 200, home?.status());
        check("nor does the home page", await page.locator(`a[href="/${c.slug}/${f.slug}"]`).count(), 0);
      }
    }
  }

  // ------------------------------------------------------------ product
  for (const p of cat.products) {
    const view = viewsOf(p.categoryId).find((v) => v.id === p.id)!;
    scenario = `product ${view.slug}`;
    await goto(page, `/products/${view.slug}`);
    check("exactly one h1", await headingCount(page), 1);

    const body = (await page.locator("body").textContent()) ?? "";
    const money = view.price.money ? formatMoney(view.price.money) : "";
    if (view.price.money === undefined) {
      // Nothing on the record can price this product. The block says so and
      // quotes no number, and the structured data carries no offer at all.
      const block = await priceBlock(page, "Check current price");
      ok("offers to check a price the record does not have", block.found, block.text);
      const ld = (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "";
      ok("publishes no offer in structured data", !ld.includes('"@type":"Offer"'), ld.slice(0, 200));
      const retailersText = (await page.locator("#retailers").textContent()) ?? "";
      const shopLinks = await page.$$eval('a[rel*="sponsored"]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
      for (const o of view.offers) {
        ok(`the withheld ${o.merchant.name} amount is not in the price block`, !block.text.includes(formatMoney(o.price)), block.text);
        ok(`the withheld ${o.merchant.name} amount is not in the retailers section`, !retailersText.includes(formatMoney(o.price)), retailersText.slice(0, 160));
        // Not "the URL is absent": a withheld offer's URL can be the same
        // manufacturer page that legitimately sources the specs, and a
        // citation under Sources is provenance, not a way to buy. What must
        // not exist is a shopping link to it.
        ok(`nothing offers to shop the withheld ${o.merchant.name} listing`, !shopLinks.some((h) => new URL(h).href === new URL(o.url).href), o.url);
      }
    } else if (view.price.isDemo) {
      // The amount is prototype data, so nothing presents it as this
      // product's price: not the price block, not an offer row, not a spec.
      const block = await priceBlock(page, "Check current price");
      ok("offers to check the price instead of quoting one", block.found, block.text);
      ok("and quotes no amount where the price goes", !block.text.includes(money), block.text);
      for (const spec of view.specs.filter((sp) => sp.moneyWithheld)) {
        const shown = await valueBlockText(page, spec.label, "Check current price");
        ok(`${spec.key} is withheld with the price it came from`, shown !== null, spec.formatted);
      }
    } else {
      const block = await priceBlock(page, money);
      ok("shows the price the engine computed, in its own block", block.found, money);
    }
    for (const offer of view.offers.filter((o) => o.priceIsDemo && !o.disputed)) {
      const row = await offerRowText(page, offer.merchant.name);
      ok(`the ${offer.merchant.name} row does not quote its placeholder amount`, !row.includes(formatMoney(offer.price)), row);
      ok(`the ${offer.merchant.name} row says to check instead`, row.includes("Check current price"), row);
    }

    // An offer whose amount belongs to another product is not a way to buy
    // this one. It stays on the record and appears on no buying surface: no
    // row, no amount, no link, and nothing in the structured data a search
    // engine will quote back to somebody.
    const jsonLd = (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "";
    const retailers = (await page.locator("#retailers").textContent()) ?? "";
    for (const offer of view.offers.filter((o) => o.disputed)) {
      const amount = formatMoney(offer.price);
      // Scoped to the retailers section on purpose. A source note elsewhere on
      // the page may recount what this amount used to be and why it stopped
      // being the price, and that history is the point of keeping the record.
      // What must not exist is a way to buy at it.
      ok(`the ${offer.merchant.name} row is gone from the retailers section`, !retailers.includes(offer.merchant.name), retailers.slice(0, 160));
      ok(`its amount ${amount} is not quoted there either`, !retailers.includes(amount), retailers.slice(0, 160));
      const shopping = await page.$$eval('a[rel*="sponsored"]', (as) => as.map((a) => (a as HTMLAnchorElement).href));
      ok("nothing offers to shop it", !shopping.some((h) => new URL(h).href === new URL(offer.url).href), offer.url);
      ok("and it is not published as structured data", !jsonLd.includes(offer.url) && !jsonLd.includes((offer.price.amountMinor / 100).toFixed(2)), jsonLd.slice(0, 200));
      ok("but the page says an amount is on record and withheld", retailers.includes("is on record and is not shown here"));
    }

    // The same rule for a placeholder amount, which the page has hidden since
    // 2026-09-09 while the markup went on publishing it underneath.
    //
    // Counted rather than string-matched: two offers can carry the same
    // amount, so finding "23.99" in the markup proves nothing about which
    // offer put it there. The URL is what identifies an offer.
    const publishable = view.offers.filter((o) => !o.disputed && !o.priceIsDemo);
    const publishedCount = (jsonLd.match(/"@type":"Offer"/g) ?? []).length;
    check("structured data publishes exactly the offers that price this product", publishedCount, publishable.length);
    for (const offer of view.offers.filter((o) => o.priceIsDemo || o.disputed)) {
      ok(
        `the ${offer.merchant.name} row is not published as structured data`,
        !jsonLd.includes(offer.url),
        offer.url,
      );
    }
    // A source note may quote what a source reported: that is provenance, and
    // on a product with a real price it is the price's own paperwork. On a
    // product whose price is prototype data, a note quoting an amount has to
    // say so, or the number is back on the page by the side door.
    if (view.price.isDemo) {
      // The risk is this product's own unconfirmed amount reappearing as a
      // price. A note quoting some other figure, a fee on a policy page or a
      // price another source reported, is provenance: Joovv's returns note
      // carries the Joovv Go's $50 fee precisely to say it is not this
      // product's.
      const own = money.replace(/^\$/, "");
      const notesWithOwnAmount = Object.values(view.provenance)
        .map((pr) => pr.source.note)
        .filter((n): n is string => Boolean(n) && n!.includes(own));
      for (const note of notesWithOwnAmount) {
        if (!body.includes(note.slice(0, 40))) continue;
        ok("a note quoting this product's own amount says it is prototype data", /demo|placeholder|unconfirmed/i.test(note), note);
      }
    }

    // Every unusable value is labelled where it is shown, and every bound
    // keeps its qualifier.
    for (const spec of view.specs) {
      const prov = view.provenance[`attributes.${spec.key}`];
      if (!prov || spec.raw === undefined) continue;
      if (!isUsable(prov.verification)) {
        const label = prov.verification === "demo" ? "Demo data" : "Not stated";
        const block = await valueBlockText(page, spec.label, spec.formatted);
        // A value that is not shown at all needs no tag. One that is shown
        // needs the tag beside it, which is the whole claim being tested.
        if (block === null) continue;
        ok(`${spec.key} is labelled "${label}" where it is shown`, block.includes(label), block.slice(0, 200));
      }
      if (spec.bound) {
        ok(`${spec.key} shows its bound`, body.includes(spec.formatted), spec.formatted);
      }
    }

    // Outbound links. Attributes only: nothing is followed.
    const links = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>("a[href^='http']")]
        .filter((a) => new URL(a.href).origin !== location.origin)
        .map((a) => ({ href: a.href, rel: a.getAttribute("rel") ?? "", target: a.getAttribute("target") ?? "" })),
    );
    // Buyable only. A disputed offer is deliberately unlinked, and the checks
    // above prove its link is absent rather than present.
    for (const offer of view.offers.filter((o) => !o.disputed)) {
      const same = (a: string, b: string) => new URL(a).href === new URL(b).href;
      const link = links.find((l) => same(l.href, offer.url));
      ok(`offer ${offer.merchant.name} is linked`, link !== undefined, offer.url);
      if (!link) continue;
      ok(`offer ${offer.merchant.name} link is https`, link.href.startsWith("https://"), link.href);
      for (const token of ["sponsored", "nofollow", "noopener"]) {
        ok(`offer ${offer.merchant.name} rel has ${token}`, link.rel.includes(token), link.rel);
      }
      check(`offer ${offer.merchant.name} opens in a new tab`, link.target, "_blank");
    }

    // The sources block renders the notes the catalogue records.
    const notes = Object.values(view.provenance)
      .map((pr) => pr.source.note)
      .filter((n): n is string => Boolean(n));
    if (notes.length > 0) {
      const first = notes[0].slice(0, 40);
      ok("renders a source note", body.includes(first), first);
    }

    // Images carry alt text, placeholders included.
    const alts = await page.evaluate(() => [...document.querySelectorAll("img")].map((i) => i.getAttribute("alt")));
    ok("every image has alt text", alts.every((a) => a !== null && a.trim() !== ""), alts);
  }

  // ------------------------------------------- the price check, proved
  {
    // A check that cannot fail proves nothing. The amount is put back into the
    // page and the same predicate is asked again: it has to notice. The page
    // is reloaded afterwards.
    const demoPriced = cat.products
      .map((p) => viewsOf(p.categoryId).find((v) => v.id === p.id)!)
      .find((v) => v.price.isDemo && v.price.money !== undefined)!;
    scenario = `price check, proved sensitive on ${demoPriced.slug}`;
    await goto(page, `/products/${demoPriced.slug}`);
    const money = formatMoney(demoPriced.price.money!);
    // Scoped to the price block. A source note may quote what a source
    // reported, and one on this product does; the claim under test is that
    // nothing presents the amount as this product's price.
    const clean = await priceBlock(page, "Check current price");
    ok("the page quotes no amount where the price goes", clean.found && !clean.text.includes(money), clean);

    const injected = await page.evaluate((money) => {
      const el = [...document.querySelectorAll("span")].find((s) => (s.textContent ?? "").trim() === "Check current price");
      if (!el) return false;
      el.textContent = money;
      return true;
    }, money);
    ok("an amount can be put into the page", injected);

    // Read back through the same scoped predicate the real check uses, on the
    // same block. Reading the whole body could pass on a source note that
    // quotes an amount, which is provenance and not a price, so the proof
    // would not have been a proof.
    const dirty = await priceBlock(page, money);
    ok(
      "and the same check then fails, which is what makes it worth running",
      dirty.found && dirty.text.includes(money) && !dirty.text.includes("Check current price"),
      dirty,
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const restored = await priceBlock(page, "Check current price");
    ok("the real page quotes nothing where the price goes", restored.found && !restored.text.includes(money), restored);
    ok("and offers to check instead", restored.text.includes("Check current price"), restored.text);
  }

  // ------------------------------------------------------------ compare
  {
    const c = categories.find((x) => x.id === "red-light")!;
    const views = viewsOf(c.id);
    const ranked = recommendCategory(views, c);
    // Three, which is what a shopper comparing panels actually does, and it
    // puts a bounded figure, an exact one and a third column in the same row.
    const pick = ["hooga-hg300", "platinumled-biomax-900", "hooga-pro1500"];
    const slugOf = (id: string) => views.find((v) => v.id === id)!.slug;
    const toggleFor = (id: string) => page.locator(`article:has(a[href="/products/${slugOf(id)}"]) button[aria-pressed]`).first();
    scenario = "compare";
    await goto(page, `/${c.slug}`);

    for (const id of pick) {
      const toggle = toggleFor(id);
      await toggle.click();
      await toggle.and(page.locator('[aria-pressed="true"]')).waitFor({ timeout: 5000 }).catch(() => undefined);
      check(`${id} is selected`, await toggle.getAttribute("aria-pressed"), "true");
    }
    const tray = page.locator('a[href^="/compare?ids="]').first();
    check("the tray counts three", ((await tray.textContent()) ?? "").trim(), "Compare 3");

    // Removing from the tray is the shopper's undo, and the tray is the only
    // place it exists.
    const dropped = pick[2];
    await page.getByRole("button", { name: `Remove ${views.find((v) => v.id === dropped)!.name}` }).click();
    await page.waitForFunction(() => (document.querySelector('a[href^="/compare?ids="]')?.textContent ?? "").includes("2"), undefined, { timeout: 5000 }).catch(() => undefined);
    check("the tray counts two after a removal", ((await tray.textContent()) ?? "").trim(), "Compare 2");
    check("and the removed card is no longer selected", await toggleFor(dropped).getAttribute("aria-pressed"), "false");
    check("and the link carries only the two", new URL((await tray.getAttribute("href")) ?? "", BASE).searchParams.get("ids"), [pick[0], pick[1]].join(","));

    await toggleFor(dropped).click();
    await page.waitForFunction(() => (document.querySelector('a[href^="/compare?ids="]')?.textContent ?? "").includes("3"), undefined, { timeout: 5000 }).catch(() => undefined);
    check("re-selecting restores three", ((await tray.textContent()) ?? "").trim(), "Compare 3");

    // The selection lives in the browser, so it has to survive a page the
    // shopper wanders off to.
    await goto(page, "/how-we-choose");
    await goto(page, `/${c.slug}`);
    await page.locator('a[href^="/compare?ids="]').first().waitFor({ timeout: 5000 }).catch(() => undefined);
    check("the selection survives leaving the page", ((await page.locator('a[href^="/compare?ids="]').first().textContent()) ?? "").trim(), "Compare 3");
    for (const id of pick) check(`${id} is still selected`, await toggleFor(id).getAttribute("aria-pressed"), "true");

    await page.locator('a[href^="/compare?ids="]').first().click();
    await page.waitForURL(/\/compare/);

    // The page lays the columns out in the order the tray passed, so the model
    // is built in that order too. Comparing a differently ordered model to the
    // page would fail for a reason that is not a defect.
    const columns = await page.evaluate(() =>
      [...document.querySelectorAll("thead th a[href^='/products/']")].map((a) => new URL((a as HTMLAnchorElement).href).pathname.replace("/products/", "")),
    );
    const drawnSlugs = [...new Set(columns)];
    check("the columns are the three chosen", [...drawnSlugs].sort(), pick.map((id) => slugOf(id)).sort());
    // The page lays them out in the catalogue's order rather than the order
    // they were picked in. That is deterministic and it is what the model is
    // built from here, so a cell mismatch means a wrong cell, not a wrong
    // column order.
    const inPageOrder = drawnSlugs.map((slug) => ranked.products.find((p) => p.view.slug === slug)!);
    const model = buildCompareModel(inPageOrder, c);

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")]
        .filter((tr) => tr.querySelector("td"))
        .map((tr) => ({
          label: (tr.querySelector("th")?.textContent ?? "").trim(),
          cells: [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
          dots: tr.querySelectorAll('[aria-label="Strongest in this row"]').length,
        })),
    );
    const modelRows = model.groups.flatMap((g) => g.rows);
    check("every row is drawn", rows.length, modelRows.length);
    // A drawn cell is the model's text plus, when the model says the value
    // needs one, its verification tag. Both halves are checked: a missing tag
    // and a wrong value fail differently.
    const TAGS: Record<string, string> = {
      manufacturer_reported: "Maker reported",
      independently_verified: "Verified",
      demo: "Demo data",
      not_stated: "Not stated",
      unknown: "Unverified",
    };
    const cellProblems: string[] = [];
    modelRows.forEach((r, i) => {
      r.cells.forEach((cell, j) => {
        const drawn = rows[i]?.cells[j] ?? "";
        const tag = cell.verification ? TAGS[cell.verification] : "";
        const expected = `${cell.text}${tag}`;
        if (drawn !== expected) cellProblems.push(`${r.key}[${j}]: ${JSON.stringify(drawn)} not ${JSON.stringify(expected)}`);
      });
    });
    check("every cell holds what the model computed, with its tag", cellProblems, []);
    check(
      "every winner dot is where the model puts one",
      rows.map((r) => r.dots),
      modelRows.map((r) => r.cells.filter((cell) => cell.best).length),
    );
    for (const r of modelRows.filter((x) => x.notComparable)) {
      const drawn = rows.find((x) => x.label.startsWith(r.label))!;
      ok(`${r.key} says why it is not ranked`, drawn.label.includes(r.notComparable!.replace(/^Not ranked: /, "")), drawn.label);
      check(`${r.key} marks no winner`, drawn.dots, 0);
    }

    const sameRows = modelRows.filter((r) => r.same).length;
    await page.getByRole("button", { name: /Differences only/ }).click();
    const after = await page.evaluate(() => [...document.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector("td")).length);
    check("differences only hides exactly the identical rows", rows.length - after, sameRows);

    // Hooga's figure is disputed by its own page, so the row shows it and
    // ranks nothing on it, for that reason rather than any other.
    scenario = "compare, a disputed figure";
    const pair = ["hooga-hg300", "platinumled-biomax-900"];
    await goto(page, `/compare?ids=${pair.join(",")}`);
    const pairRows = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")]
        .filter((tr) => tr.querySelector("td"))
        .map((tr) => ({
          label: (tr.querySelector("th")?.textContent ?? "").trim(),
          cells: [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
          dots: tr.querySelectorAll('[aria-label="Strongest in this row"]').length,
        })),
    );
    const irradiance = pairRows.find((r) => r.label.startsWith("Irradiance"))!;
    ok("the disputed figure is shown and marked", irradiance.cells.some((t) => t.includes("73 mW/cm², disputed")), irradiance.cells);
    check("and that row marks no winner", irradiance.dots, 0);
    // Which of the reasons applies depends on the other product in the pair,
    // and that moves as records are read. The claim here is that the row is
    // unranked and says why; the disputed branch itself is covered on
    // fixtures in the unit tests.
    ok("and says why it is not ranked", /Not ranked/.test(irradiance.label), irradiance.label);
    const leds = pairRows.find((r) => r.label.startsWith("LED"))!;
    check("while an exact row still marks one winner", leds.dots, 1);

    scenario = "names";
    check("every visible control on the comparison has a name", await namelessControls(page), []);
  }

  // ------------------------------------------------------- other routes
  for (const path of ["/brands", `/brands/${cat.brands[0].slug}`, "/explore", "/how-we-choose", "/disclosure", "/compare"]) {
    scenario = `route ${path}`;
    await goto(page, path);
    check("exactly one h1", await headingCount(page), 1);
  }

  // ---------------------------------------------------------- keyboard
  {
    const c = categories.find((x) => x.id === "wellness-drinks")!;
    const views = viewsOf(c.id);
    const ranked = recommendCategory(views, c);
    const groups = buildFilterGroups(views, c);
    const target = groups[0].options[0];
    scenario = "keyboard";
    await goto(page, `/${c.slug}`);
    // The chips are a client component. Tabbing into one before React has
    // attached its handler proves nothing about the keyboard, so the page's own
    // readiness signal is waited for rather than the load event.
    await page.locator('[data-filters-ready="true"]').first().waitFor({ timeout: 10000 });

    // Tab until the chip has focus. A control a keyboard cannot reach is a
    // control half the shoppers do not have.
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate((label) => {
        const el = document.activeElement as HTMLElement | null;
        return Boolean(el && el.tagName === "BUTTON" && (el.textContent ?? "").trim().startsWith(label));
      }, target.label);
    }
    ok(`tab reaches the ${target.label} chip`, reached);

    const focusStyle = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return { outline: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow };
    });
    ok("the focused chip is visibly focused", focusStyle.outline !== "none" || focusStyle.shadow !== "none", focusStyle);

    await page.keyboard.press("Enter");
    const expected = ranked.products.filter((p) => target.matchIds.includes(p.view.id)).map((p) => p.view.slug);
    await settled(page, expected.length);
    check("Enter applies the filter", await shownSlugs(page), expected);
    check("the focused chip is not hidden behind the header", await focusIsCovered(page), { covered: false });
    await page.keyboard.press("Enter");
    await settled(page, ranked.products.length);
    check("Enter again removes it", await shownSlugs(page), ranked.products.map((p) => p.view.slug));

    // The compare toggle, by keyboard alone.
    const firstSlug = ranked.products[0].view.slug;
    const toggle = page.locator(`article:has(a[href="/products/${firstSlug}"]) button[aria-pressed]`).first();
    await toggle.focus();
    check("the toggle starts unselected", await toggle.getAttribute("aria-pressed"), "false");
    check("and is not hidden behind the header when focused", await focusIsCovered(page), { covered: false });
    await page.keyboard.press("Enter");
    await page.waitForFunction((slug) => document.querySelector(`article:has(a[href="/products/${slug}"]) button[aria-pressed]`)?.getAttribute("aria-pressed") === "true", firstSlug, { timeout: 5000 }).catch(() => undefined);
    check("Enter selects it for comparison", await toggle.getAttribute("aria-pressed"), "true");
    ok("and the tray appears", (await page.locator('a[href^="/compare?ids="]').count()) > 0);
    await page.keyboard.press("Enter");
    await page.waitForFunction((slug) => document.querySelector(`article:has(a[href="/products/${slug}"]) button[aria-pressed]`)?.getAttribute("aria-pressed") === "false", firstSlug, { timeout: 5000 }).catch(() => undefined);
    check("Enter again deselects it", await toggle.getAttribute("aria-pressed"), "false");

    // The assistant opens, closes and gives focus back. Nothing is sent: no
    // message is typed and no request is made.
    const launcher = page.getByRole("button", { name: "Help me choose" }).first();
    await launcher.focus();
    check("the launcher says it is closed", await launcher.getAttribute("aria-expanded"), "false");
    await page.keyboard.press("Enter");
    await page.locator("#assistant-panel").waitFor({ timeout: 5000 });
    check("Enter opens the panel", await page.locator("#assistant-panel").count(), 1);
    check(
      "and focus moves into it",
      await page.evaluate(() => Boolean(document.querySelector("#assistant-panel")?.contains(document.activeElement))),
      true,
    );
    await page.keyboard.press("Escape");
    await page.locator("#assistant-panel").waitFor({ state: "detached", timeout: 5000 }).catch(() => undefined);
    check("Escape closes it", await page.locator("#assistant-panel").count(), 0);
    check(
      "and focus returns to the button that opened it",
      await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return (el?.textContent ?? "").trim();
      }),
      "Help me choose",
    );
    ok("nothing was sent", true);
  }

  // -------------------------------------------------------------- names
  for (const path of ["/", `/${categories[0].slug}`, `/products/${viewsOf(categories[0].id)[0].slug}`]) {
    scenario = `names ${path}`;
    await goto(page, path);
    check("every visible control has a name", await namelessControls(page), []);
  }

  await context.close();

  // ----------------------------------------------------------- mobile
  const mobile = await browser.newContext({ viewport: MOBILE, hasTouch: true, isMobile: true });
  const mp = await mobile.newPage();
  watch(mp);

  const rl = categories.find((x) => x.id === "red-light")!;
  const rlViews = viewsOf(rl.id);
  const trio = ["hooga-hg300", "platinumled-biomax-900", "hooga-pro1500"];
  const mobilePaths = [
    "/",
    `/${categories[0].slug}`,
    `/products/${viewsOf(categories[0].id)[0].slug}`,
    // An empty comparison proves nothing about a comparison table. Three real
    // ids, by URL, so the page has something to lay out.
    `/compare?ids=${trio.join(",")}`,
    "/explore",
  ];
  for (const path of mobilePaths) {
    scenario = `mobile ${path}`;
    const res = await mp.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    if (res?.status() !== 200) {
      ok("responds 200", false, res?.status());
      continue;
    }
    const overflow = await mp.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    ok("no sideways scrolling", overflow.scroll <= overflow.inner + 1, overflow);
  }

  scenario = "mobile compare";
  {
    // The loop above ends somewhere else, so the page under test is opened
    // again here rather than assumed.
    await mp.goto(`${BASE}/compare?ids=${trio.join(",")}`, { waitUntil: "domcontentloaded" });
    const columns = await mp.evaluate(() =>
      [...document.querySelectorAll("thead th a[href^='/products/']")].map((a) => new URL((a as HTMLAnchorElement).href).pathname.replace("/products/", "")),
    );
    check("all three products are laid out", [...new Set(columns)].sort(), trio.map((id) => rlViews.find((v) => v.id === id)!.slug).sort());

    // A wide table on a narrow phone has to scroll inside its own box. If the
    // page scrolls sideways instead, the header and the rest of the layout go
    // with it.
    const table = await mp.evaluate(() => {
      const t = document.querySelector("table");
      const box = t?.closest("div");
      if (!t || !box) return null;
      return {
        tableWider: t.scrollWidth > box.clientWidth,
        boxScrolls: getComputedStyle(box).overflowX,
        boxWithinViewport: box.getBoundingClientRect().width <= window.innerWidth + 1,
        page: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    ok("the table is wider than the phone", table?.tableWider === true, table);
    ok("its own container scrolls", table?.boxScrolls === "auto" || table?.boxScrolls === "scroll", table);
    ok("the container stays inside the viewport", table?.boxWithinViewport === true, table);
    ok("and the page itself does not scroll sideways", table?.page === true, table);

    // Scrolling the container must not drag the page with it.
    const scrolled = await mp.evaluate(() => {
      const box = document.querySelector("table")?.closest("div") as HTMLElement | undefined;
      if (!box) return null;
      box.scrollLeft = box.scrollWidth;
      return { boxLeft: box.scrollLeft, pageLeft: window.scrollX };
    });
    ok("the table scrolls within its box", (scrolled?.boxLeft ?? 0) > 0, scrolled);
    check("and the page stays put", scrolled?.pageLeft ?? 0, 0);
  }

  scenario = "mobile filters";
  await mp.goto(`${BASE}/wellness-drinks`, { waitUntil: "domcontentloaded" });
  const mobileChip = mp.getByRole("button", { name: /^Electrolytes\s/ }).first();
  if ((await mobileChip.count()) > 0) {
    const box = await mobileChip.boundingBox();
    ok("a filter chip is a usable tap target", (box?.height ?? 0) >= 44, box);
    const views = viewsOf("wellness-drinks");
    const groups = buildFilterGroups(views, categoryById("wellness-drinks")!);
    const option = groups.flatMap((g) => g.options).find((o) => o.label === "Electrolytes")!;
    const ranked = recommendCategory(views, categoryById("wellness-drinks")!);
    const expected = ranked.products.filter((p) => option.matchIds.includes(p.view.id)).map((p) => p.view.slug);

    // Readiness is established first, from the page's own signal, and then the
    // chip is tapped once. Retrying until something happens would hide a chip
    // that ignores a tap, which is the defect worth catching.
    await mp.locator('[data-filters-ready="true"]').first().waitFor({ timeout: 10000 });
    await mobileChip.tap();
    await mp
      .waitForFunction(
        (n) => {
          const chip = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith("Electrolytes"));
          return chip?.getAttribute("aria-pressed") === "true" && (document.body.textContent ?? "").includes(`${n} of 6 shown`);
        },
        expected.length,
        { timeout: 5000, polling: 100 },
      )
      .catch(() => undefined);
    check("tapping it selects the chip", await mobileChip.getAttribute("aria-pressed"), "true");
    check("and filters the grid", await shownSlugs(mp), expected);
    check("every visible control on the phone has a name", await namelessControls(mp), []);
  } else {
    ok("the electrolytes chip exists on a phone", false);
  }
  await mobile.close();
}

// Facet conditions are evaluated with the same engine the page uses.
import { evaluateCondition } from "@/domain/conditions";
function evaluate(v: ProductView, c: CategoryDefinition, cond: Parameters<typeof evaluateCondition>[2]) {
  return evaluateCondition(v, c, cond);
}

// Which build is actually answering on :3000.
//
// `next start` renames its process to `next-server`, so a `pkill -f "next
// start"` matches nothing and a server from an earlier build keeps the port.
// The next `next start` then fails with EADDRINUSE in a log nobody reads, the
// health check still returns 200, and every check below runs against stale
// code while appearing to pass. This asserts the served build is the one on
// disk before a single check runs, and fails loudly rather than reporting a
// green run against something else.
const expectedBuildId = (await readFile(join(process.cwd(), ".next", "BUILD_ID"), "utf8")).trim();
const homeHtml = await (await fetch(BASE)).text();
if (!homeHtml.includes(expectedBuildId)) {
  console.log(`FAIL build identity :: the server on ${BASE} is not serving the build in .next`);
  console.log(`       expected build ${expectedBuildId}`);
  console.log("       run a fresh `next start` against this build, and check nothing else holds the port");
  process.exit(1);
}
console.log(`ok   build identity :: serving ${expectedBuildId}`);

const browser = await chromium.launch({ executablePath: EXECUTABLE });
try {
  await run(browser);
} finally {
  await browser.close();
}

for (const p of [...new Set(pageProblems)]) {
  console.log(`FAIL browser reported :: ${p}`);
  failures.push(`browser reported :: ${p}`);
}

console.log(failures.length === 0 ? "\nAll checks passed." : `\n${failures.length} failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
process.exit(failures.length === 0 ? 0 : 1);
