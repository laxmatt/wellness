/**
 * Sweat Kingdom's Awin feed, F3219, as it arrived on 2026-09-13.
 *
 * The file in `intake/sweat-kingdom/` is the one the adapter reads, so these
 * are assertions about a real partner feed and not about a fixture written to
 * make them pass. What they hold is the two things this feed can most easily be
 * got wrong on: 225 rows are not 225 products, and a title is not a
 * specification.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCsv } from "@/domain/import/csv";
import { auditFeed, buildFromFeed, isSaunaFamily, readFeedPrice, type FeedRow } from "@/domain/intake/awin-sweat-kingdom";
import { planIntake } from "@/domain/intake/plan";
import { outboundRel } from "@/domain/outbound";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";

const FEED = join(process.cwd(), "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv");
const raw = readFileSync(FEED, "utf8");

function rows(): FeedRow[] {
  const table = readCsv(raw, Buffer.byteLength(raw, "utf8"));
  if (!table.ok) throw new Error(table.reason);
  return table.rows.map((r) => Object.fromEntries(table.headers.map((h, i) => [h, r[i] ?? ""])));
}

const FEED_ROWS = rows();
const AUDIT = auditFeed(FEED_ROWS);
const PATHS = [
  "/products/the-sweat-box-1-person",
  "/products/the-deluxe-sweat-cabin",
  "/products/the-ascent",
  "/products/the-large-barrel-sauna-6-person",
  "/products/the-summit",
];
const OPTIONS = { paths: PATHS, readOn: "2026-09-13", feedFile: "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv", merchantId: "sweat-kingdom-store", categoryId: "saunas" };

describe("the feed as it arrived", () => {
  it("carries 225 rows and no credential", () => {
    expect(FEED_ROWS).toHaveLength(225);
    expect(raw).not.toMatch(/api[_-]?key|secret|password|bearer|authorization/i);
  });

  it("states no variant grouping, so the merchant's product path is the grouping", () => {
    // `item_group_id` is empty on every row. Without the path there would be
    // nothing to group 225 rows by but guesswork.
    expect(AUDIT.empty).toContain("item_group_id");
    expect(AUDIT.families).toHaveLength(38);
    expect(AUDIT.families.reduce((n, f) => n + f.rows.length, 0)).toBe(225);
  });

  it("carries no specification at all", () => {
    // The reason the records this builds hold no attributes. Every field a
    // sauna would be compared on is empty in every row.
    for (const column of ["product_detail", "product_highlight", "certification", "product_weight", "product_height", "product_width", "product_length", "material", "size", "color"]) {
      expect(AUDIT.empty, column).toContain(column);
    }
  });

  it("carries no second image for anything", () => {
    expect(AUDIT.empty).toContain("additional_image_link");
    expect(FEED_ROWS.every((r) => (r.image_link ?? "").trim() !== "")).toBe(true);
    expect(new Set(FEED_ROWS.map((r) => r.image_link)).size).toBe(57);
  });
});

describe("reading a price from the feed", () => {
  it("reads the one shape this feed uses", () => {
    expect(readFeedPrice("5145.00 USD")).toEqual({ amountMinor: 514500, currency: "USD" });
    expect(readFeedPrice("24.95 USD")).toEqual({ amountMinor: 2495, currency: "USD" });
    expect(readFeedPrice("19.99 USD")).toEqual({ amountMinor: 1999, currency: "USD" });
  });

  it("refuses anything looser rather than guessing", () => {
    for (const bad of ["5145", "5,145.00 USD", "$5145.00", "5145.00", "5145.000 USD", "0.00 USD", "-5.00 USD", "", "abc USD"]) {
      expect(readFeedPrice(bad), bad).toBeUndefined();
    }
  });

  it("reads every price in the feed", () => {
    expect(FEED_ROWS.filter((r) => readFeedPrice(r.price ?? "") === undefined)).toEqual([]);
  });
});

describe("what counts as a sauna", () => {
  it("takes the feed's own classification and treats a blank as a no", () => {
    const saunas = AUDIT.families.filter(isSaunaFamily);
    expect(saunas).toHaveLength(17);
    const paths = saunas.map((f) => f.path);
    expect(paths).toContain("/products/the-sweat-box-1-person");
    // Accessories, heaters, spa systems and a service are all in this feed.
    for (const notASauna of ["/products/sauna-hat", "/products/kolo-thermometer", "/products/professional-installation", "/products/the-og-plunge-tub", "/products/steel-series-sauna-heater-package"]) {
      expect(paths, notASauna).not.toContain(notASauna);
    }
    // And two families the feed leaves unclassified are refused rather than
    // guessed at from their names.
    for (const blank of ["/products/sk-contrast", "/products/the-outpost"]) {
      expect(paths, blank).not.toContain(blank);
    }
  });

  it("refuses to build one the feed does not classify as a sauna", () => {
    const built = buildFromFeed(FEED_ROWS, { ...OPTIONS, paths: ["/products/sauna-hat", "/products/sk-contrast"] });
    expect(built.products).toEqual([]);
    expect(built.refusals.map((r) => r.path).sort()).toEqual(["/products/sauna-hat", "/products/sk-contrast"]);
    expect(built.refusals.every((r) => r.reasons.some((x) => x.includes("not as a sauna")))).toBe(true);
  });
});

describe("variants do not become duplicate products", () => {
  const built = buildFromFeed(FEED_ROWS, OPTIONS);

  it("builds one product per family, from 39 rows", () => {
    expect(built.products).toHaveLength(5);
    expect(built.refusals).toEqual([]);
    const chosen = AUDIT.families.filter((f) => PATHS.includes(f.path));
    expect(chosen.reduce((n, f) => n + f.rows.length, 0)).toBe(39);
    // Eighteen configurations of one barrel sauna are one product, not
    // eighteen near-identical rows in a comparison.
    expect(chosen.find((f) => f.path === "/products/the-large-barrel-sauna-6-person")!.rows).toHaveLength(18);
  });

  it("represents a family by its cheapest configuration and says so", () => {
    const barrel = built.products.find((p) => p.id === "sweat-kingdom-the-large-barrel-sauna-6-person")!;
    expect(barrel.offers[0].priceMinor).toBe(514500);
    const note = barrel.offers[0].source.note ?? "";
    expect(note).toContain("Chosen from 18 configurations");
    expect(note).toContain("$5,145 to $9,645");
    // Named as the feed names that configuration, so the name is not a family
    // label standing in for eighteen different prices.
    expect(barrel.name).toContain("Regular (2 Person)");
  });

  it("uses the tracking link the feed issued for that exact variant", () => {
    const barrel = built.products.find((p) => p.id === "sweat-kingdom-the-large-barrel-sauna-6-person")!;
    const cheapestRow = AUDIT.families.find((f) => f.path === "/products/the-large-barrel-sauna-6-person")!.chosen;
    expect(barrel.offers[0].url).toBe(cheapestRow.aw_deep_link);
    expect(barrel.offers[0].url).toContain("awinmid=125462");
    expect(barrel.offers[0].url).toContain("awinaffid=3090899");
    // Composed by Awin, not here. The variant in the link is the variant priced.
    expect(decodeURIComponent(barrel.offers[0].url)).toContain(`variant=${cheapestRow.id}`);
  });

  it("gives every product a distinct id and slug", () => {
    expect(new Set(built.products.map((p) => p.id)).size).toBe(built.products.length);
    expect(new Set(built.products.map((p) => p.slug)).size).toBe(built.products.length);
  });
});

describe("what the records claim", () => {
  const built = buildFromFeed(FEED_ROWS, OPTIONS);

  it("invents no specification, because the feed states none", () => {
    for (const p of built.products) expect(p.attributes, p.id).toEqual({});
  });

  it("records availability as the merchant states it, and no lead time it read out of prose", () => {
    const box = built.products.find((p) => p.id === "sweat-kingdom-the-sweat-box-1-person")!;
    expect(box.availability).toBe("out_of_stock");
    expect(box.offers[0].availability).toBe("out_of_stock");
    // The merchant's prose says five weeks and the field beside it says out of
    // stock. Both are kept: the description whole, the field as stated.
    expect(box.description).toContain("5 week lead time");
    expect(box.offers[0].shippingNote).toBeUndefined();
  });

  it("calls an issued tracking link an affiliate link, because it is one", () => {
    for (const p of built.products) {
      expect(p.offers[0].affiliate.status).toBe("affiliate");
      expect(p.offers[0].affiliate.network).toBe("awin");
      expect(p.offers[0].affiliate.programRef).toBe("awin-advertiser-125462-publisher-3090899");
      expect(outboundRel(p.offers[0].affiliate.status)).toContain("sponsored");
    }
  });

  it("takes the image from the feed and claims no right to it", () => {
    for (const p of built.products) {
      const image = p.images[0];
      expect(image.kind).toBe("affiliate_feed");
      expect(image.src).toMatch(/^https:\/\/cdn\.shopify\.com\//);
      expect(image.license).toBeUndefined();
      expect(image.source?.note ?? "").toContain("No licence has been established");
    }
  });

  it("keeps the merchant's own variant id without making it our id", () => {
    const box = built.products.find((p) => p.id === "sweat-kingdom-the-sweat-box-1-person")!;
    expect(box.identifiers.merchantSkus["sweat-kingdom-store"]).toBe("51172149821604");
    expect(box.id).not.toContain("51172149821604");
  });

  it("records the feed's brand field and reports where the title disagrees", () => {
    const built2 = buildFromFeed(FEED_ROWS, { ...OPTIONS, paths: ["/products/the-sweat-cabin-deluxe-6-person-copy"] });
    const p = built2.products[0];
    expect(p.brandId).toBe("sweat-kingdom");
    expect(p.source.note ?? "").toContain('title begins "REGEN"');
  });
});

describe("importing the same feed again", () => {
  it("changes nothing once the catalogue already says what the feed says", () => {
    const catalog = loadLocalCatalog(join(process.cwd(), "catalog"));
    const built = buildFromFeed(FEED_ROWS, OPTIONS);
    const plan = planIntake(catalog.products, built.products);
    expect(plan.creates).toEqual([]);
    expect(plan.differs).toEqual([]);
    expect(plan.unchanged).toHaveLength(5);
  });

  it("reports a reviewer's edit instead of overwriting it", () => {
    const catalog = loadLocalCatalog(join(process.cwd(), "catalog"));
    const built = buildFromFeed(FEED_ROWS, OPTIONS);
    const edited = catalog.products.map((p) => (p.id === "sweat-kingdom-the-ascent" ? { ...p, name: "The Ascent, checked by a person", status: "published" as const } : p));
    const plan = planIntake(edited, built.products);
    expect(plan.differs).toEqual(["sweat-kingdom-the-ascent"]);
    expect(plan.records.find((r) => r.id === "sweat-kingdom-the-ascent")!.reviewed).toBe(true);
  });
});

describe("nothing from this feed is public", () => {
  it("lands as drafts in a category with no page", async () => {
    const catalog = loadLocalCatalog(join(process.cwd(), "catalog"));
    const fromFeed = catalog.products.filter((p) => p.id.startsWith("sweat-kingdom-the-"));
    expect(fromFeed).toHaveLength(5);
    expect(fromFeed.every((p) => p.status === "draft")).toBe(true);
    expect(fromFeed.every((p) => p.categoryId === "saunas")).toBe(true);
    const { categoryBySlug } = await import("@/domain/categories");
    expect(categoryBySlug("saunas")).toBeUndefined();
  });
});
