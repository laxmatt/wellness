// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompareView } from "@/components/compare/CompareView";
import { OfferList, ProvenanceBlock, SpecGroups } from "@/components/product/detail";
import { PriceDisplay } from "@/components/ui/PriceDisplay";
import { redLight, wellnessDrinks } from "@/domain/categories";
import { toProductView } from "@/domain/view";
import { buildCompareModel } from "@/domain/compare";
import { recommendCategory } from "@/domain/recommend";
import { miniCategory, miniProduct, miniView, offer, testBrand, testMerchant, viewsFor } from "./fixtures";

// The screen, not the model behind it. A qualifier that survives the domain
// and dies in a component is a qualifier a shopper never sees, and this is the
// second time that has happened here: `specs` withheld demo values from every
// screen while `attributes` kept them, and every note the catalogue records
// was collected by the sources block and never rendered.

afterEach(cleanup);

const ag1 = () => viewsFor("wellness-drinks").find((v) => v.id === "ag1-pouch-30")!;
const pro1500 = () => viewsFor("red-light").find((v) => v.id === "hooga-pro1500")!;
const bonCharge = () => viewsFor("red-light").find((v) => v.id === "bon-charge-max")!;

describe("the product page", () => {
  it("shows AG1's sugar as the bound its label states", () => {
    render(<SpecGroups view={ag1()} cat={wellnessDrinks} />);
    const row = screen.getByText("Total sugar").closest("div")!;
    expect(within(row).getByText("less than 1 g")).toBeTruthy();
    // The number alone, presented as the amount, is the defect.
    expect(within(row).queryByText("1 g")).toBeNull();
  });

  it("shows a panel's irradiance as the floor its maker states", () => {
    render(<SpecGroups view={bonCharge()} cat={redLight} />);
    expect(screen.getByText("more than 142 mW/cm²")).toBeTruthy();
    expect(screen.queryByText("142 mW/cm²")).toBeNull();
  });

  it("shows a disputed figure with the value and the word", () => {
    // PRO1500's page says "over 189" in its highlights and 189 in its table.
    render(<SpecGroups view={pro1500()} cat={redLight} />);
    expect(screen.getByText("189 mW/cm², disputed")).toBeTruthy();
    expect(screen.queryByText("more than 189 mW/cm²")).toBeNull();
  });
});

describe("the sources block", () => {
  it("counts demo data and unstated figures separately, and calls neither the other", () => {
    render(<ProvenanceBlock view={ag1()} />);
    const text = screen.getByText(/Last updated/).textContent ?? "";
    // AG1 holds one demo field, two figures its source does not state, and one
    // bound. Calling an unstated figure an invention is a different accusation
    // and the wrong one, which is what this counts separately for.
    expect(text).toMatch(/1 field carries demo data/);
    expect(text).toMatch(/2 fields are not stated by the source/);
    expect(text).toMatch(/1 figure is a bound the source states/);
    expect(text).not.toMatch(/3 fields carry demo/);
  });

  it("renders the note that says why, which is where the reason has always been", () => {
    render(<ProvenanceBlock view={ag1()} />);
    expect(screen.getByText(/The label states less than 1 g of total sugar/)).toBeTruthy();
    expect(screen.getByText(/trace caffeine from green tea extract/)).toBeTruthy();
  });

  it("says nothing about demo data on a product that has none", () => {
    const lmnt = viewsFor("wellness-drinks").find((v) => v.id === "lmnt-citrus-salt-30")!;
    render(<ProvenanceBlock view={lmnt} />);
    const text = screen.getByText(/Last updated/).textContent ?? "";
    expect(text).toMatch(/1 field carries demo data/);
    expect(text).not.toMatch(/fields are not stated/);
    expect(text).not.toMatch(/bound/);
  });
});

describe("the comparison table", () => {
  it("prints the qualifier and marks no winner in that row", () => {
    // AG1's sugar is "less than 1 g"; LMNT's is an exact 0. A row holding a
    // bound is shown and left unranked.
    const cat = wellnessDrinks;
    const items = recommendCategory(viewsFor("wellness-drinks"), cat).products.filter((p) =>
      ["ag1-pouch-30", "lmnt-citrus-salt-30"].includes(p.view.id),
    );
    const model = buildCompareModel(items, cat);
    render(<CompareView model={model} ids={items.map((i) => i.view.id)} />);
    const cell = screen.getByText("less than 1 g");
    const row = cell.closest("tr")!;
    expect(within(row).getByText(/a stated bound, not an exact value/)).toBeTruthy();
    expect(within(row).queryAllByLabelText("Strongest in this row").length).toBe(0);
    // Elsewhere in the same table, exact figures still get a winner.
    expect(screen.queryAllByLabelText("Strongest in this row").length).toBeGreaterThan(0);
  });

  it("shows a disputed figure and ranks nothing on it", () => {
    // Built rather than found, for the same reason as its domain twin: which
    // live pair reaches this branch changes as readings arrive, and the branch
    // is the thing under test.
    const disputed = miniProduct("disputed", 20000, { power: 60, size: "m" });
    disputed.attributes.power!.disputed = true;
    disputed.attributes.power!.source.note = "Stated as 60 in one place and 80 in another.";
    const items = recommendCategory([disputed, miniProduct("exact", 20000, { power: 50, size: "m" })].map(miniView), miniCategory).products;
    const model = buildCompareModel(items, miniCategory);
    render(<CompareView model={model} ids={items.map((i) => i.view.id)} />);
    const row = screen.getByText("60, disputed").closest("tr")!;
    expect(within(row).getByText(/states its figure two ways/)).toBeTruthy();
    expect(within(row).queryAllByLabelText("Strongest in this row").length).toBe(0);
  });
});

