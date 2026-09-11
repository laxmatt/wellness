// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { coldPlunge, redLight } from "@/domain/categories";
import { CategoryDefinition as CategorySchema } from "@/domain/category";
import { matchesAll } from "@/domain/conditions";
import { recommendCategory } from "@/domain/recommend";
import { buildFilterGroups, facetOptionId } from "@/domain/filters";
import { liveFacets } from "@/lib/queries";
import { miniCategory, miniProduct, miniView, moneyView, viewsFor } from "./fixtures";

// Two findings from the public-journey harness. Both are the same shape: the
// domain knew something and the page did not say it.

afterEach(cleanup);

describe("a placeholder amount is not shown at all", () => {
  it("sends the shopper to the merchant instead of quoting a number nobody quoted", () => {
    // Built, for the reason the next test gives: this named whichever
    // catalogue product still had a prototype price.
    const view = moneyView("prototype-priced", 3588, true);
    expect(view.price.isDemo).toBe(true);
    render(<PriceDisplay price={view.price} />);
    expect(screen.getByText("Check current price")).toBeTruthy();
    expect(screen.queryByText("$35.88")).toBeNull();
  });

  it("does the same on a card, where most shoppers meet the price", () => {
    // Built rather than found: this named whichever catalogue product still
    // had a prototype price, and moved each time a real one was read.
    const view = miniView(miniProduct("prototype-priced", 109900, { power: 50, size: "m" }, "unknown", [], true));
    expect(view.price.isDemo).toBe(true);
    render(<PriceDisplay price={view.price} compact />);
    expect(screen.getByText("Check current price")).toBeTruthy();
    expect(screen.queryByText("$1,099")).toBeNull();
  });

  it("withholds a money figure computed from a placeholder price", () => {
    // A cost per use recorded as an editorial calculation over a prototype
    // pack price, and shown as a fact. This was OLIPOP's price per serving
    // until its page was read; before that it was Liquid I.V.'s. The rule is
    // not about either product, so it is tested on neither.
    const view = moneyView("prototype-priced", 3588, true, { derived: 299 });
    expect(view.price.isDemo).toBe(true);
    expect(view.attributes.cost_per_use_minor).toBeUndefined();
    const spec = view.specs.find((s) => s.key === "cost_per_use_minor")!;
    expect(spec.formatted).toBe("Check current price");
    expect(spec.moneyWithheld).toBe(true);

    // And the amount that stands on its own source is untouched by the
    // prototype price sitting beside it.
    expect(view.attributes.shipping_minor).toBe(499);
    expect(view.specs.find((s) => s.key === "shipping_minor")!.moneyWithheld).toBeFalsy();
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
  // Every live facet matches something again: Renu's page, read on
  // 2026-09-09, states indoor and outdoor explicitly, which refilled the one
  // that had emptied. The rule is tested on a category built for it, and the
  // live claim is the one that stays true whatever the data does: what is
  // offered is what matches.
  const emptyFacet = CategorySchema.parse({
    ...JSON.parse(JSON.stringify(miniCategory)),
    facets: [
      { slug: "big", label: "Big", title: "Big", description: "", conditions: [{ key: "power", op: "gte", value: 10 }] },
      { slug: "impossible", label: "Impossible", title: "Impossible", description: "", conditions: [{ key: "power", op: "gte", value: 10_000 }] },
    ],
  });
  const page = (cat: typeof miniCategory) => {
    const views = [miniView(miniProduct("a", 10000, { power: 50, size: "m" })), miniView(miniProduct("b", 20000, { power: 60, size: "l" }))];
    const { products, set } = recommendCategory(views, cat);
    return { cat, products, set };
  };

  it("knows which facets still match something", () => {
    expect(liveFacets(page(emptyFacet))).toEqual(["big"]);
  });

  // The chip bar that navigated to a separate page is gone. What replaced the
  // rule is stronger: a facet that matches nothing is still not offered as a
  // starting point, and if a shopper reaches its URL anyway the chip is there,
  // pressed, so they can take it off. The old bar could only show them where
  // they were stuck.
  it("keeps a starting point that matches nothing as a chip, so it can be removed", () => {
    const { cat, products } = page(emptyFacet);
    const views = products.map((p) => p.view);
    const id = facetOptionId(views, cat, "impossible")!;
    expect(id, "the facet resolves to a chip").toBeTruthy();

    const offered = buildFilterGroups(views, cat).flatMap((g) => g.options.map((o) => o.id));
    expect(offered, "not offered to somebody who did not ask for it").not.toContain(id);

    const arrived = buildFilterGroups(views, cat, [id]).flatMap((g) => g.options);
    const chip = arrived.find((o) => o.id === id);
    expect(chip, "but present when it is the selection the URL arrived with").toBeTruthy();
    expect(chip!.matchIds).toEqual([]);
  });

  it("does not route a facet through a product subset any more", () => {
    const { cat, products } = page(emptyFacet);
    const views = products.map((p) => p.view);
    const id = facetOptionId(views, cat, "big")!;
    // The grid is the category, whatever the URL. Only the selection differs.
    expect(buildFilterGroups(views, cat, [id]).flatMap((g) => g.options.map((o) => o.id))).toContain(id);
  });

  it("offers every live facet in the real catalogue", () => {
    for (const cat of [coldPlunge, redLight]) {
      const views = viewsFor(cat.id);
      const { products, set } = recommendCategory(views, cat);
      const live = liveFacets({ cat, products, set });
      for (const f of cat.facets) {
        const matches = products.some((p) => matchesAll(p.view, cat, f.conditions));
        expect(live.includes(f.slug), `${cat.id}/${f.slug}`).toBe(matches);
      }
    }
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
