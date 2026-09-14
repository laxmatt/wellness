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
      expect(record.name, id).toBe(cheapest.title.trim());
      expect(record.description, id).toBe(cheapest.description.trim());
    }
  });
});

describe("what these records do not claim", () => {
  it("states no sauna specification, because the feed states none", () => {
    for (const product of fromFeed) {
      expect(Object.keys(product.attributes), product.id).toEqual([]);
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

  it("keeps the capacity extraction unapproved, so no capacity was written", () => {
    for (const product of fromFeed) {
      expect(product.attributes.capacity_max_people, product.id).toBeUndefined();
      expect(product.attributes.sauna_type, product.id).toBeUndefined();
      expect(product.attributes.connection, product.id).toBeUndefined();
      expect(product.attributes.placement, product.id).toBeUndefined();
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
      // The rows are there and they read "Not stated". A missing row would
      // leave a shopper to assume rather than to know it is unknown.
      expect(item.view.cardSpecs.map((s) => s.key), item.view.id).toEqual(["sauna_type", "capacity_label", "connection"]);
      for (const spec of item.view.cardSpecs) {
        expect(spec.formatted, `${item.view.id}.${spec.key}`).toBe("Not stated");
      }
      expect(Object.keys(item.view.attributes), item.view.id).toEqual([]);
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
