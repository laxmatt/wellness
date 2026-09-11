import Link from "next/link";
import { CategoryHero, MatcherInput, RankingTransparency } from "@/components/category/sections";
import { WinnersRow } from "@/components/category/WinnersRow";
import { FilterChips, FilterableGrid } from "@/components/category/FilterBar";
import { CategoryFilterProvider } from "@/components/category/FilterContext";
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
  title,
  description,
  initialSelected = [],
  // The facet this URL is, when it is one. Shown as a line of orientation, not
  // as a second set of controls.
  startingFrom,
}: {
  page: CategoryPage;
  title: string;
  description: string;
  initialSelected?: string[];
  startingFrom?: string;
}) {
  const { cat, products, set } = page;
  // `initialSelected` is kept, so a starting point that matches nothing still
  // appears as the chip holding the result empty. Without it the shopper lands
  // on an empty grid with no control to undo.
  const filterGroups = buildFilterGroups(products.map((p) => p.view), cat, initialSelected);
  const ids = products.map((p) => p.view.id);

  return (
    <>
      <CategoryHero cat={cat} title={title} description={description} count={products.length} />
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
                <h2 className="font-display mt-1 text-3xl">{startingFrom ? `Starting from ${startingFrom}.` : "Pick what matters to you."}</h2>
              </div>
            </div>
            {startingFrom ? (
              <p className="mt-2 max-w-2xl text-sm text-fg-soft">
                {startingFrom} is a filter, not a different page. It is switched on below. Turn it off or add to it, and the {products.length} {cat.name.toLowerCase()} we track stay
                reachable.
              </p>
            ) : null}
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
