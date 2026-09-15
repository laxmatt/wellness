/**
 * Saunas, live.
 *
 * The category launched with one partner's feed behind it and three things
 * unresolved that the owner decided to publish despite: the pictures carry no
 * recorded permission, the feed states no sauna specification at all, and five
 * records were already in the catalogue. These are the assertions that keep
 * that honest rather than quiet: nothing was inferred to fill the gap, nothing
 * claims a right it does not have, nothing was lost in the merge, and a finish
 * is not a second sauna.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categories, categoryBySlug, isPublishedCategory, unpublishedCategories } from "@/domain/categories";
import { comparisonCount, familyIssues, groupIntoFamilies } from "@/domain/family";
import { readFeedPrice, type FeedRow } from "@/domain/intake/awin-sweat-kingdom";
import { readCsv } from "@/domain/import/csv";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";

const CATALOG = join(process.cwd(), "catalog");
const catalog = loadLocalCatalog(CATALOG);
const saunaProducts = catalog.products.filter((p) => p.categoryId === "saunas");
const fromFeed = saunaProducts.filter((p) => p.id.startsWith("sweat-kingdom-"));

const BLACKOUT = ["sweat-kingdom-the-sweat-cabin-blackout-edition", "sweat-kingdom-the-sweat-pod-blackout-edition"];
const OVERLAPS = [
  "sweat-kingdom-the-ascent",
  "sweat-kingdom-the-deluxe-sweat-cabin",
  "sweat-kingdom-the-large-barrel-sauna-6-person",
  "sweat-kingdom-the-summit",
  "sweat-kingdom-the-sweat-box-1-person",
];

function feedRows(): FeedRow[] {
  const raw = readFileSync(join(process.cwd(), "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv"), "utf8");
  const table = readCsv(raw, Buffer.byteLength(raw, "utf8"));
  if (!table.ok) throw new Error(table.reason);
  return table.rows.map((r) => Object.fromEntries(table.headers.map((h, i) => [h, r[i] ?? ""])));
}
const ROWS = feedRows();

describe("the category is live", () => {
  it("is published, resolves by slug, and is no longer held back", () => {
    expect(categories.map((c) => c.id)).toContain("saunas");
    expect(categoryBySlug("saunas")?.id).toBe("saunas");
    expect(isPublishedCategory("saunas")).toBe(true);
    expect(unpublishedCategories).toEqual([]);
  });

  it("changed no other category", () => {
    expect(categories.map((c) => c.id)).toEqual(["red-light", "cold-plunge", "wellness-drinks", "saunas"]);
  });

  it("carries the 17 source records the feed produced, all published", () => {
    expect(fromFeed).toHaveLength(17);
    expect(fromFeed.every((p) => p.status === "published")).toBe(true);
  });

  it("publishes only what this promotion covered, and leaves the rest as drafts", () => {
    // SaunaCloud and Dynamic Barcelona are sauna records from other sources,
    // read by hand from listings rather than promoted through a signed plan.
    // Launching the category does not launch them: they were not in the plan,
    // nobody reviewed them for this, and a category going live is not a reason
    // to sweep up whatever else happens to sit in it.
    const others = saunaProducts.filter((p) => !p.id.startsWith("sweat-kingdom-"));
    expect(others.map((p) => p.id).sort()).toEqual(["dynamic-barcelona-dyn-6106-01", "saunacloud-atlas-one"]);
    expect(others.every((p) => p.status === "draft")).toBe(true);
  });

  it("shows 15 models to a shopper", () => {
    const published = saunaProducts.filter((p) => p.status === "published");
    expect(comparisonCount(published)).toBe(15);
  });
});

describe("a finish is not a second sauna", () => {
  it("keeps both blackout records and makes each a configuration of its model", () => {
    for (const id of BLACKOUT) {
      const record = fromFeed.find((p) => p.id === id);
      expect(record, id).toBeDefined();
      expect(record!.family?.of, id).toBe(id.replace("-blackout-edition", ""));
      expect(record!.family?.because, id).toContain("blackout finish");
    }
  });

  it("presents 15 Sweat Kingdom models out of 17 records", () => {
    expect(comparisonCount(fromFeed)).toBe(15);
    const heads = groupIntoFamilies(fromFeed).map((f) => f.representative.id);
    for (const id of BLACKOUT) expect(heads).not.toContain(id);
  });

  it("holds a valid family graph across the whole catalogue", () => {
    expect(familyIssues(catalog.products)).toEqual([]);
    // Nothing outside this partner's records was grouped.
    expect(catalog.products.filter((p) => p.family !== undefined).map((p) => p.id).sort()).toEqual([...BLACKOUT].sort());
  });

  it("keeps each configuration's own price, link and picture rather than its model's", () => {
    for (const id of BLACKOUT) {
      const member = fromFeed.find((p) => p.id === id)!;
      const model = fromFeed.find((p) => p.id === member.family!.of)!;
      expect(member.offers[0].priceMinor).toBeGreaterThan(model.offers[0].priceMinor!);
      expect(member.offers[0].url).not.toBe(model.offers[0].url);
      expect(member.images[0].src).not.toBe(model.images[0].src);
    }
  });
});

describe("the five the catalogue already held", () => {
  it("is exactly those five, and every one is still there", () => {
    for (const id of OVERLAPS) expect(fromFeed.map((p) => p.id)).toContain(id);
  });

  it("carries the feed's current price, availability, issued link and picture", () => {
    for (const id of OVERLAPS) {
      const record = fromFeed.find((p) => p.id === id)!;
      const path = `/products/${id.replace("sweat-kingdom-", "")}`;
      const rows = ROWS.filter((r) => {
        try {
          return new URL(r.link).pathname === path;
        } catch {
          return false;
        }
      });
      expect(rows.length, id).toBeGreaterThan(0);
      const priced = rows.map((r) => ({ r, p: readFeedPrice(r.price) })).filter((x) => x.p !== undefined);
      const cheapest = priced.reduce((a, b) => (b.p!.amountMinor < a.p!.amountMinor ? b : a));
      expect(record.offers[0].priceMinor, id).toBe(cheapest.p!.amountMinor);
      expect(record.offers[0].availability, id).toBe(cheapest.r.availability);
      expect(record.offers[0].url, id).toBe(cheapest.r.aw_deep_link);
      expect(record.images[0].src, id).toBe(cheapest.r.image_link);
      expect(record.offers[0].affiliate.status, id).toBe("affiliate");
    }
  });

  it("kept the name and description the catalogue already held", () => {
    // They agreed to the byte before the merge, which is why the merge could be
    // exact. This holds that: a later feed that renames one has to go through a
    // review rather than through a silent overwrite.
    for (const id of OVERLAPS) {
      const record = fromFeed.find((p) => p.id === id)!;
      const rows = ROWS.filter((r) => {
        try {
          return new URL(r.link).pathname === `/products/${id.replace("sweat-kingdom-", "")}`;
        } catch {
          return false;
        }
      });
      const priced = rows.map((r) => ({ r, p: readFeedPrice(r.price) })).filter((x) => x.p !== undefined);
      const cheapest = priced.reduce((a, b) => (b.p!.amountMinor < a.p!.amountMinor ? b : a)).r;
      // The name is the model out of that title, and the whole of the title is
      // kept beside it. Nothing about the configuration was lost.
      expect(record.sourceTitle, id).toBe(cheapest.title.trim());
      expect(cheapest.title.trim().startsWith(record.name), id).toBe(true);
      expect(record.description, id).toBe(cheapest.description.trim());
    }
  });
});

describe("what these records do not claim", () => {
  it("states only what the retailer's own model names carry, and says how it read them", () => {
    // The feed has no specification field of any kind. Two things are readable
    // from the model name itself, as tokens, by rules somebody approved, and
    // every one of them carries the rule and the text it read.
    for (const product of fromFeed) {
      expect(Object.keys(product.attributes).sort(), product.id).toEqual(["capacity_max_people", "sauna_style"].filter((k) => product.attributes[k] !== undefined));
      for (const value of Object.values(product.attributes)) {
        expect(value.derivation, product.id).toBeDefined();
        expect(value.derivation!.field, product.id).toBe("title");
      }
    }
  });

  it("claims no right to any picture, and says the right is unresolved", () => {
    for (const product of fromFeed) {
      const image = product.images[0];
      expect(image, product.id).toBeDefined();
      expect(image.kind, product.id).toBe("affiliate_feed");
      expect(image.license, product.id).toBeUndefined();
      expect(image.source?.note ?? "", product.id).toContain("the right to publish it is unresolved");
      expect(image.source?.note ?? "", product.id).toContain("not a record that permission exists");
    }
  });

  it("names the affiliate programme on every issued link", () => {
    for (const product of fromFeed) {
      expect(product.offers[0].url, product.id).toMatch(/^https:\/\/www\.awin1\.com\//);
      expect(product.offers[0].affiliate, product.id).toMatchObject({ status: "affiliate", network: "awin", programRef: "awin-advertiser-125462-publisher-3090899" });
    }
  });

  it("reads nothing this feed does not say in a token: no heating, connection or placement", () => {
    // "infrared" and "traditional" appear in no title; "traditional" appears in
    // prose in 24 descriptions and prose is not read. Neither "indoor" nor
    // "outdoor" appears anywhere at all.
    for (const product of fromFeed) {
      expect(product.attributes.sauna_type, product.id).toBeUndefined();
      expect(product.attributes.connection, product.id).toBeUndefined();
      expect(product.attributes.placement, product.id).toBeUndefined();
      expect(product.attributes.width_in, product.id).toBeUndefined();
    }
    for (const word of [/infrared/i, /\bindoor\b/i, /\boutdoor\b/i]) {
      expect(ROWS.every((r) => !word.test(r.title)), String(word)).toBe(true);
    }
  });
});

describe("what a shopper is offered", () => {
  it("lists 15 models on the category page and neither blackout among them", async () => {
    const { getCategoryPage } = await import("@/lib/queries");
    const page = await getCategoryPage("saunas");
    expect(page).not.toBeNull();
    expect(page!.products).toHaveLength(15);
    for (const id of BLACKOUT) {
      expect(page!.products.map((p) => p.view.id)).not.toContain(id);
      expect((page!.members ?? []).map((p) => p.view.id)).toContain(id);
    }
  });

  it("sends a configuration's own address to the model it belongs to", async () => {
    const { getProductRedirect } = await import("@/lib/queries");
    expect(await getProductRedirect("sweat-kingdom-the-sweat-cabin-blackout-edition")).toBe("/products/sweat-kingdom-the-sweat-cabin");
    expect(await getProductRedirect("sweat-kingdom-the-sweat-pod-blackout-edition")).toBe("/products/sweat-kingdom-the-sweat-pod");
    expect(await getProductRedirect("sweat-kingdom-the-sweat-cabin")).toBeNull();
  });

  it("lists the configurations on the model's own page, each with its price and link", async () => {
    const { getProductPage } = await import("@/lib/queries");
    const page = await getProductPage("sweat-kingdom-the-sweat-cabin");
    expect(page).not.toBeNull();
    expect(page!.configurations.map((c) => c.view.id)).toEqual(["sweat-kingdom-the-sweat-cabin-blackout-edition"]);
    const configuration = page!.configurations[0].view;
    expect(configuration.price.money?.amountMinor).toBe(924500);
    expect(configuration.offers[0].url).toMatch(/^https:\/\/www\.awin1\.com\//);
  });

  it("shows every comparison spec as not stated, and states no figure it does not have", async () => {
    const { getCategoryPage } = await import("@/lib/queries");
    const page = await getCategoryPage("saunas");
    for (const item of page!.products) {
      // The heating row is there and reads "Not stated". A missing row would
      // leave a shopper to assume rather than to know it is unknown.
      expect(item.view.cardSpecs.map((s) => s.key), item.view.id).toEqual(["sauna_style", "capacity_max_people", "sauna_type"]);
      const byKey = Object.fromEntries(item.view.cardSpecs.map((s) => [s.key, s.formatted]));
      expect(byKey.sauna_type, item.view.id).toBe("Not stated");
      expect(Object.keys(item.view.attributes).sort(), item.view.id).not.toContain("sauna_type");
    }
  });

  it("prices every model, because price is the one thing this feed states", async () => {
    const { getCategoryPage, fromPrice } = await import("@/lib/queries");
    const page = await getCategoryPage("saunas");
    for (const item of page!.products) {
      expect(item.view.price.money?.amountMinor, item.view.id).toBeGreaterThan(0);
      // The model's own price is the lowest anyone pays for it, so a card
      // showing it is not quoting a figure a shopper cannot get.
      expect(fromPrice(page!, item), item.view.id).toBe(item.view.price.money!.amountMinor);
    }
  });

  it("keeps configurations out of the sitemap", async () => {
    const { getAllCategoryPages } = await import("@/lib/queries");
    const slugs = (await getAllCategoryPages()).flatMap((p) => p.products.map((x) => x.view.slug));
    for (const id of BLACKOUT) expect(slugs).not.toContain(id);
    expect(slugs).toContain("sweat-kingdom-the-sweat-cabin");
  });
});

describe("a shopper can find it", () => {
  it("is in the one list the header, the footer and the phone menu all read", async () => {
    const { NAV } = await import("@/lib/nav");
    expect(NAV.map((n) => n.href)).toContain("/saunas");
    expect(NAV.find((n) => n.href === "/saunas")?.label).toBe("Saunas");
  });

  it("holds every published category, so a launch cannot forget the bar at the top", async () => {
    const { NAV } = await import("@/lib/nav");
    for (const cat of categories) {
      expect(NAV.map((n) => n.href), cat.id).toContain(`/${cat.slug}`);
      expect(NAV.find((n) => n.href === `/${cat.slug}`)?.label, cat.id).toBe(cat.navLabel);
    }
    expect(NAV.filter((n) => categories.some((c) => `/${c.slug}` === n.href))).toHaveLength(categories.length);
  });

  it("is on every surface that lists the other live categories", async () => {
    const { getAllCategoryPages } = await import("@/lib/queries");
    // The home grid, /explore and the sitemap are all built from this one read.
    expect((await getAllCategoryPages()).map((p) => p.cat.slug)).toContain("saunas");
  });
});

describe("names a shopper can read", () => {
  const models = fromFeed.filter((p) => p.family === undefined);

  it("shortens every card name and keeps the retailer's own title", () => {
    expect(models).toHaveLength(15);
    for (const product of models) {
      expect(product.sourceTitle, product.id).toBeDefined();
      expect(product.sourceTitle!.length, product.id).toBeGreaterThan(product.name.length);
      expect(product.sourceTitle!.startsWith(product.name), product.id).toBe(true);
      expect(product.name.length, `${product.id} is still a warehouse label`).toBeLessThanOrEqual(45);
      // No configuration detail survives into the name.
      expect(product.name, product.id).not.toMatch(/ \/ |kw|Included|Footprint/i);
    }
  });

  it("collapses no two models into one name", () => {
    const names = models.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps each blackout configuration distinct from the model it belongs to", () => {
    for (const id of BLACKOUT) {
      const member = fromFeed.find((p) => p.id === id)!;
      const model = fromFeed.find((p) => p.id === member.family!.of)!;
      expect(member.name).toContain("Blackout Edition");
      expect(member.name).not.toBe(model.name);
      expect(member.sourceTitle).toContain("Blackout Edition");
    }
  });

  it("records the rule that shortened it", () => {
    for (const product of models) {
      expect(product.source.note ?? "", product.id).toBeTruthy();
    }
  });
});

describe("what the titles do and do not state", () => {
  const models = fromFeed.filter((p) => p.family === undefined);
  const withValue = (key: string) => models.filter((p) => p.attributes[key]?.value !== undefined);

  it("reads a capacity for every one of the fifteen", () => {
    expect(withValue("capacity_max_people")).toHaveLength(15);
  });

  it("reads a style for nine of them and leaves six not stated", () => {
    const styled = withValue("sauna_style");
    expect(styled).toHaveLength(9);
    const counts: Record<string, number> = {};
    for (const p of styled) counts[String(p.attributes.sauna_style.value)] = (counts[String(p.attributes.sauna_style.value)] ?? 0) + 1;
    expect(counts).toEqual({ cabin: 4, barrel: 1, pod: 2, box: 1, mobile: 1 });
  });

  it("reads no heating type, connection or placement, because this feed states none", () => {
    for (const key of ["sauna_type", "connection", "placement", "voltage", "heater_kw"]) {
      expect(withValue(key), key).toHaveLength(0);
    }
  });

  it("keeps the rule, the version, the whole title and the match on every derived value", () => {
    for (const product of models) {
      for (const key of ["capacity_max_people", "sauna_style"]) {
        const value = product.attributes[key];
        if (!value?.value) continue;
        const d = value.derivation!;
        expect(d, `${product.id}.${key}`).toBeDefined();
        expect(d.field).toBe("title");
        expect(d.sourceText).toBe(product.sourceTitle);
        expect(d.sourceText).toContain(d.matched);
        expect(d.reviewState).toBe("approved");
        expect(d.approvedBy).toBeTruthy();
        expect(d.version).toBeGreaterThan(0);
        expect(d.rule.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("narrowing by more than price", () => {
  const loadPage = async () => {
    const { getCategoryPage } = await import("@/lib/queries");
    return (await getCategoryPage("saunas"))!;
  };

  it("offers three rows of chips, not one", async () => {
    const { buildFilterGroups } = await import("@/domain/filters");
    const page = await loadPage();
    const groups = buildFilterGroups(page.products.map((p) => p.view), page.cat);
    expect(groups.map((g) => g.key)).toEqual(["price", "sauna_style", "capacity_max_people"]);
    expect(groups.flatMap((g) => g.options).length).toBeGreaterThanOrEqual(10);
  });

  it("splits the fifteen across four price bands that cover all of them", async () => {
    const { buildFilterGroups } = await import("@/domain/filters");
    const page = await loadPage();
    const price = buildFilterGroups(page.products.map((p) => p.view), page.cat).find((g) => g.key === "price")!;
    expect(price.options.map((o) => o.label)).toEqual(["Under $7,000", "$7,000 to $10,000", "$10,000 to $15,000", "$15,000 and up"]);
    expect(price.options.map((o) => o.matchIds.length)).toEqual([4, 4, 3, 4]);
    // Bands, not overlapping "Under" chips: every model is in exactly one.
    const seen = price.options.flatMap((o) => o.matchIds);
    expect(new Set(seen).size).toBe(15);
    expect(seen).toHaveLength(15);
  });

  it("offers a style row of five and a capacity row of three, in order", async () => {
    const { buildFilterGroups } = await import("@/domain/filters");
    const page = await loadPage();
    const groups = buildFilterGroups(page.products.map((p) => p.view), page.cat);
    const style = groups.find((g) => g.key === "sauna_style")!;
    expect(style.options.map((o) => [o.label, o.matchIds.length])).toEqual([
      ["Cabin", 4],
      ["Barrel", 1],
      ["Pod", 2],
      ["Box", 1],
      ["Mobile (towable)", 1],
    ]);
    const seats = groups.find((g) => g.key === "capacity_max_people")!;
    expect(seats.options.map((o) => [o.label, o.matchIds.length])).toEqual([
      ["1 to 2 people", 2],
      ["3 to 4 people", 6],
      ["5 or more", 7],
    ]);
  });

  it("renders no row for a dimension nothing states", async () => {
    const { buildFilterGroups } = await import("@/domain/filters");
    const page = await loadPage();
    const keys = buildFilterGroups(page.products.map((p) => p.view), page.cat).map((g) => g.key);
    for (const key of ["sauna_type", "connection", "placement"]) expect(keys, key).not.toContain(key);
  });

  it("answers a combination nothing matches with nothing, rather than with everything", async () => {
    const { applyFilters, buildFilterGroups } = await import("@/domain/filters");
    const page = await loadPage();
    const views = page.products.map((p) => p.view);
    const groups = buildFilterGroups(views, page.cat);
    const ids = views.map((v) => v.id);
    // A one-person box costing over $15,000 is not something this retailer sells.
    expect(applyFilters(ids, groups, ["sauna_style:box", "price:$15,000 and up"])).toEqual([]);
    // And a combination that does match returns exactly those.
    const cabins = applyFilters(ids, groups, ["sauna_style:cabin", "capacity_max_people:5 or more"]);
    expect(cabins.length).toBeGreaterThan(0);
    expect(cabins.every((id) => views.find((v) => v.id === id)!.attributes.sauna_style === "cabin")).toBe(true);
  });

  it("still shows a missing dimension on the card rather than hiding the row", async () => {
    const page = await loadPage();
    for (const item of page.products) {
      const byKey = Object.fromEntries(item.view.cardSpecs.map((s) => [s.key, s.formatted]));
      expect(Object.keys(byKey), item.view.id).toEqual(["sauna_style", "capacity_max_people", "sauna_type"]);
      expect(byKey.sauna_type, item.view.id).toBe("Not stated");
      expect(byKey.capacity_max_people, item.view.id).toMatch(/\d+ people/);
    }
  });
});
