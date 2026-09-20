/**
 * What an outbound link to a merchant claims, against what the record says.
 *
 * `rel="sponsored"` is Google's declaration that a link was paid for, and every
 * outbound link on this site carried it while no offer recorded an affiliate
 * relationship at all. The rule these tests hold is not "this site has no
 * affiliate links", which is a fact about today and the thing the whole launch
 * is meant to change. It is that the markup says what the record says, and goes
 * on saying it when the record changes.
 *
 * Written against fixtures wherever a rule can be stated without the catalogue,
 * so nothing here has to be rewritten on the day something starts paying. The
 * shipped catalogue is checked against the same rule rather than for a
 * particular answer; its state on a given date belongs in
 * docs/launch-monetization-readiness.md, where a snapshot is labelled as one.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { categoryById } from "@/domain/categories";
import { outboundLinkProps, outboundRel } from "@/domain/outbound";
import type { AffiliateStatus, MerchantOffer, Product } from "@/domain/product";
import { buyableOffers, toProductView } from "@/domain/view";
import { loadLocalCatalog, validateCatalog, type LoadedCatalog } from "@/providers/catalog/LocalCatalogProvider";
import { lowestOfferUrl } from "@/lib/queries";
import { miniProduct, miniView, offer } from "./fixtures";

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

/** A record carrying exactly the offers a test is about. */
function withOffers(id: string, offers: MerchantOffer[]): Product {
  return { ...miniProduct(id, offers[0]?.priceMinor ?? 1000, { power: 50 }), offers };
}

/** One offer, with whatever relationship the test is about. */
function offerWith(affiliate: Partial<MerchantOffer["affiliate"]> & { status: AffiliateStatus }): MerchantOffer {
  return { ...offer("fixture-offer", 1000), affiliate: { ...affiliate } };
}

describe("the markup agrees with the record, whatever the record says", () => {
  it("claims payment for an affiliate link and for nothing else", () => {
    // Written as a rule rather than a census. An earlier version asserted that
    // the shipped catalogue holds no affiliate link at all, which was true the
    // day it was written and would have started failing on the first day this
    // site was actually paid for something. What has to hold forever is that
    // the markup follows the record.
    for (const status of ["affiliate", "non_affiliate", "unknown"] as const) {
      expect(outboundRel(status).includes("sponsored")).toBe(status === "affiliate");
    }
  });

  it("holds for every offer the catalogue currently ships", () => {
    const offers = catalog.products.flatMap((p) => p.offers);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(outboundRel(o.affiliate.status).includes("sponsored"), o.id).toBe(o.affiliate.status === "affiliate");
    }
  });

  it("is not moved by a programme reference, only by the status", () => {
    // The reference is retained identity. It says which programme an offer
    // would belong to, not that this one pays today.
    const retained = outboundRel(offerWith({ status: "unknown", network: "amazon", programRef: "some-store-id" }).affiliate.status);
    expect(retained).toBe("nofollow noopener");
    expect(retained).not.toContain("sponsored");
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

  it("permits a programme reference on a link that is not yet paid", () => {
    // Refusing this was wrong. An account can be open while this site is not
    // registered to it, which is the state this project is in, and recording
    // the reference against the offer it will apply to is how somebody keeps
    // that straight. Nothing on screen reads it.
    for (const status of ["unknown", "non_affiliate"] as const) {
      const product = first();
      product.offers[0].affiliate = { status, network: "amazon", programRef: "some-store-id" };
      expect(issuesFor(product).filter((i) => i.message.includes(product.offers[0].id)), status).toEqual([]);
    }
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

  it("has nothing to offer when every listing on a record is withheld", () => {
    // Proved on a record built here, so the rule survives any change to the
    // catalogue. Two shipped records sit on it today, named in the audit
    // document: Plunge's only offer is disputed and Edge Theory Labs' only
    // offer is discontinued.
    const withheldOnly = miniView(withOffers("withheld-only", [{ ...offer("w-1", 1000), disputed: true }, { ...offer("w-2", 2000), availability: "discontinued" }]));
    expect(withheldOnly.offers).toHaveLength(2);
    expect(buyableOffers(withheldOnly)).toEqual([]);
    expect(lowestOfferUrl(withheldOnly)).toBeUndefined();

    // And the cheapest of what remains, not the cheapest on the record.
    const oneGood = miniView(withOffers("one-good", [{ ...offer("g-1", 1000), disputed: true }, offer("g-2", 2000)]));
    expect(lowestOfferUrl(oneGood)).toBe("https://example.com/g-2");
  });
});
