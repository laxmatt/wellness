// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { ProductCard } from "@/components/product/ProductCard";
import { categoryById } from "@/domain/categories";
import { recommendCategory } from "@/domain/recommend";
import { buyableOffers } from "@/domain/view";
import { viewsFor } from "./fixtures";

// The card's action counted one list and linked from another.
//
// `shopHref` came from buyableOffers, which drops a withheld offer. The label
// counted view.offers, which keeps it. Two real products in this catalogue sit
// on the gap: Liquid I.V. holds two offers and one is withheld, so the card
// advertised "2 retailers" over a link straight out to the single retailer a
// shopper can be sent to. Plunge holds one offer and it is withheld, so the
// card offered "Shop" over an anchor with nothing to shop behind it.

afterEach(cleanup);

// The card carries a CompareToggle, which reads the compare provider.
function draw(item: ReturnType<typeof card>["item"], cat: ReturnType<typeof card>["cat"]) {
  return render(
    <CompareProvider>
      <ProductCard item={item} cat={cat} />
    </CompareProvider>,
  );
}

function card(categoryId: string, productId: string) {
  const cat = categoryById(categoryId)!;
  const { products } = recommendCategory(viewsFor(categoryId), cat);
  const item = products.find((p) => p.view.id === productId)!;
  return { item, cat, view: item.view };
}

describe("the action on a product card", () => {
  it("counts the retailers a shopper can be sent to, not the ones on the record", () => {
    const { item, cat, view } = card("wellness-drinks", "liquid-iv-hydration-multiplier-16");
    // The gap this test exists for. If the record changes, the test still
    // asserts the rule rather than the number.
    expect(view.offers.length).toBe(2);
    expect(buyableOffers(view).length).toBe(1);

    draw(item, cat);
    expect(screen.queryByText("2 retailers")).toBeNull();
    const action = screen.getByText("Shop").closest("a")!;
    expect(action.getAttribute("href")).toBe(buyableOffers(view)[0].url);
    // Not "sponsored": nothing in this catalogue is a recorded affiliate link,
    // and the markup says what the record says. See src/domain/outbound.ts.
    expect(action.getAttribute("rel")).toBe("nofollow noopener");
  });

  it("offers details, not a shop, when there is nothing to shop", () => {
    const { item, cat, view } = card("cold-plunge", "plunge-original");
    expect(buyableOffers(view).length).toBe(0);

    draw(item, cat);
    expect(screen.queryByText("Shop")).toBeNull();
    const action = screen.getByText("Details").closest("a")!;
    // Internal, and to the page that says what is known and why no retailer is
    // listed. Not an outbound link and not an anchor to an empty section.
    expect(action.getAttribute("href")).toBe(`/products/${view.slug}`);
    expect(action.getAttribute("rel")).toBeNull();
    expect(action.getAttribute("target")).toBeNull();
  });

  it("still names several retailers when several are buyable", () => {
    const { item, cat, view } = card("red-light", "hooga-pro1500");
    const buyable = buyableOffers(view);
    expect(buyable.length).toBeGreaterThan(1);

    draw(item, cat);
    const action = screen.getByText(`${buyable.length} retailers`).closest("a")!;
    expect(action.getAttribute("href")).toBe(`/products/${view.slug}#retailers`);
    expect(action.getAttribute("target")).toBeNull();
  });

  it("never advertises a count its own link cannot honour", () => {
    for (const categoryId of ["red-light", "cold-plunge", "wellness-drinks"]) {
      const cat = categoryById(categoryId)!;
      const { products } = recommendCategory(viewsFor(categoryId), cat);
      for (const item of products) {
        cleanup();
        draw(item, cat);
        const n = buyableOffers(item.view).length;
        const expected = n > 1 ? `${n} retailers` : n === 1 ? "Shop" : "Details";
        expect(screen.getByText(expected), `${item.view.id} should offer "${expected}"`).toBeTruthy();
      }
    }
  });
});
