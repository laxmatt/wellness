import Link from "next/link";
import { CategoryHero, MatcherInput, RankingTransparency } from "@/components/category/sections";
import { WinnersRow } from "@/components/category/WinnersRow";
import { FilterChips, FilterableGrid } from "@/components/category/FilterBar";
import { CategoryFilterProvider } from "@/components/category/FilterContext";
import { StartingPoint } from "@/components/category/StartingPoint";
import { ProductCard } from "@/components/product/ProductCard";
import { buildFilterGroups } from "@/domain/filters";
import { buildNeeds, type CategoryPage } from "@/lib/queries";

/**
 * One browse surface, for the category page and every facet URL under it.
 *
 * They were two pages. The facet one rendered a filtered subset of products and
 * built its chips from that subset, so a shopper who arrived at
 * /wellness-drinks/energy could narrow further and never widen: nothing on the
 * page could reach a drink that was not an energy drink. The facet was in the
 * route, and a route is not a control.
 *
 * Now a facet is a chip, already pressed. Same products, same groups, same
 * state, same counts. The URL decides what starts selected and nothing else,
 * so removing it is an ordinary tap and "Clear filters" clears it like any
 * other.
 */
export function CategoryBrowse({
  page,
  // What a facet URL opened with, if this is one. It earns a single line of
  // orientation, shown only while those chips are still on, and nothing else.
  // The heading, the hero and the count belong to the category on every page
  // that renders this, because that is what they are counting: a hero reading
  // "Sugar-Free Wellness Drinks" above "all 6 we track" describes neither the
  // page nor the results, and once the shopper widens it describes nothing.
  initialSelected = [],
}: {
  page: CategoryPage;
  initialSelected?: string[];
}) {
  const { cat, products, set } = page;
  // `initialSelected` is kept, so a starting point that matches nothing still
  // appears as the chip holding the result empty. Without it the shopper lands
  // on an empty grid with no control to undo.
  const filterGroups = buildFilterGroups(products.map((p) => p.view), cat, initialSelected);
  const ids = products.map((p) => p.view.id);
  // Named by the chip, not by the facet. /wellness-drinks/sugar-free presses a
  // chip reading "Zero sugar", and a line saying "Sugar-free is selected" sends
  // the shopper looking for a control with that name.
  const startingLabel = filterGroups
    .flatMap((g) => g.options)
    .filter((o) => initialSelected.includes(o.id))
    .map((o) => o.label)
    .join(" and ");

  return (
    <>
      <CategoryHero cat={cat} title={cat.tagline} description={cat.intro} count={products.length} />
      <CategoryFilterProvider groups={filterGroups} ids={ids} needs={buildNeeds(page)} categoryId={cat.id} initialSelected={initialSelected}>
        <div className="mt-8 flex flex-col gap-10">
          <MatcherInput cat={cat} />
        </div>
        <div className="mt-10">
          <WinnersRow products={products} cat={cat} set={set} />
        </div>
        <div className="mt-12 flex flex-col gap-10">
          <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="eyebrow">All {cat.navLabel.toLowerCase()}</p>
                <h2 className="font-display mt-1 text-3xl">Pick what matters to you.</h2>
              </div>
            </div>
            {startingLabel ? <StartingPoint ids={initialSelected} label={startingLabel} /> : null}
            <div className="mt-6">
              <FilterChips />
            </div>
            <div className="mt-6">
              <FilterableGrid sortLabel={cat.scoring.label.toLowerCase()}>
                {products.map((item, i) => (
                  <ProductCard key={item.view.id} item={item} cat={cat} priority={i < 4} />
                ))}
              </FilterableGrid>
            </div>
            <p className="mt-4 text-xs text-fg-muted">
              Badges are decided across all {products.length} {cat.name.toLowerCase()} we track, not within your filters.{" "}
              <Link href={`/${cat.slug}`} className="font-semibold text-accent-strong hover:underline">
                All {cat.navLabel.toLowerCase()}
              </Link>
            </p>
          </section>
          <RankingTransparency cat={cat} />
        </div>
      </CategoryFilterProvider>
    </>
  );
}
