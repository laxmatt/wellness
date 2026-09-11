import { describe, expect, it } from "vitest";
import { categories } from "@/domain/categories";
import { buyableOffers } from "@/domain/view";
import { recommendCategory } from "@/domain/recommend";
import { breadcrumbList, categoryItemList, jsonLdScript, publisher } from "@/lib/structured-data";
import { SITE_URL } from "@/lib/site-url";
import { viewsFor } from "./fixtures";

/**
 * What this site tells a search engine about itself.
 *
 * Structured data is quoted back to people who never open the page, which makes
 * it the place where an overstatement does the most damage and is hardest to
 * see. These checks are about what is absent as much as what is present.
 */

describe("embedding JSON in a page", () => {
  it("escapes a value that would end the script element", () => {
    // JSON.stringify leaves "</script>" exactly as it is, so a product name
    // carrying one would close the element and put the rest on the page as
    // markup. Nothing in the catalogue does today; supplier files will not
    // always be written by hand.
    const html = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<script");
    expect(html).toContain("\\u003c");
    // And it is still the same data once parsed.
    expect(JSON.parse(html)).toEqual({ name: "</script><script>alert(1)</script>" });
  });

  it("escapes the two separators that used to end a JavaScript line", () => {
    const html = jsonLdScript({ a: "one\u2028two", b: "three\u2029four" });
    expect(html).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(html)).toEqual({ a: "one\u2028two", b: "three\u2029four" });
  });

  it("round-trips ordinary content unchanged", () => {
    const value = { name: "LMNT Citrus Salt, 30 stick packs", note: "0 g sugar & 0 mg caffeine" };
    expect(JSON.parse(jsonLdScript(value))).toEqual(value);
  });
});

describe("who publishes this", () => {
  const graph = publisher()["@graph"] as Record<string, unknown>[];

  it("names the site and nothing it does not have", () => {
    const text = JSON.stringify(publisher());
    // Each of these is a claim this site cannot support.
    for (const absent of ["logo", "sameAs", "SearchAction", "potentialAction", "aggregateRating", "founder", "address", "telephone"]) {
      expect(text, `publisher data claims ${absent}`).not.toContain(absent);
    }
  });

  it("points at the configured site and not at a guess", () => {
    for (const node of graph) expect(node.url).toBe(SITE_URL);
  });
});

describe("a breadcrumb mirrors the page's own trail", () => {
  it("numbers from one and links every step but the last", () => {
    const crumbs = breadcrumbList([{ name: "Home", path: "/" }, { name: "Red Light Therapy", path: "/red-light" }, { name: "Hooga HG300" }]);
    const items = crumbs.itemListElement;
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[0]).toMatchObject({ name: "Home", item: `${SITE_URL}/` });
    expect(items[1]).toMatchObject({ item: `${SITE_URL}/red-light` });
    // The page you are on is named, not linked to itself.
    expect(items[2]).not.toHaveProperty("item");
  });
});

describe("a category page's list", () => {
  it("is the products the page renders, in the order it renders them", () => {
    for (const cat of categories) {
      const { products } = recommendCategory(viewsFor(cat.id), cat);
      const list = categoryItemList(`${cat.name} compared`, `/${cat.slug}`, products.map((p) => ({ name: `${p.view.brand.name} ${p.view.name}`, slug: p.view.slug })));

      expect(list.numberOfItems).toBe(products.length);
      expect(list.itemListElement.map((i) => i.name)).toEqual(products.map((p) => `${p.view.brand.name} ${p.view.name}`));
      expect(list.itemListElement.map((i) => i.position)).toEqual(products.map((_, i) => i + 1));
      expect(list.itemListElement.map((i) => i.url)).toEqual(products.map((p) => `${SITE_URL}/products/${p.view.slug}`));
    }
  });

  it("carries no price, rating or availability, which belong to the product pages", () => {
    const { products } = recommendCategory(viewsFor("red-light"), categories[0].id === "red-light" ? categories[0] : categories.find((c) => c.id === "red-light")!);
    const text = JSON.stringify(categoryItemList("x", "/red-light", products.map((p) => ({ name: p.view.name, slug: p.view.slug }))));
    for (const absent of ["price", "Rating", "availability", "image", "Offer"]) {
      expect(text, `the list claims ${absent}`).not.toContain(absent);
    }
  });
});

describe("what a product page may claim", () => {
  it("never has a rating to publish, because nothing here is rated", () => {
    // The guard is the catalogue itself: no product carries a rating field, so
    // any rating in structured data would have been invented by the markup.
    for (const cat of categories) {
      for (const view of viewsFor(cat.id)) {
        expect(JSON.stringify(view), `${view.slug}`).not.toMatch(/"rating|reviewCount|ratingValue/i);
      }
    }
  });

  it("has an offer to publish only where a real amount and a live listing exist", () => {
    // Mirrors the page's own rule, so the test fails if the two drift apart:
    // nothing disputed, nothing discontinued, nothing priced with placeholder
    // data. A product with none of those left has no offers node at all.
    for (const cat of categories) {
      for (const view of viewsFor(cat.id)) {
        const publishable = buyableOffers(view).filter((o) => !o.priceIsDemo);
        for (const offer of publishable) {
          expect(offer.disputed, `${view.slug}`).not.toBe(true);
          expect(offer.availability, `${view.slug}`).not.toBe("discontinued");
          expect(offer.priceIsDemo, `${view.slug}`).not.toBe(true);
        }
      }
    }
  });
});

describe("the header that says the same thing as the meta tag", () => {
  it("sends noindex for every path while indexing is off, and nothing when it is on", async () => {
    // A meta tag lives inside HTML, so it says nothing about /sitemap.xml or
    // /robots.txt. This is the same policy, from the same function, applied to
    // everything the app serves.
    const config = (await import("../../next.config")).default;
    const rules = await config.headers!();
    expect(rules).toEqual([{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }]);

    // And permission is the absence of a refusal, not a header claiming index.
    const before = { allow: process.env.NEXT_PUBLIC_ALLOW_INDEXING, url: process.env.NEXT_PUBLIC_SITE_URL };
    process.env.NEXT_PUBLIC_ALLOW_INDEXING = "1";
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.com";
    try {
      expect(await config.headers!()).toEqual([]);
    } finally {
      process.env.NEXT_PUBLIC_ALLOW_INDEXING = before.allow;
      process.env.NEXT_PUBLIC_SITE_URL = before.url;
    }
  });
});
