// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FilterChips, FilterableGrid } from "@/components/category/FilterBar";
import { CategoryFilterProvider } from "@/components/category/FilterContext";
import { stateOf, useNeeds } from "@/components/needs/NeedsStore";
import { categoryById } from "@/domain/categories";
import { applyFilters, buildFilterGroups, facetOptionId, type FilterGroup } from "@/domain/filters";
import { recommendCategory } from "@/domain/recommend";
import { buildNeeds, facetSelection } from "@/lib/queries";
import { viewsFor } from "./fixtures";

/**
 * Browsing, through the controls a shopper presses.
 *
 * Every expectation is the engine's own answer, computed here from the same
 * domain functions the server renders from. A count proves little on its own:
 * six products can be the wrong six, so each check compares the grid against
 * `applyFilters` rather than against a number typed in.
 *
 * The case that matters most is a facet URL. It used to hand the grid a subset
 * of the category, so somebody who arrived at /wellness-drinks/energy could
 * narrow and never widen: no control on that page could reach a drink that was
 * not an energy drink. Here the same URL is a chip, and taking it off has to
 * reach the drinks it excluded.
 */

afterEach(cleanup);

function pageFor(slug: string) {
  const cat = categoryById(slug)!;
  const views = viewsFor(slug);
  const { products, set } = recommendCategory(views, cat);
  return { cat, views, products, set };
}

// Reads the requirements the page published for other screens, through the same
// hook the comparison uses. The fit shown there and the grid shown here are two
// readings of one state, and this is where they are checked against each other.
function NeedsProbe({ categoryId }: { categoryId: string }) {
  const needs = useNeeds(categoryId);
  return <div data-testid="needs" data-needs={JSON.stringify(needs.map((n) => ({ label: n.label, matchIds: n.matchIds })))} />;
}

function mount(slug: string, initialSelected: string[] = []) {
  const page = pageFor(slug);
  const ids = page.products.map((p) => p.view.id);
  const groups = buildFilterGroups(page.views, page.cat, initialSelected);
  render(
    <CategoryFilterProvider groups={groups} ids={ids} needs={buildNeeds(page)} categoryId={page.cat.id} initialSelected={initialSelected}>
      <FilterChips />
      <FilterableGrid sortLabel={page.cat.scoring.label.toLowerCase()}>
        {page.products.map((p) => (
          <article key={p.view.id} data-slug={p.view.slug} />
        ))}
      </FilterableGrid>
      <NeedsProbe categoryId={page.cat.id} />
    </CategoryFilterProvider>,
  );
  return { ...page, ids, groups };
}

/** The cards the grid is showing, in the order it shows them. */
const shown = () => [...document.querySelectorAll("[data-product-grid] > article")].map((a) => a.getAttribute("data-slug"));
const countLine = () => screen.getByText(/^\d+ of \d+ shown$/).textContent;
const publishedNeeds = (): { label: string; matchIds: string[] }[] => JSON.parse(screen.getByTestId("needs").getAttribute("data-needs")!);

