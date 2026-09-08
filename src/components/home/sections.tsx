import Link from "next/link";
import { buttonStyles } from "@/components/ui/Button";
import { DemoArt } from "@/components/ui/DemoArt";
import type { Brand } from "@/domain/product";
import { BADGE_LABELS } from "@/domain/recommend";
import type { CategoryPage } from "@/lib/queries";

export function Hero({ pages }: { pages: CategoryPage[] }) {
  const total = pages.reduce((n, p) => n + p.products.length, 0);
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 pb-10 pt-8 sm:px-6 lg:grid-cols-12 lg:items-end lg:gap-12 lg:px-8 lg:pb-16 lg:pt-14">
        <div className="lg:col-span-5">
          <p className="eyebrow">Red light · Cold plunge · Wellness drinks</p>
          <h1 className="font-display mt-3 text-5xl leading-[0.95] sm:text-6xl lg:text-7xl">The specs, side by side.</h1>
          <p className="mt-5 max-w-md text-lg text-fg-soft">
            {total} products across three categories, compared on maker-stated facts with every source shown. Pick a category, narrow by what matters, choose with confidence.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/red-light" className={buttonStyles("primary", "lg")}>
              Shop red light
            </Link>
            <Link href="/explore" className={buttonStyles("secondary", "lg")}>
              Explore all
            </Link>
          </div>
        </div>
        <div className="lg:col-span-7">
          <div className="relative overflow-hidden rounded-card shadow-float">
            <div className="aspect-[4/3] sm:aspect-[16/10]">
              <DemoArt seed="red-light-hero-scene" variant="scene" label="Warm living room with a red light panel, demo image" className="absolute inset-0 h-full w-full" />
            </div>
            <div className="absolute bottom-4 left-4 rounded-card bg-surface-raised/90 px-4 py-3 backdrop-blur">
              <p className="eyebrow">This week</p>
              <p className="font-display text-lg">Full-body panels under $1,000</p>
              <Link href="/red-light/under-1000" className="text-sm font-semibold text-accent-strong hover:underline">
                See the picks
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CategoryTiles({ pages }: { pages: CategoryPage[] }) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="grid gap-4 md:grid-cols-3">
        {pages.map((p) => {
          const overall = p.products.find((x) => x.badges.includes("best_overall"));
          return (
            <Link key={p.cat.id} href={`/${p.cat.slug}`} className="lift group relative overflow-hidden rounded-card shadow-card hover:-translate-y-0.5 hover:shadow-float">
              <div className="aspect-[4/5] md:aspect-[3/4]">
                <DemoArt seed={`${p.cat.id}-tile`} variant="scene" label={p.cat.images[0]?.alt ?? p.cat.name} showLabel={false} className="absolute inset-0 h-full w-full" />
              </div>
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-fg/70 via-fg/20 to-transparent p-5 text-fg-inverse">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-inverse/80">{p.products.length} products</p>
                <h3 className="font-display mt-1 text-3xl leading-none">{p.cat.name}</h3>
                {overall ? (
                  <p className="mt-2 text-sm text-fg-inverse/90">
                    {BADGE_LABELS.best_overall}: {overall.view.brand.name} {overall.view.name}
                  </p>
                ) : null}
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold underline-offset-4 group-hover:underline">Shop {p.cat.navLabel}</span>
              </div>
              <span className="absolute right-3 top-3 rounded-pill bg-surface-raised/85 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-accent-strong">Demo image</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, href, linkLabel }: { eyebrow: string; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="font-display mt-1 text-3xl sm:text-4xl">{title}</h2>
      </div>
      {href ? (
        <Link href={href} className="tap hidden items-center text-sm font-semibold text-accent-strong hover:underline sm:inline-flex">
          {linkLabel ?? "See all"}
        </Link>
      ) : null}
    </div>
  );
}

export function DiscoveryModules({ pages }: { pages: CategoryPage[] }) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <SectionHeading eyebrow="Start from a need" title="Narrow it fast." />
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {pages.map((p) => (
          <div key={p.cat.id} className="rounded-card border border-edge bg-surface-raised p-5">
            <p className="eyebrow">{p.cat.navLabel}</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {p.cat.facets.map((f) => (
                <li key={f.slug}>
                  <Link href={`/${p.cat.slug}/${f.slug}`} className="tap inline-flex items-center rounded-pill border border-edge-strong bg-surface-raised px-3.5 text-sm font-medium hover:border-fg">
                    {f.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BrandStrip({ brands }: { brands: Brand[] }) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <SectionHeading eyebrow="Brands" title="Who we track." href="/brands" />
      <ul className="mt-6 flex flex-wrap gap-2">
        {brands.map((b) => (
          <li key={b.id}>
            <Link href={`/brands/${b.slug}`} className="tap inline-flex items-center rounded-pill bg-surface-raised px-4 text-sm font-semibold shadow-card hover:bg-surface-sunken">
              {b.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function HowWeChooseCallout() {
  const points = [
    ["Published rules", "Every badge follows a rule you can read. Weights are listed per category."],
    ["Sources on every spec", "Maker-reported numbers are labeled. Nothing here is presented as independently tested unless it was."],
    ["Retailers never buy rank", "Affiliate status is not an input to scoring. A test enforces it."],
  ];
  return (
    <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="rounded-card bg-fg p-6 text-fg-inverse sm:p-10">
        <div className="grid gap-8 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-fg-inverse/60">How we choose</p>
            <h2 className="font-display mt-2 text-3xl sm:text-4xl">Opinionated where the facts allow it. Neutral everywhere else.</h2>
            <Link href="/how-we-choose" className="tap mt-5 inline-flex items-center rounded-pill bg-surface-raised px-5 text-sm font-semibold text-fg hover:bg-surface-sunken">
              Read the rules
            </Link>
          </div>
          <dl className="grid gap-6 sm:grid-cols-3 lg:col-span-8">
            {points.map(([t, d]) => (
              <div key={t}>
                <dt className="font-semibold">{t}</dt>
                <dd className="mt-1 text-sm text-fg-inverse/75">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
