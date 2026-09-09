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

// The text of the block that shows a product's price on its card: the element
// holding the money, and its parent, which is where a qualifier would go.
async function priceBlockText(page: Page, slug: string, money: string): Promise<string> {
  return page.evaluate(
    ({ slug, money }) => {
      const card = document.querySelector(`article:has(a[href="/products/${slug}"])`);
      if (!card) return "";
      const el = [...card.querySelectorAll("span")].find((s) => (s.textContent ?? "").trim() === money);
      const block = el?.closest("div");
      return (block?.textContent ?? "").trim();
    },
    { slug, money },
  );
}

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

    // Badges are computed, not written on the card by hand.
    for (const b of ranked.set.badges) {
      const view = views.find((v) => v.id === b.productId)!;
      const card = page.locator(`article:has(a[href="/products/${view.slug}"])`).first();
      const text = (await card.textContent()) ?? "";
      ok(`${view.slug} card carries its ${BADGE_LABELS[b.badge]} badge`, text.includes(BADGE_LABELS[b.badge]), text.slice(0, 120));
    }

    // A price the catalogue calls a placeholder must say so where the price is
    // shown. Anywhere on the card is not the same thing: a demo spec three
    // rows below carries its own tag and says nothing about the price.
    for (const v of views.filter((v) => v.price.isDemo)) {
      const text = await priceBlockText(page, v.slug, formatMoney(v.price.money));
      ok(`${v.slug} card marks its placeholder price`, /demo|placeholder|unconfirmed|not confirmed/i.test(text), text);
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
    ok("shows the price the engine computed", body.includes(formatMoney(view.price.money)), formatMoney(view.price.money));
    if (view.price.isDemo) {
      ok("marks a placeholder price", /Demo data|placeholder|unconfirmed/i.test(body), body.slice(0, 120));
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
    for (const offer of view.offers) {
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

  // ------------------------------------------------------------ compare
  {
    const c = categories.find((x) => x.id === "red-light")!;
    const views = viewsOf(c.id);
    const ranked = recommendCategory(views, c);
    const pick = ["hooga-hg300", "platinumled-biomax-900"];
    scenario = "compare";
    await goto(page, `/${c.slug}`);
    for (const id of pick) {
      const view = views.find((v) => v.id === id)!;
      await page.locator(`article:has(a[href="/products/${view.slug}"]) button[aria-pressed]`).first().click();
    }
    const tray = page.locator('a[href^="/compare?ids="]').first();
    ok("the compare tray offers the comparison", (await tray.count()) > 0);
    await tray.click();
    await page.waitForURL(/\/compare/);

    const model = buildCompareModel(ranked.products.filter((p) => pick.includes(p.view.id)), c);
    const columns = await page.evaluate(() =>
      [...document.querySelectorAll("thead th a[href^='/products/']")].map((a) => new URL((a as HTMLAnchorElement).href).pathname.replace("/products/", "")),
    );
    check("the columns are the products chosen", [...new Set(columns)].sort(), model.columns.map((x) => x.slug).sort());

    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("tbody tr")]
        .filter((tr) => tr.querySelector("td"))
        .map((tr) => ({
          label: (tr.querySelector("th")?.textContent ?? "").trim(),
          cells: [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
          dots: tr.querySelectorAll('[aria-label="Strongest in this row"]').length,
        })),
    );
    const irradiance = rows.find((r) => r.label.startsWith("Irradiance"))!;
    ok("the bounded figure keeps its qualifier", irradiance.cells.some((t) => t.includes("more than 73 mW/cm²")), irradiance.cells);
    check("and that row marks no winner", irradiance.dots, 0);
    ok("and says why it is not ranked", /stated bound/.test(irradiance.label), irradiance.label);
    const rankedRow = rows.find((r) => r.label.startsWith("LEDs") || r.label.startsWith("LED"))!;
    check("an exact row still marks one winner", rankedRow.dots, 1);

    const sameRows = model.groups.flatMap((g) => g.rows).filter((r) => r.same).length;
    await page.getByRole("button", { name: /Differences only/ }).click();
    const after = await page.evaluate(() => [...document.querySelectorAll("tbody tr")].filter((tr) => tr.querySelector("td")).length);
    check("differences only hides exactly the identical rows", rows.length - after, sameRows);
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
    // attached its handler proves nothing about the keyboard.
    await page.waitForLoadState("load");
    await chipButton(page, target.label).waitFor({ state: "visible" });

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
    await page.keyboard.press("Enter");
    await settled(page, ranked.products.length);
    check("Enter again removes it", await shownSlugs(page), ranked.products.map((p) => p.view.slug));
  }

  await context.close();

  // ----------------------------------------------------------- mobile
  const mobile = await browser.newContext({ viewport: MOBILE, hasTouch: true, isMobile: true });
  const mp = await mobile.newPage();
  watch(mp);
  const mobilePaths = ["/", `/${categories[0].slug}`, `/products/${viewsOf(categories[0].id)[0].slug}`, "/compare", "/explore"];
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

  scenario = "mobile filters";
  await mp.goto(`${BASE}/wellness-drinks`, { waitUntil: "domcontentloaded" });
  const mobileChip = mp.getByRole("button", { name: /^Electrolytes\s/ }).first();
  if ((await mobileChip.count()) > 0) {
    const box = await mobileChip.boundingBox();
    ok("a filter chip is a usable tap target", (box?.height ?? 0) >= 44, box);
    await mobileChip.tap();
    const views = viewsOf("wellness-drinks");
    const groups = buildFilterGroups(views, categoryById("wellness-drinks")!);
    const option = groups.flatMap((g) => g.options).find((o) => o.label === "Electrolytes")!;
    const ranked = recommendCategory(views, categoryById("wellness-drinks")!);
    check(
      "tapping it filters the grid",
      await shownSlugs(mp),
      ranked.products.filter((p) => option.matchIds.includes(p.view.id)).map((p) => p.view.slug),
    );
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
