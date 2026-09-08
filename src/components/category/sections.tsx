import Link from "next/link";
import { MiniCard } from "@/components/product/MiniCard";
import { DemoArt } from "@/components/ui/DemoArt";
import type { CategoryDefinition } from "@/domain/category";
import { attributeDef } from "@/domain/category";
import { BADGE_LABELS, BADGES, primaryStrength, type RecommendedProduct } from "@/domain/recommend";
import { cn } from "@/lib/cn";

export function CategoryHero({ cat, title, description, count }: { cat: CategoryDefinition; title: string; description: string; count: number }) {
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-6 px-4 pt-6 sm:px-6 lg:grid-cols-12 lg:items-center lg:gap-10 lg:px-8 lg:pt-10">
      <div className="lg:col-span-6">
        <p className="eyebrow">
          {cat.name} · {count} compared
        </p>
        <h1 className="font-display mt-3 text-4xl leading-[0.98] sm:text-5xl lg:text-6xl">{title}</h1>
        <p className="mt-4 max-w-xl text-base text-ink-soft sm:text-lg">{description}</p>
      </div>
      <div className="lg:col-span-6">
        <div className="relative overflow-hidden rounded-card shadow-card">
          <div className="aspect-[16/9] lg:aspect-[16/10]">
            <DemoArt seed={`${cat.id}-hero-scene`} variant="scene" label={cat.images[0]?.alt ?? cat.name} className="absolute inset-0 h-full w-full" />
          </div>
        </div>
      </div>
    </section>
  );
}

// Phase 2: rendered, inert. Phase 4 wires it to the matcher.
export function MatcherInput({ cat }: { cat: CategoryDefinition }) {
  const example = cat.id === "red-light"
    ? "a full-body panel under $700 that fits a small apartment"
    : cat.id === "cold-plunge"
      ? "a tub with a chiller under $5,000 for a garage"
      : "sugar-free electrolytes under $2 per serving";
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="rounded-card border border-line bg-paper p-4 shadow-card sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="eyebrow">Tell us what matters to you</span>
            <input
              type="text"
              disabled
              aria-disabled="true"
              placeholder={`e.g. ${example}`}
              className="tap mt-2 w-full rounded-pill border border-line-strong bg-ivory px-5 text-base text-ink placeholder:text-ink-mute disabled:cursor-not-allowed"
            />
          </label>
          <button type="button" disabled className="tap inline-flex items-center justify-center rounded-pill bg-ink px-6 text-sm font-semibold text-paper opacity-60 disabled:cursor-not-allowed">
            Find my match
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-mute">The matcher arrives in the next build. The filters and comparison below work now.</p>
      </div>
    </section>
  );
}

export function FacetChips({ cat, active }: { cat: CategoryDefinition; active?: string }) {
  return (
    <nav aria-label="Narrow by" className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        <li className="shrink-0">
          <Link
            href={`/${cat.slug}`}
            aria-current={!active ? "page" : undefined}
            className={cn("tap inline-flex items-center rounded-pill border px-4 text-sm font-semibold", !active ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper hover:border-ink")}
          >
            All {cat.navLabel.toLowerCase()}
          </Link>
        </li>
        {cat.facets.map((f) => (
          <li key={f.slug} className="shrink-0">
            <Link
              href={`/${cat.slug}/${f.slug}`}
              aria-current={active === f.slug ? "page" : undefined}
              className={cn("tap inline-flex items-center rounded-pill border px-4 text-sm font-semibold", active === f.slug ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper hover:border-ink")}
            >
              {f.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function WinnersRow({ products, cat }: { products: RecommendedProduct[]; cat: CategoryDefinition }) {
  const winners = BADGES.map((b) => products.find((p) => p.badges[0] === b)).filter((p): p is RecommendedProduct => p !== undefined);
  if (winners.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Our picks</p>
          <h2 className="font-display mt-1 text-3xl">Where to start.</h2>
        </div>
        <Link href="/how-we-choose" className="tap hidden items-center text-sm font-semibold text-ember-deep hover:underline sm:inline-flex">
          How badges are decided
        </Link>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {winners.map((w) => (
          <MiniCard key={w.view.id} item={w} note={primaryStrength(w.view, cat)} />
        ))}
      </div>
    </section>
  );
}

export function RankingTransparency({ cat }: { cat: CategoryDefinition }) {
  const total = cat.scoring.criteria.reduce((s, c) => s + c.weight, 0);
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="rounded-card border border-line bg-paper p-6">
        <p className="eyebrow">How we rank {cat.name.toLowerCase()}</p>
        <div className="mt-3 grid gap-6 md:grid-cols-2">
          <div>
            <p className="text-sm text-ink-soft">Quality score weights. Higher weight, more influence. Missing values score zero.</p>
            <ul className="mt-3 divide-y divide-line">
              {cat.scoring.criteria.map((c) => {
                const def = attributeDef(cat, c.key);
                return (
                  <li key={c.key} className="flex items-center justify-between py-2 text-sm">
                    <span>{def?.label ?? c.key}</span>
                    <span className="tabular font-semibold">{Math.round((c.weight / total) * 100)}%</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="text-sm text-ink-soft">
            <p>
              <span className="font-semibold text-ink">{BADGE_LABELS.best_overall}</span> is the top quality score. <span className="font-semibold text-ink">{BADGE_LABELS.best_value}</span> blends quality ({Math.round(cat.value.qualityWeight * 100)}%) with affordability ({Math.round(cat.value.affordabilityWeight * 100)}%).{" "}
              <span className="font-semibold text-ink">{BADGE_LABELS.best_budget}</span> and <span className="font-semibold text-ink">{BADGE_LABELS.best_premium}</span> are the top scores under {cat.priceTiers[0].label.toLowerCase()} and in the {cat.priceTiers[cat.priceTiers.length - 1].label.toLowerCase()} tier, awarded only when at least {cat.badges.minQualifying} products qualify.
            </p>
            <p className="mt-3">Retailer relationships are not an input. Maker-reported numbers are labeled as such. Full rules on the How We Choose page.</p>
            <Link href="/how-we-choose" className="mt-3 inline-flex text-sm font-semibold text-ember-deep hover:underline">
              Read the full method
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
