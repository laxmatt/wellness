/**
 * What an outbound link to a merchant claims, against what the record says.
 *
 * The site has no affiliate programme. `/disclosure` says so in as many words,
 * every offer in the catalogue records an unknown affiliate status, and not one
 * names a programme reference. Every one of those links carried
 * `rel="sponsored"`, which is Google's declaration that a link was paid for.
 * These are the tests that keep the markup and the page telling the same story.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryById } from "@/domain/categories";
import { outboundLinkProps, outboundRel } from "@/domain/outbound";
import type { Product } from "@/domain/product";
import { buyableOffers, toProductView } from "@/domain/view";
import { loadLocalCatalog, validateCatalog, type LoadedCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { lowestOfferUrl } from "@/lib/queries";

const CATALOG_DIR = join(process.cwd(), "catalog");
const catalog: LoadedCatalog = loadLocalCatalog(CATALOG_DIR);

const viewFor = (p: Product) => toProductView(p, { category: categoryById(p.categoryId)!, brands: catalog.brands, merchants: catalog.merchants });
const views = catalog.products.map(viewFor);

describe("a link says it is sponsored only when it pays", () => {
  it("marks a recorded affiliate link as sponsored", () => {
    expect(outboundRel("affiliate")).toBe("sponsored nofollow noopener");
  });

  it("does not claim payment for an ordinary link, or for one nobody has recorded", () => {
    // "unknown" is what the catalogue says when the relationship was never
    // recorded. It is not "probably paid", and reading it that way is the same
    // mistake as reading an empty cell as a zero.
    expect(outboundRel("non_affiliate")).toBe("nofollow noopener");
    expect(outboundRel("unknown")).toBe("nofollow noopener");
  });

  it("withholds ranking credit and opens safely whatever the relationship is", () => {
    for (const status of ["affiliate", "non_affiliate", "unknown"] as const) {
      const props = outboundLinkProps(status);
      expect(props.rel).toContain("nofollow");
      expect(props.rel).toContain("noopener");
      expect(props.target).toBe("_blank");
      // The attribute that identifies a shopping link, so a check can find one
      // without reading meaning into its rel.
      expect(props["data-shop-link"]).toBe("");
    }
  });
});

describe("the catalogue as it stands", () => {
  const offers = catalog.products.flatMap((p) => p.offers);

  it("holds no affiliate link at all, so no link on the site may claim one", () => {
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.filter((o) => o.affiliate.status === "affiliate")).toEqual([]);
    for (const view of views) {
      for (const offer of buyableOffers(view)) expect(outboundRel(offer.affiliateStatus)).not.toContain("sponsored");
    }
  });

  it("names no programme reference and no Amazon tracking id", () => {
    for (const offer of offers) {
      expect(offer.affiliate.programRef).toBeUndefined();
      // A network name is not an approved account, and `network: "amazon"` on
      // three offers is exactly that: the name of where the listing is, not a
      // programme this site has been accepted into.
      const url = new URL(offer.url);
      expect(url.searchParams.get("tag")).toBeNull();
      expect(url.searchParams.get("ascsubtag")).toBeNull();
    }
  });

  it("says the same thing on the disclosure page", () => {
    const page = readFileSync(join(process.cwd(), "src/app/disclosure/page.tsx"), "utf8");
    expect(page).toContain("There is no affiliate programme behind this site today");
    expect(page).toContain("No tracking");
  });
});

describe("what the catalogue refuses to record", () => {
  const first = () => JSON.parse(JSON.stringify(catalog.products.find((p) => p.offers.length > 0)!)) as Product;

  const issuesFor = (product: Product) => validateCatalog({ ...catalog, products: [...catalog.products.filter((p) => p.id !== product.id), product] });

  it("refuses an affiliate link that names no programme", () => {
    const product = first();
    product.offers[0].affiliate = { status: "affiliate" };
    const messages = issuesFor(product).map((i) => i.message);
    expect(messages.some((m) => m.includes("names no network"))).toBe(true);
    expect(messages.some((m) => m.includes("no programRef"))).toBe(true);
  });

  it("accepts one that does", () => {
    const product = first();
    product.offers[0].affiliate = { status: "affiliate", network: "amazon", programRef: "some-programme-reference" };
    expect(issuesFor(product).filter((i) => i.message.includes("affiliate"))).toEqual([]);
  });

  it("refuses a programme reference on a link that says it is not paid", () => {
    const product = first();
    product.offers[0].affiliate = { status: "unknown", programRef: "some-programme-reference" };
    expect(issuesFor(product).some((i) => i.message.includes("carries a programRef"))).toBe(true);
  });

  it("is satisfied by the catalogue that ships", () => {
    expect(validateCatalog(catalog)).toEqual([]);
  });
});

describe("the cheapest link a shopper can be sent to", () => {
  it("is never one the buying surfaces withhold", () => {
    // Plunge's only offer is disputed and Edge Theory Labs' only offer is
    // discontinued. Reading offers[0] returned a shopping link for both.
    for (const view of views) {
      const url = lowestOfferUrl(view);
      const buyable = buyableOffers(view);
      if (buyable.length === 0) {
        expect(url, `${view.id} has nothing to link`).toBeUndefined();
        continue;
      }
      expect(url).toBe(buyable[0].url);
      expect(view.offers.filter((o) => o.url === url).every((o) => !o.disputed && o.availability !== "discontinued")).toBe(true);
    }
  });

  it("finds the withheld records this is about", () => {
    const withheld = views.filter((v) => v.offers.length > 0 && buyableOffers(v).length === 0);
    expect(withheld.map((v) => v.id).sort()).toEqual(["edge-tub-elite", "plunge-original"]);
    for (const view of withheld) expect(lowestOfferUrl(view)).toBeUndefined();
  });
});
