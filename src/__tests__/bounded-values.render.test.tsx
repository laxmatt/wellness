// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompareView } from "@/components/compare/CompareView";
import { ProvenanceBlock, SpecGroups } from "@/components/product/detail";
import { redLight, wellnessDrinks } from "@/domain/categories";
import { buildCompareModel } from "@/domain/compare";
import { recommendCategory } from "@/domain/recommend";
import { viewsFor } from "./fixtures";

// The screen, not the model behind it. A qualifier that survives the domain
// and dies in a component is a qualifier a shopper never sees, and this is the
// second time that has happened here: `specs` withheld demo values from every
// screen while `attributes` kept them, and every note the catalogue records
// was collected by the sources block and never rendered.

afterEach(cleanup);

const ag1 = () => viewsFor("wellness-drinks").find((v) => v.id === "ag1-pouch-30")!;
const pro1500 = () => viewsFor("red-light").find((v) => v.id === "hooga-pro1500")!;

describe("the product page", () => {
  it("shows AG1's sugar as the bound its label states", () => {
    render(<SpecGroups view={ag1()} cat={wellnessDrinks} />);
    const row = screen.getByText("Total sugar").closest("div")!;
    expect(within(row).getByText("less than 1 g")).toBeTruthy();
    // The number alone, presented as the amount, is the defect.
    expect(within(row).queryByText("1 g")).toBeNull();
  });

  it("shows the panel's irradiance as the floor its maker states", () => {
    render(<SpecGroups view={pro1500()} cat={redLight} />);
    expect(screen.getByText("more than 189 mW/cm²")).toBeTruthy();
    expect(screen.queryByText("189 mW/cm²")).toBeNull();
  });
});

describe("the sources block", () => {
  it("counts demo data and unstated figures separately, and calls neither the other", () => {
    render(<ProvenanceBlock view={ag1()} />);
    const text = screen.getByText(/Last updated/).textContent ?? "";
    // AG1 holds two demo fields, one figure its source does not state, and one
    // bound. Calling the unstated one an invention is a different accusation
    // and the wrong one.
    expect(text).toMatch(/2 fields carry demo data/);
    expect(text).toMatch(/1 field is not stated by the source/);
    expect(text).toMatch(/1 figure is a bound the source states/);
    expect(text).not.toMatch(/3 fields carry demo/);
  });

  it("renders the note that says why, which is where the reason has always been", () => {
    render(<ProvenanceBlock view={ag1()} />);
    expect(screen.getByText(/Label states less than 1 g total sugar/)).toBeTruthy();
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
    // Both state a distance of 6 in, so the distance rule is satisfied and the
    // bound is the only thing left standing between these two figures.
    const items = recommendCategory(viewsFor("red-light"), redLight).products.filter((p) =>
      ["hooga-hg300", "platinumled-biomax-900"].includes(p.view.id),
    );
    const model = buildCompareModel(items, redLight);
    render(<CompareView model={model} ids={items.map((i) => i.view.id)} />);
    const cell = screen.getByText("more than 73 mW/cm²");
    const row = cell.closest("tr")!;
    expect(within(row).getByText(/a stated bound, not an exact value/)).toBeTruthy();
    expect(within(row).queryAllByLabelText("Strongest in this row").length).toBe(0);
    // Elsewhere in the same table, exact figures still get a winner.
    expect(screen.queryAllByLabelText("Strongest in this row").length).toBeGreaterThan(0);
  });
});
