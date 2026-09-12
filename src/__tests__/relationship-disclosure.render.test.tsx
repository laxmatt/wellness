// @vitest-environment jsdom

/**
 * What a shopper is told about a link before they take it.
 *
 * The product page has stated the relationship with each retailer for a long
 * time. The category card and the winners row carried the same outbound buttons
 * with nothing beside them, so a shopper who never opened a product page saw a
 * way out of the site and no statement about who pays for it.
 *
 * Three answers matter, and the third is the reason the other two are not
 * enough. "Unknown" is what the catalogue says when nobody recorded the
 * relationship, which is what all 26 offers say today. It must not read as a
 * denial and it must not read as a claim.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { ProductCard } from "@/components/product/ProductCard";
import { WinnersRow } from "@/components/category/WinnersRow";
import { categoryById } from "@/domain/categories";
import type { AffiliateStatus } from "@/domain/product";
import { relationshipNote, RELATIONSHIP_COPY } from "@/domain/outbound";
import { BADGES, recommendCategory } from "@/domain/recommend";
import { buyableOffers, type ProductView } from "@/domain/view";
import { catalog, viewsFor } from "./fixtures";

afterEach(cleanup);

/** The same views the site renders, with every offer's relationship set. */
function asIf(categoryId: string, status: AffiliateStatus): ProductView[] {
  return viewsFor(categoryId).map((v) => ({ ...v, offers: v.offers.map((o) => ({ ...o, affiliateStatus: status })) }));
}

function cardFor(categoryId: string, productId: string, views: ProductView[]) {
  const cat = categoryById(categoryId)!;
  const { products } = recommendCategory(views, cat);
  const item = products.find((p) => p.view.id === productId)!;
  return { cat, item };
}

function drawCard(categoryId: string, productId: string, status: AffiliateStatus) {
  const { cat, item } = cardFor(categoryId, productId, asIf(categoryId, status));
  render(
    <CompareProvider>
      <ProductCard item={item} cat={cat} />
    </CompareProvider>,
  );
  return item;
}

// One product, one buyable offer, so the card links out rather than inward.
const ONE_OFFER = { category: "wellness-drinks", product: "liquid-iv-hydration-multiplier-16" };

describe("a category card that sends a shopper out", () => {
  it("says a paid link is paid", () => {
    drawCard(ONE_OFFER.category, ONE_OFFER.product, "affiliate");
    expect(screen.getByText(RELATIONSHIP_COPY.affiliate)).toBeTruthy();
    expect(screen.getByText("Shop").closest("a")!.getAttribute("rel")).toBe("sponsored nofollow noopener");
  });

  it("says an ordinary link earns nothing", () => {
    drawCard(ONE_OFFER.category, ONE_OFFER.product, "non_affiliate");
    expect(screen.getByText(RELATIONSHIP_COPY.non_affiliate)).toBeTruthy();
    expect(screen.getByText("Shop").closest("a")!.getAttribute("rel")).toBe("nofollow noopener");
  });

  it("says an unrecorded relationship is unrecorded, and claims nothing either way", () => {
    drawCard(ONE_OFFER.category, ONE_OFFER.product, "unknown");
    const note = screen.getByText(RELATIONSHIP_COPY.unknown);
    expect(note).toBeTruthy();
    // Not a denial. "No commission" is a claim about a fact nobody recorded.
    expect(note.textContent).not.toMatch(/no commission/i);
    expect(note.textContent).not.toMatch(/we may earn/i);
  });

  it("is what the shipped catalogue produces, with nothing overridden", () => {
    const { cat, item } = cardFor(ONE_OFFER.category, ONE_OFFER.product, viewsFor(ONE_OFFER.category));
    render(
      <CompareProvider>
        <ProductCard item={item} cat={cat} />
      </CompareProvider>,
    );
    expect(screen.getByText(RELATIONSHIP_COPY.unknown)).toBeTruthy();
  });

  it("says nothing where the card links to this site rather than out of it", () => {
    // Plunge's only offer is withheld, so the card offers Details and there is
    // no outbound link for a disclosure to be about.
    const { cat, item } = cardFor("cold-plunge", "plunge-original", viewsFor("cold-plunge"));
    expect(buyableOffers(item.view)).toEqual([]);
    render(
      <CompareProvider>
        <ProductCard item={item} cat={cat} />
      </CompareProvider>,
    );
    for (const copy of Object.values(RELATIONSHIP_COPY)) expect(screen.queryByText(copy)).toBeNull();
  });
});