describe("an offer whose amount belongs to another product is not a way to buy this one", () => {
  const withMismatchCheapest = () => {
    const p = miniProduct("subject", 10000, { power: 50, size: "m" });
    p.offers = [
      { ...offer("real", 2499), url: "https://example.com/lemon-lime-16", source: { kind: "manufacturer" as const, url: "https://example.com/lemon-lime-16", retrievedAt: "2026-09-09", method: "direct" as const } },
      {
        ...offer("mismatched", 1999),
        url: "https://example.com/variety-pack",
        disputed: true,
        source: { kind: "manufacturer" as const, url: "https://example.com/variety-pack", retrievedAt: "2026-09-09", method: "secondhand" as const, note: "Reported for a different pack." },
      },
    ];
    return toProductView(p, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
  };

  it("shows neither its amount nor its link, and keeps the right offer", () => {
    // Labelling the row was not enough. A row with a price and a Shop button
    // is a way to buy something, and this one buys a different product at a
    // different price.
    const { container } = render(<OfferList view={withMismatchCheapest()} />);
    const html = container.innerHTML;
    expect(html).not.toContain("19.99");
    expect(html).not.toContain("variety-pack");
    expect(screen.getByText("$24.99")).toBeTruthy();
    expect(container.querySelector('a[href="https://example.com/lemon-lime-16"]')).toBeTruthy();
  });

  it("tells a shopper the listing is not shown, in words they can act on", () => {
    render(<OfferList view={withMismatchCheapest()} />);
    expect(screen.getByText(/One listing is not shown here/)).toBeTruthy();
    expect(screen.getByText(/Check the price with the retailer/)).toBeTruthy();
    // The bookkeeping belongs on the record, not on the shopping page.
    expect(screen.queryByText(/cannot show it belongs to this product/)).toBeNull();
    expect(screen.queryByText(/on record/)).toBeNull();
  });

  it("does not call the remaining offer the lowest of two", () => {
    const view = withMismatchCheapest();
    // The withheld one really is the cheapest amount on the record, and the
    // list is sorted by amount, so it was the first row. One offer left means
    // no lowest to name.
    expect(view.offers[0].id).toBe("mismatched");
    render(<OfferList view={view} />);
    expect(screen.queryByText("Lowest")).toBeNull();
  });

  it("keeps the evidence on the record, which is where it belongs", () => {
    const view = withMismatchCheapest();
    const row = view.offers.find((o) => o.id === "mismatched")!;
    expect(row.price.amountMinor).toBe(1999);
    expect(row.url).toBe("https://example.com/variety-pack");
    expect(row.disputeNote).toBe("Reported for a different pack.");
  });
});

describe("the comparison table's group keys", () => {
  it("renders two groups that share a label without React seeing one group twice", () => {
    // Wellness Drinks defines a "Buying" group of subscription specs, and the
    // model appends a "Buying" group of retailers to every category. Keyed by
    // label, React saw a duplicate and warned on every compare render. The
    // warning was the only symptom, which is why it sat in the logs.
    const cat = wellnessDrinks;
    const items = recommendCategory(viewsFor("wellness-drinks"), cat).products.slice(0, 3);
    const model = buildCompareModel(items, cat);
    const labels = model.groups.map((g) => g.label);
    expect(labels.filter((l) => l === "Buying").length).toBe(2);

    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args));
    try {
      render(<CompareView model={model} ids={items.map((i) => i.view.id)} />);
    } finally {
      spy.mockRestore();
    }
    expect(errors.flat().join(" ")).not.toMatch(/same key/);
  });
});

describe("a product with no price at all", () => {
  const unpriced = () => {
    const p = miniProduct("unpriced", 12345, { power: 50, size: "m" });
    p.offers = [
      {
        ...offer("mismatched", 12345),
        disputed: true,
        source: { kind: "manufacturer" as const, url: "https://example.com", retrievedAt: "2026-09-09", method: "secondhand" as const, note: "Reported for a different configuration." },
      },
    ];
    return toProductView(p, { category: miniCategory, brands: [testBrand], merchants: [testMerchant] });
  };

  it("says the price is unavailable, and invents neither a retailer count nor a date", () => {
    // The defect: with no money, no basis and no offers, the component fell
    // through to a fallback that read "1 retailer", beside the record's last
    // edit date presented as the day a price was checked. Both were made up.
    const view = unpriced();
    expect(view.price.offerCount).toBe(0);
    const { container } = render(<PriceDisplay price={view.price} />);
    expect(screen.getByText("Check current price")).toBeTruthy();
    expect(screen.getByText("Current price unavailable")).toBeTruthy();
    expect(container.textContent).not.toMatch(/retailer[s]?\b/i);
    expect(container.textContent).not.toMatch(/Lowest of/);
    expect(container.textContent).not.toMatch(/\b\w{3} \d{1,2}\b/);
    expect(container.textContent).not.toContain("123.45");
  });

  it("does the same on a card", () => {
    const { container } = render(<PriceDisplay price={unpriced().price} compact />);
    expect(screen.getByText("Check current price")).toBeTruthy();
    expect(container.textContent).not.toMatch(/retailer/i);
  });

  it("still names a retailer count when there is one", () => {
    const priced = miniView(miniProduct("priced", 5000, { power: 50, size: "m" }));
    const { container } = render(<PriceDisplay price={priced.price} />);
    expect(container.textContent).toMatch(/retailer/i);
    expect(screen.getByText("$50")).toBeTruthy();
  });

  it("offers no way to buy, and says so plainly", () => {
    render(<OfferList view={unpriced()} />);
    expect(screen.getByText(/Current price unavailable/)).toBeTruthy();
    expect(screen.queryByText("$123.45")).toBeNull();
  });
});
