// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { CompareProvider } from "@/components/compare/CompareProvider";
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

describe("a placeholder amount is not shown at all", () => {
  it("sends the shopper to the merchant instead of quoting a number nobody quoted", () => {
    const olipop = viewsFor("wellness-drinks").find((v) => v.id === "olipop-root-beer-12")!;
    expect(olipop.price.isDemo).toBe(true);
    render(<PriceDisplay price={olipop.price} />);
    expect(screen.getByText("Check current price")).toBeTruthy();
    expect(screen.queryByText("$35.88")).toBeNull();
  });

  it("does the same on a card, where most shoppers meet the price", () => {
    const bonCharge = viewsFor("red-light").find((v) => v.id === "bon-charge-max")!;
    expect(bonCharge.price.isDemo).toBe(true);
    render(<PriceDisplay price={bonCharge.price} compact />);
    expect(screen.getByText("Check current price")).toBeTruthy();
    expect(screen.queryByText("$1,099")).toBeNull();
  });

  it("withholds a money figure computed from a placeholder price", () => {
    // OLIPOP's price per serving is its prototype pack price divided by cans,
    // recorded as an editorial calculation and shown as a fact.
    const olipop = viewsFor("wellness-drinks").find((v) => v.id === "olipop-root-beer-12")!;
    expect(olipop.price.isDemo).toBe(true);
    expect(olipop.attributes.price_per_serving_minor).toBeUndefined();
    const spec = olipop.specs.find((s) => s.key === "price_per_serving_minor")!;
    expect(spec.formatted).toBe("Check current price");
    expect(spec.moneyWithheld).toBe(true);
  });

  it("shows a real price once one is on record, even when a lower prototype exists", () => {
    // Hooga's HG300 carries the maker's $199 and an Amazon record whose $149
    // is prototype data. The lower invented number is not a cheaper offer.
    const hg300 = viewsFor("red-light").find((v) => v.id === "hooga-hg300")!;
    render(<PriceDisplay price={hg300.price} />);
    expect(screen.getByText("$199")).toBeTruthy();
    expect(screen.queryByText("Check current price")).toBeNull();
  });

  it("still shows a real price", () => {
    const lmnt = viewsFor("wellness-drinks").find((v) => v.id === "lmnt-citrus-salt-30")!;
    expect(lmnt.price.isDemo).toBe(false);
    render(<PriceDisplay price={lmnt.price} />);
    expect(screen.getByText("$45")).toBeTruthy();
    expect(screen.queryByText("Check current price")).toBeNull();
    expect(lmnt.attributes.price_per_serving_minor).toBe(150);
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

describe("closing the assistant gives focus back", () => {
  beforeEach(() => {
    Element.prototype.scrollTo = vi.fn();
  });

  it("returns focus to the button that opened it", async () => {
    render(
      <CompareProvider>
        <AssistantProvider categoryId="red-light">
          <AssistantLauncher />
          <AssistantPanel />
        </AssistantProvider>
      </CompareProvider>,
    );
    const launcher = screen.getByRole("button", { name: /Help me choose/ });
    launcher.focus();
    expect(document.activeElement).toBe(launcher);

    fireEvent.click(launcher);
    const input = await screen.findByPlaceholderText(/what matters to you/i);
    expect(document.activeElement).toBe(input);

    // Escape, the way a keyboard shopper closes it. Focus used to land on the
    // body, which means tabbing from the top of the document again.
    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByRole("button", { name: /Help me choose/ });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Help me choose/ }));
  });
});
