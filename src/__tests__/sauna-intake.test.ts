/**
 * The approved sauna intake, through the catalogue the site actually reads.
 *
 * Three real products, read on 2026-09-13, imported as drafts. What is proved
 * here is not that the import ran: it is that nothing it wrote can reach a
 * shopper, that running it again cannot undo a reviewer's work, and that the
 * four things the pages could not settle are recorded as unsettled rather than
 * rounded off.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { allCategories, categories, categoryById, categoryBySlug, saunas } from "@/domain/categories";
import { matchesAll } from "@/domain/conditions";
import { IntakeFile, toCatalogRecords } from "@/domain/intake/record";
import { planIntake } from "@/domain/intake/plan";
import { outboundRel, RELATIONSHIP_COPY } from "@/domain/outbound";
import { attributionTag } from "@/domain/provenance";
import { recommendCategory } from "@/domain/recommend";
import { buyableOffers, displayOfferPrice, displayPrice, PRICE_ON_REQUEST, toProductView } from "@/domain/view";
import { loadLocalCatalog, LocalCatalogProvider } from "@/providers/catalog/LocalCatalogProvider";

const CATALOG_DIR = join(process.cwd(), "catalog");
const catalog = loadLocalCatalog(CATALOG_DIR);
const provider = new LocalCatalogProvider(catalog);

const SAUNA_IDS = ["saunacloud-atlas-one", "dynamic-barcelona-dyn-6106-01", "sweat-kingdom-sweat-box-1p"];
const saunaProducts = catalog.products.filter((p) => p.categoryId === "saunas");
const productById = (id: string) => catalog.products.find((p) => p.id === id)!;
const viewOf = (id: string) => toProductView(productById(id), { category: categoryById("saunas")!, brands: catalog.brands, merchants: catalog.merchants });

const intake = IntakeFile.parse(JSON.parse(readFileSync(join(process.cwd(), "intake/saunas/2026-09-13-approved.json"), "utf8")));

describe("the intake landed", () => {
  it("wrote every approved reading as a draft, and nothing else", () => {
    expect(saunaProducts.map((p) => p.id).sort()).toEqual([...SAUNA_IDS].sort());
    expect(saunaProducts.every((p) => p.status === "draft")).toBe(true);
    // Real products from real pages. Nothing here is prototype data.
    expect(saunaProducts.every((p) => p.flags.demo === false)).toBe(true);
  });

  it("carries no image, because no right to one has been established", () => {
    expect(saunaProducts.every((p) => p.images.length === 0)).toBe(true);
  });
});

describe("a draft cannot reach a shopper", () => {
  it("is absent from every published read", async () => {
    const published = await provider.listProductViews({ status: ["published"] });
    for (const id of SAUNA_IDS) expect(published.map((v) => v.id)).not.toContain(id);
    const byIds = await provider.listProductViews({ ids: SAUNA_IDS, status: ["published"] });
    expect(byIds).toEqual([]);
  });

  it("sits in a category that has no page", () => {
    // The whole of the public separation. An id resolves so a record can
    // validate and render in review; a slug does not, so no URL reaches it.
    expect(categoryById("saunas")).toBeDefined();
    expect(categoryBySlug("saunas")).toBeUndefined();
    expect(categories.map((c) => c.id)).toEqual(["red-light", "cold-plunge", "wellness-drinks"]);
    expect(allCategories.map((c) => c.id)).toContain("saunas");
  });

  it("does not announce its brands anywhere a shopper looks", async () => {
    // The one place the published-only rule was missing. Listing every brand in
    // the catalogue put SaunaCloud, Dynamic Saunas and Sweat Kingdom on the
    // home page, on /brands and in the sitemap while their products were
    // drafts, each linking to a page with nothing on it.
    vi.resetModules();
    const { getBrands, getBrandPage } = await import("@/lib/queries");
    const listed = (await getBrands()).map((b) => b.id);
    for (const id of ["saunacloud", "dynamic-saunas", "sweat-kingdom"]) {
      expect(catalog.brands.map((b) => b.id), "the record exists").toContain(id);
      expect(listed, "and is not listed").not.toContain(id);
      expect(await getBrandPage(id), "and has no page").toBeNull();
    }
    // The brands behind published products are untouched.
    expect(listed).toContain("lmnt");
    expect(await getBrandPage("lmnt")).not.toBeNull();
  });

  it("would still have no product page even if somebody published it", () => {
    // `getProductPage` resolves the category through the published list, so
    // publishing a record is not on its own enough to expose the category.
    const view = viewOf("saunacloud-atlas-one");
    expect(categories.find((c) => c.id === view.categoryId)).toBeUndefined();
  });
});

describe("running the import again", () => {
  const built = toCatalogRecords(intake);

  it("builds every reading without refusing one", () => {
    expect(built.refusals).toEqual([]);
    expect(built.records.products).toHaveLength(3);
  });

  it("changes nothing when the catalogue already says what the reading says", () => {
    const plan = planIntake(catalog.products, built.records.products);
    expect(plan.creates).toEqual([]);
    expect(plan.differs).toEqual([]);
    expect(plan.unchanged.sort()).toEqual([...SAUNA_IDS].sort());
  });

  it("reports a reviewer's edit instead of overwriting it", () => {
    // The case this exists for: somebody corrected a draft, wrote a
    // description, recorded an image and approved it. A second import must not
    // put the reading back over the top of that.
    const edited = catalog.products.map((p) =>
      p.id === "dynamic-barcelona-dyn-6106-01"
        ? { ...p, name: "Barcelona (checked by a person)", description: "Written by a reviewer.", status: "published" as const }
        : p,
    );
    const plan = planIntake(edited, built.records.products);
    expect(plan.creates).toEqual([]);
    expect(plan.differs).toEqual(["dynamic-barcelona-dyn-6106-01"]);
    const record = plan.records.find((r) => r.id === "dynamic-barcelona-dyn-6106-01")!;
    expect(record.differences).toEqual(["description", "name", "status"]);
    // And it says a person has already moved this one on.
    expect(record.reviewed).toBe(true);
  });

  it("creates only what is missing", () => {
    const plan = planIntake(catalog.products.filter((p) => p.id !== "saunacloud-atlas-one"), built.records.products);
    expect(plan.creates).toEqual(["saunacloud-atlas-one"]);
    expect(plan.differs).toEqual([]);
  });
});

describe("a merchant that quotes on request", () => {
  const atlas = viewOf("saunacloud-atlas-one");

  it("records no amount rather than an amount of zero", () => {
    const offer = productById("saunacloud-atlas-one").offers[0];
    expect(offer.quoteOnly).toBe(true);
    expect(offer.priceMinor).toBeUndefined();
    // A quote-only cabinet is an ordinary way to sell a made-to-order product,
    // not a defect, and it does not keep the listing off the site. What it must
    // never become is a figure nobody quoted.
    for (const p of saunaProducts) for (const o of p.offers) expect(o.priceMinor).not.toBe(0);
  });

  it("says Request pricing rather than Check current price", () => {
    expect(atlas.price.basis).toBe("quote");
    expect(atlas.price.money).toBeUndefined();
    expect(displayPrice(atlas.price)).toBe(PRICE_ON_REQUEST);
    expect(displayOfferPrice(buyableOffers(atlas)[0])).toBe(PRICE_ON_REQUEST);
  });

  it("still gives a shopper somewhere to go", () => {
    const buyable = buyableOffers(atlas);
    expect(buyable).toHaveLength(1);
    expect(buyable[0].url).toBe("https://saunacloud.com/?ref=2be9769d46ff7c74");
  });

  it("is not swept up by a budget filter as though it cost nothing", () => {
    const under = saunas.filters.find((f) => f.key === "price")!.presets![0];
    expect(under.condition.value).toBe(250000);
    expect(matchesAll(atlas, saunas, [under.condition])).toBe(false);
    // And the priced one it should catch, it catches.
    expect(matchesAll(viewOf("dynamic-barcelona-dyn-6106-01"), saunas, [under.condition])).toBe(true);
  });

  it("publishes no schema.org offer, because an offer carries a price", () => {
    expect(buyableOffers(atlas).filter((o) => o.price !== undefined && !o.priceIsDemo)).toEqual([]);
  });
});

describe("a page that says two things about stock", () => {
  it("claims neither", () => {
    const sweat = productById("sweat-kingdom-sweat-box-1p");
    expect(sweat.availability).toBe("unknown");
    expect(sweat.offers[0].availability).toBe("unknown");
    for (const p of saunaProducts) {
      expect(p.availability).not.toBe("in_stock");
      for (const o of p.offers) expect(o.availability).not.toBe("in_stock");
    }
  });

  it("keeps both statements on the record", () => {
    const note = productById("sweat-kingdom-sweat-box-1p").offers[0].source.note ?? "";
    expect(note).toContain("sold out");
    expect(note).toContain("five-week lead time");
  });

  it("still links to the merchant, so a shopper can check for themselves", () => {
    // A lead time is how a made-to-order sauna is sold. The page is where
    // availability is settled, and the record's job is to send somebody there
    // without claiming either of the two things that page says.
    const view = viewOf("sweat-kingdom-sweat-box-1p");
    expect(buyableOffers(view)).toHaveLength(1);
    expect(buyableOffers(view)[0].url).toBe("https://sweatkingdom.com/products/the-sweat-box-1-person");
    expect(view.price.money?.amountMinor).toBe(554500);
  });
});

describe("who is speaking, and who is selling", () => {
  it("keeps a brand and a retailer apart", () => {
    const dynamic = productById("dynamic-barcelona-dyn-6106-01");
    expect(dynamic.brandId).toBe("dynamic-saunas");
    expect(dynamic.offers[0].merchantId).toBe("select-saunas");
    expect(catalog.brands.find((b) => b.id === "dynamic-saunas")?.name).toBe("Dynamic Saunas");
    expect(catalog.merchants.find((m) => m.id === "select-saunas")?.name).toBe("Select Saunas");
  });

  it("says a retailer relayed the maker's figures, rather than claiming the maker was read", () => {
    const view = viewOf("dynamic-barcelona-dyn-6106-01");
    const p = view.provenance["attributes.sauna_type"];
    expect(p.verification).toBe("manufacturer_reported");
    expect(p.source.kind).toBe("retailer");
    expect(attributionTag({ verification: p.verification, source: p.source })).toBe("Via retailer");
  });

  it("records a maker's own page as the maker", () => {
    const view = viewOf("saunacloud-atlas-one");
    expect(view.provenance["attributes.sauna_type"].source.kind).toBe("manufacturer");
    expect(view.brand.name).toBe("SaunaCloud");
  });

  it("marks every field the pages do not state", () => {
    expect(viewOf("saunacloud-atlas-one").provenance["attributes.heater_kw"].verification).toBe("not_stated");
    expect(viewOf("dynamic-barcelona-dyn-6106-01").provenance["attributes.placement"].verification).toBe("not_stated");
    // The circuit is stated and the voltage is not. Both are recorded.
    expect(viewOf("sweat-kingdom-sweat-box-1p").attributes.amperage_a).toBe(30);
    expect(viewOf("sweat-kingdom-sweat-box-1p").provenance["attributes.voltage"].verification).toBe("not_stated");
  });
});

describe("what each link is", () => {
  it("calls the two product-page links ordinary, because nobody has issued a tracking link for them", () => {
    // Select Saunas and Sweat Kingdom are approved programmes with no link
    // supplied. Whether a commission link exists is a different question from
    // whether an ordinary merchant link can be shown honestly, and the answer
    // to the second is yes.
    for (const id of ["dynamic-barcelona-dyn-6106-01", "sweat-kingdom-sweat-box-1p"]) {
      const offer = productById(id).offers[0];
      expect(offer.affiliate.status).toBe("non_affiliate");
      expect(outboundRel(offer.affiliate.status)).not.toContain("sponsored");
      expect(new URL(offer.url).search, "no parameter nobody issued").toBe("");
    }
  });

  it("calls the one issued referral link what it is", () => {
    const offer = productById("saunacloud-atlas-one").offers[0];
    expect(offer.url).toBe("https://saunacloud.com/?ref=2be9769d46ff7c74");
    expect(offer.affiliate.status).toBe("affiliate");
    expect(offer.affiliate.network).toBe("direct");
    expect(offer.affiliate.programRef).toBe("2be9769d46ff7c74");
    // It earns, so it says so, in the markup and in the words beside it.
    expect(outboundRel(offer.affiliate.status)).toContain("sponsored");
    expect(RELATIONSHIP_COPY.affiliate).toContain("commission");
  });

  it("keeps a programme's identity on a link that does not pay", () => {
    const sweat = productById("sweat-kingdom-sweat-box-1p").offers[0];
    expect(sweat.affiliate.network).toBe("awin");
    expect(sweat.affiliate.programRef).toBe("awin-advertiser-125462-publisher-3090899");
    expect(sweat.affiliate.status).toBe("non_affiliate");
  });

  it("composes no deep link anywhere", () => {
    const note = productById("saunacloud-atlas-one").offers[0].source.note ?? "";
    expect(note).toContain("No deep link");
    // The issued link addresses the site root. Nothing here bolted its
    // parameter onto a product URL to make one up.
    for (const p of saunaProducts) {
      for (const o of p.offers) {
        if (o.url.includes("ref=")) expect(new URL(o.url).pathname).toBe("/");
      }
    }
  });
});

describe("saunas are not ranked", () => {
  it("has no scoring criteria, and says so where a label would go", () => {
    expect(saunas.scoring.criteria).toEqual([]);
    expect(saunas.scoring.label).toBe("Not ranked");
  });

  it("awards no badge and computes no score", () => {
    const views = saunaProducts.map((p) => toProductView(p, { category: saunas, brands: catalog.brands, merchants: catalog.merchants }));
    // Nothing is published, so nothing is ranked either way. Feeding published
    // copies in proves the ranking itself refuses rather than the status gate.
    const published = views.map((v) => ({ ...v, status: "published" as const }));
    const { products, set } = recommendCategory(published, saunas);
    expect(products).toHaveLength(3);
    expect(products.every((p) => p.score === 0)).toBe(true);
    expect(products.flatMap((p) => p.badges)).toEqual([]);
    expect(set.badges).toEqual([]);
  });
});
