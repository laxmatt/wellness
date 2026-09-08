import { ProductCard } from "@/components/product/ProductCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { VerificationTag } from "@/components/ui/VerificationTag";
import { primaryStrength, primaryTradeoff, recommendCategory } from "@/domain/recommend";
import { getCatalog } from "@/providers";

// Phase 1 smoke route. Proves tokens, primitives and the catalog pipeline
// render. Replaced by the storefront homepage in Phase 2.
export default async function SmokePage() {
  const catalog = getCatalog();
  const categories = await catalog.listCategories();
  const sections = await Promise.all(
    categories.map(async (cat) => {
      const views = await catalog.listProductViews({ categoryId: cat.id, status: ["published"] });
      return { cat, rec: recommendCategory(views, cat) };
    }),
  );

  const swatches = [
    ["ivory", "bg-ivory"], ["ivory-deep", "bg-ivory-deep"], ["paper", "bg-paper"], ["ink", "bg-ink"], ["ink-soft", "bg-ink-soft"],
    ["ink-mute", "bg-ink-mute"], ["line", "bg-line"], ["ember", "bg-ember"], ["ember-soft", "bg-ember-soft"], ["tide", "bg-tide"],
    ["tide-soft", "bg-tide-soft"], ["moss", "bg-moss"], ["honey", "bg-honey"], ["plum", "bg-plum"],
  ];

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="eyebrow">Phase 1 smoke test</p>
      <h1 className="font-display mt-2 text-5xl leading-none sm:text-6xl">Warm tech, on the page.</h1>
      <p className="mt-4 max-w-xl text-lg text-ink-soft">
        Tokens, type, badges, verification tags and product cards per category, rendered from the catalog through the recommendation engine.
      </p>

      <section className="mt-12">
        <h2 className="eyebrow">Color</h2>
        <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-7">
          {swatches.map(([name, cls]) => (
            <div key={name} className="flex flex-col gap-1.5">
              <div className={`h-14 rounded-xl border border-line ${cls}`} />
              <span className="text-xs text-ink-mute">{name}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 flex flex-wrap items-center gap-3">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Chip>Under $500</Chip>
        <Chip selected>Full body</Chip>
        <Badge kind="best_overall" />
        <Badge kind="best_value" />
        <Badge kind="best_budget" />
        <Badge kind="best_premium" />
        <Badge kind="best_match" />
        <VerificationTag verification="manufacturer_reported" />
        <VerificationTag verification="independently_verified" />
        <VerificationTag verification="demo" />
        <VerificationTag verification="unknown" />
      </section>

      {sections.map(({ cat, rec }) => (
        <section key={cat.id} className="mt-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">{cat.navLabel}</p>
              <h2 className="font-display mt-1 text-3xl">{cat.tagline}</h2>
            </div>
            <p className="text-sm text-ink-mute">
              {rec.products.length} products · {rec.set.badges.length} badges
            </p>
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {rec.products.slice(0, 4).map((item) => (
              <ProductCard key={item.view.id} item={item} strength={primaryStrength(item.view, cat)} tradeoff={primaryTradeoff(item.view, cat)} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