/** A chip by the label a shopper can see. */
function chip(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(label));
  if (!found) throw new Error(`no chip labelled "${label}". Chips: ${[...document.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  return found as HTMLButtonElement;
}
const press = (label: string) => fireEvent.click(chip(label));

/** What the engine admits for these selections, in the page's own order. */
function engineSays(page: ReturnType<typeof pageFor>, groups: FilterGroup[], selected: string[]): string[] {
  const ids = page.products.map((p) => p.view.id);
  const allowed = new Set(applyFilters(ids, groups, selected));
  return page.products.filter((p) => allowed.has(p.view.id)).map((p) => p.view.slug);
}
const labelOf = (groups: FilterGroup[], id: string) => groups.flatMap((g) => g.options).find((o) => o.id === id)!.label;

const ENERGY = "function:energy";
const SUGAR_FREE = "sugar_g:Zero sugar";
const BUDGET = "price_per_serving_minor:Under $2";

describe("energy, sugar-free and a budget, in one page", () => {
  it("combines all three, and the grid is the engine's answer at every step", () => {
    const page = mount("wellness-drinks");
    expect(shown()).toEqual(page.products.map((p) => p.view.slug));

    press(labelOf(page.groups, ENERGY));
    expect(shown()).toEqual(engineSays(page, page.groups, [ENERGY]));

    press(labelOf(page.groups, SUGAR_FREE));
    expect(shown()).toEqual(engineSays(page, page.groups, [ENERGY, SUGAR_FREE]));

    press(labelOf(page.groups, BUDGET));
    const three = engineSays(page, page.groups, [ENERGY, SUGAR_FREE, BUDGET]);
    expect(three.length).toBeGreaterThan(0);
    expect(shown()).toEqual(three);
    expect(countLine()).toBe(`${three.length} of ${page.ids.length} shown`);
  });

  it("removes one without disturbing the others", () => {
    const page = mount("wellness-drinks");
    for (const id of [ENERGY, SUGAR_FREE, BUDGET]) press(labelOf(page.groups, id));

    press(labelOf(page.groups, ENERGY));
    const widened = engineSays(page, page.groups, [SUGAR_FREE, BUDGET]);
    expect(shown()).toEqual(widened);
    expect(widened.length).toBeGreaterThan(engineSays(page, page.groups, [ENERGY, SUGAR_FREE, BUDGET]).length);
    expect(chip(labelOf(page.groups, SUGAR_FREE)).getAttribute("aria-pressed")).toBe("true");
    expect(chip(labelOf(page.groups, ENERGY)).getAttribute("aria-pressed")).toBe("false");
  });

  it("clears back to everything", () => {
    const page = mount("wellness-drinks");
    for (const id of [ENERGY, SUGAR_FREE, BUDGET]) press(labelOf(page.groups, id));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shown()).toEqual(page.products.map((p) => p.view.slug));
    expect(countLine()).toBe(`${page.ids.length} of ${page.ids.length} shown`);
  });

  it("widens within a row and narrows across rows", () => {
    const page = mount("wellness-drinks");
    press(labelOf(page.groups, ENERGY));
    const one = shown().length;
    press(labelOf(page.groups, "function:electrolytes"));
    expect(shown()).toEqual(engineSays(page, page.groups, [ENERGY, "function:electrolytes"]));
    expect(shown().length).toBeGreaterThan(one);

    press(labelOf(page.groups, SUGAR_FREE));
    expect(shown()).toEqual(engineSays(page, page.groups, [ENERGY, "function:electrolytes", SUGAR_FREE]));
    expect(shown().length).toBeLessThan(engineSays(page, page.groups, [ENERGY, "function:electrolytes"]).length);
  });
});

describe("arriving by a facet URL", () => {
  it("starts on the facet's products, with the facet shown as a pressed chip", () => {
    const page = pageFor("wellness-drinks");
    const selection = facetSelection(page, "energy");
    expect(selection).toEqual([ENERGY]);

    const mounted = mount("wellness-drinks", selection);
    expect(shown()).toEqual(engineSays(mounted, mounted.groups, selection));
    expect(chip(labelOf(mounted.groups, ENERGY)).getAttribute("aria-pressed")).toBe("true");
  });

  it("lets the shopper out of it, which the old facet page could not", () => {
    const page = mount("wellness-drinks", [ENERGY]);
    press(labelOf(page.groups, ENERGY));
    // Every drink in the category, including the ones a page built from the
    // facet's subset had no way to render.
    expect(shown()).toEqual(page.products.map((p) => p.view.slug));
    expect(shown().length).toBeGreaterThan(engineSays(page, page.groups, [ENERGY]).length);
  });

  it("widens from the facet by adding an alternative in the same row", () => {
    const page = mount("wellness-drinks", [ENERGY]);
    press(labelOf(page.groups, "function:electrolytes"));
    expect(shown()).toEqual(engineSays(page, page.groups, [ENERGY, "function:electrolytes"]));
  });

  it("clears the facet like any other filter", () => {
    const page = mount("wellness-drinks", [ENERGY]);
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(shown()).toEqual(page.products.map((p) => p.view.slug));
  });

  it("combines a facet start with the other two choices", () => {
    const page = mount("wellness-drinks", [ENERGY]);
    press(labelOf(page.groups, SUGAR_FREE));
    press(labelOf(page.groups, BUDGET));
    expect(shown()).toEqual(engineSays(page, page.groups, [ENERGY, SUGAR_FREE, BUDGET]));
  });
});

describe("what the page says about itself agrees with what it shows", () => {
  it("publishes one requirement per row, and every shown product meets all of them", () => {
    const page = mount("wellness-drinks");
    press(labelOf(page.groups, ENERGY));
    press(labelOf(page.groups, SUGAR_FREE));
    press(labelOf(page.groups, BUDGET));

    const needs = publishedNeeds();
    expect(needs.length, "three rows, three requirements").toBe(3);
    const visible = shown();
    const bySlug = new Map(page.products.map((p) => [p.view.slug, p.view.id]));
    for (const need of needs) {
      for (const slug of visible) {
        expect(need.matchIds, `${slug} vs ${need.label}`).toContain(bySlug.get(slug!));
      }
    }
  });

  it("reports alternatives in one row as one requirement, not as a conflict", () => {
    const page = mount("wellness-drinks");
    press(labelOf(page.groups, ENERGY));
    press(labelOf(page.groups, "function:electrolytes"));
    const needs = publishedNeeds();
    expect(needs.length).toBe(1);
    // And every product either side of the OR satisfies it, rather than one of
    // them failing the other's requirement.
    for (const slug of shown()) {
      const id = page.products.find((p) => p.view.slug === slug)!.view.id;
      expect(stateOf({ id: "x", label: needs[0].label, groupLabel: "", source: "filter", matchIds: needs[0].matchIds, unknownIds: [] }, id)).toBe("match");
    }
  });

  it("says how the results are ordered, beside the results", () => {
    mount("wellness-drinks");
    expect(screen.getByTestId("sort-context").textContent).toContain("Ranked by label score.");
  });
});

describe("the same behaviour in every category", () => {
  const journeys = [
    { slug: "red-light", facet: "under-1000" },
    { slug: "cold-plunge", facet: "with-chiller" },
    { slug: "wellness-drinks", facet: "sugar-free" },
  ];

  /**
   * A chip in another row that still leaves something with the facet applied.
   * Chosen from the engine rather than written here, because a pairing that
   * leaves nothing is disabled on the page: the test would press a dead control
   * and read the failure as a bug in the filtering. Which pairings are live
   * depends on the catalogue, and the catalogue changes.
   */
  function liveSecond(page: ReturnType<typeof pageFor>, groups: FilterGroup[], facetId: string) {
    const ids = page.products.map((p) => p.view.id);
    const ownRow = groups.find((g) => g.options.some((o) => o.id === facetId))!.key;
    for (const g of groups) {
      if (g.key === ownRow) continue;
      for (const o of g.options) {
        if (applyFilters(ids, groups, [facetId, o.id]).length > 0) return o.id;
      }
    }
    throw new Error(`nothing in ${page.cat.id} combines with ${facetId}`);
  }

  for (const journey of journeys) {
    it(`${journey.slug}: arrive on a facet, add a filter, remove the facet, clear`, () => {
      const base = pageFor(journey.slug);
      const facetId = facetOptionId(base.views, base.cat, journey.facet)!;
      const page = mount(journey.slug, [facetId]);
      const second = liveSecond(page, page.groups, facetId);

      expect(shown()).toEqual(engineSays(page, page.groups, [facetId]));

      press(labelOf(page.groups, second));
      expect(shown()).toEqual(engineSays(page, page.groups, [facetId, second]));

      press(labelOf(page.groups, facetId));
      expect(shown()).toEqual(engineSays(page, page.groups, [second]));
      expect(chip(labelOf(page.groups, facetId)).getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(shown()).toEqual(page.products.map((p) => p.view.slug));
    });

    it(`${journey.slug}: a pairing that would leave nothing is disabled, not a dead end`, () => {
      const base = pageFor(journey.slug);
      const facetId = facetOptionId(base.views, base.cat, journey.facet)!;
      const page = mount(journey.slug, [facetId]);
      const ids = page.products.map((p) => p.view.id);
      const ownRow = page.groups.find((g) => g.options.some((o) => o.id === facetId))!.key;
      const empty = page.groups
        .filter((g) => g.key !== ownRow)
        .flatMap((g) => g.options)
        .find((o) => applyFilters(ids, page.groups, [facetId, o.id]).length === 0);
      if (!empty) return;

      expect(chip(empty.label).disabled, `${empty.id} leaves nothing`).toBe(true);
      // And the way out is the chip that is on, which is never disabled.
      expect(chip(labelOf(page.groups, facetId)).disabled).toBe(false);
    });
  }

  it("resolves every facet in every category to a chip that exists on the page", () => {
    for (const slug of ["red-light", "cold-plunge", "wellness-drinks"]) {
      const page = pageFor(slug);
      for (const f of page.cat.facets) {
        const id = facetOptionId(page.views, page.cat, f.slug);
        expect(id, `${slug}/${f.slug}`).toBeTruthy();
        const groups = buildFilterGroups(page.views, page.cat, [id!]);
        expect(groups.flatMap((g) => g.options.map((o) => o.id)), `${slug}/${f.slug} is offered when selected`).toContain(id);
      }
    }
  });
});
