// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FacetChips } from "@/components/category/sections";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { coldPlunge, redLight } from "@/domain/categories";
import { recommendCategory } from "@/domain/recommend";
import { liveFacets } from "@/lib/queries";
import { viewsFor } from "./fixtures";

// Two findings from the public-journey harness. Both are the same shape: the
// domain knew something and the page did not say it.

afterEach(cleanup);

const page = (cat: typeof coldPlunge) => {
  const views = viewsFor(cat.id);
  const { products, set } = recommendCategory(views, cat);
  return { cat, products, set };
};

describe("a placeholder price says so where it is shown", () => {
  it("tags a placeholder price", () => {
    const olipop = viewsFor("wellness-drinks").find((v) => v.id === "olipop-root-beer-12")!;
    expect(olipop.price.isDemo).toBe(true);
    render(<PriceDisplay price={olipop.price} />);
    expect(screen.getByText("Demo data")).toBeTruthy();
  });

  it("tags it on a card too, where most shoppers meet it", () => {
    const liquidIv = viewsFor("wellness-drinks").find((v) => v.id === "liquid-iv-hydration-multiplier-16")!;
    render(<PriceDisplay price={liquidIv.price} compact />);
    expect(screen.getByText("Demo data")).toBeTruthy();
  });

  it("says nothing about a real price", () => {
    const lmnt = viewsFor("wellness-drinks").find((v) => v.id === "lmnt-citrus-salt-30")!;
    expect(lmnt.price.isDemo).toBe(false);
    render(<PriceDisplay price={lmnt.price} />);
    expect(screen.queryByText("Demo data")).toBeNull();
  });
});

describe("a facet that matches nothing is not offered", () => {
  it("knows which facets still match something", () => {
    // `placement` values were assumed and were removed, so no cold plunge
    // states an indoor rating any more.
    expect(liveFacets(page(coldPlunge))).not.toContain("indoor");
    expect(liveFacets(page(coldPlunge))).toContain("with-chiller");
    expect(liveFacets(page(redLight)).sort()).toEqual(redLight.facets.map((f) => f.slug).sort());
  });

  it("leaves the empty facet out of the chips", () => {
    render(<FacetChips cat={coldPlunge} available={liveFacets(page(coldPlunge))} />);
    const nav = screen.getByRole("navigation");
    expect(within(nav).queryByText("Indoor")).toBeNull();
    expect(within(nav).getByText("With a chiller")).toBeTruthy();
  });

  it("still shows it when it is the page you are on", () => {
    // Arriving by link or by URL, a shopper has to see where they are.
    render(<FacetChips cat={coldPlunge} active="indoor" available={liveFacets(page(coldPlunge))} />);
    expect(within(screen.getByRole("navigation")).getByText("Indoor")).toBeTruthy();
  });
});