function drawWinners(categoryId: string, status: AffiliateStatus) {
  const cat = categoryById(categoryId)!;
  const { products, set } = recommendCategory(asIf(categoryId, status), cat);
  render(
    <CompareProvider>
      <WinnersRow cat={cat} set={set} products={products} />
    </CompareProvider>,
  );
}

describe("the winners row, where a card can carry several retailers", () => {
  it("states the relationship for each of the three answers", () => {
    drawWinners("red-light", "affiliate");
    expect(screen.getAllByText(/Affiliate links?\. We may earn a commission\./).length).toBeGreaterThan(0);
    cleanup();

    drawWinners("red-light", "non_affiliate");
    expect(screen.getAllByText(/Ordinary links?\. No commission\./).length).toBeGreaterThan(0);
    cleanup();

    drawWinners("red-light", "unknown");
    const notes = screen.getAllByText(/Affiliate status not recorded/);
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(note.textContent).not.toMatch(/no commission/i);
  });

  it("carries one statement per winner that has something to link, and none for the rest", () => {
    const cat = categoryById("cold-plunge")!;
    const { products, set } = recommendCategory(viewsFor("cold-plunge"), cat);
    render(
      <CompareProvider>
        <WinnersRow cat={cat} set={set} products={products} />
      </CompareProvider>,
    );
    // The same rule the component uses to pick its cards, so this counts the
    // cards that are actually drawn rather than the category.
    const drawn = BADGES.map((b) => products.find((p) => p.badges[0] === b)).filter((p) => p !== undefined);
    const withLinks = drawn.filter((p) => buyableOffers(p!.view).length > 0);
    expect(withLinks.length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/Affiliate status not recorded/)).toHaveLength(withLinks.length);

    // The negative case is not constructed here on purpose. Emptying a
    // winner's offers does not produce a winner with no link: `recommendCategory`
    // already prefers products a shopper can buy, so another product takes the
    // badge and the count does not move. A card with nothing to link carrying
    // no statement is proved directly on the card above, and the empty set is
    // covered where the line is built.
  });
});

describe("one line for a set of links", () => {
  it("describes a set by what it holds, never by what it does not", () => {
    expect(relationshipNote([])).toBeUndefined();
    expect(relationshipNote(["affiliate", "affiliate"])).toBe("Affiliate links. We may earn a commission.");
    expect(relationshipNote(["non_affiliate", "non_affiliate"])).toBe("Ordinary links. No commission.");
    expect(relationshipNote(["unknown", "unknown"])).toBe("Affiliate status not recorded for these offers.");
  });

  it("does not let a paid link hide inside a mixed set", () => {
    for (const mix of [
      ["affiliate", "unknown"],
      ["affiliate", "non_affiliate"],
      ["non_affiliate", "affiliate", "unknown"],
    ] as AffiliateStatus[][]) {
      expect(relationshipNote(mix)).toBe("Some of these are affiliate links. We may earn a commission on those.");
    }
  });

  it("does not turn an unrecorded link into a denial", () => {
    const mixed = relationshipNote(["non_affiliate", "unknown"])!;
    expect(mixed).toBe("Some of these have no affiliate status recorded.");
    expect(mixed).not.toMatch(/no commission/i);
  });
});

describe("the product page's site-level sentence", () => {
  // It is hard-coded and it is true today: this site has no affiliate
  // programme. It becomes false the moment one offer says it pays, and it sits
  // directly above a row that would then read "we may earn a commission". This
  // fails at that moment rather than after somebody reads the page.
  it("is only allowed to stand while no offer in the catalogue is an affiliate link", () => {
    const paid = catalog().products.flatMap((p) => p.offers).filter((o) => o.affiliate.status === "affiliate");
    const detail = readFileSync(join(process.cwd(), "src/components/product/detail.tsx"), "utf8");
    const sentence = "No affiliate programme is in place for this site, so none of these links earns a commission.";
    if (paid.length === 0) {
      expect(detail).toContain(sentence);
    } else {
      expect(
        detail.includes(sentence),
        `${paid.length} offers now record an affiliate link, so this sentence is false. Replace it with something computed from the offers shown.`,
      ).toBe(false);
    }
  });
});
