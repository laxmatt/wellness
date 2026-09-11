import type { Metadata } from "next";
import { Breadcrumbs, Container, Shell } from "@/components/site/Shell";
import { VerificationTag } from "@/components/ui/VerificationTag";
import { categories } from "@/domain/categories";
import { attributeDef } from "@/domain/category";
import { BADGE_LABELS } from "@/domain/recommend";
import { social } from "@/lib/metadata";

const description = "The rules behind every badge, score and label on this site.";
export const metadata: Metadata = {
  title: "How We Choose",
  description,
  alternates: { canonical: "/how-we-choose" },
  ...social({ title: "How We Choose", description, path: "/how-we-choose" }),
};

export default function HowWeChoosePage() {
  return (
    <Shell current="/how-we-choose">
      <Container className="pt-4">
        <Breadcrumbs items={[{ href: "/", label: "Home" }, { label: "How We Choose" }]} />
        <div className="mt-6 max-w-3xl">
          <p className="eyebrow">How we choose</p>
          <h1 className="font-display mt-2 text-5xl leading-none">Rules you can read. Numbers you can check.</h1>
          <p className="mt-4 text-lg text-fg-soft">Every badge on this site comes from a rule on this page. Every spec carries its source. Nothing ranks higher because a retailer pays us.</p>
        </div>

        <section className="mt-12 grid gap-4 md:grid-cols-2">
          <Card title="Product facts, interpretation, and you">
            <p>We keep three layers apart. Product facts come from makers and retailers and carry a source. Interpretation is what our rules say about those facts. Personal matches, when you use the matcher, stay in your browser and never change the facts.</p>
          </Card>
          <Card title="What the labels mean">
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-2"><VerificationTag verification="manufacturer_reported" /> The maker published this figure, on its own page. We did not measure it.</li>
              <li className="flex items-center gap-2">
                <VerificationTag verification="manufacturer_reported" source={{ kind: "retailer", method: "secondhand" }} /> The maker&apos;s figure, reaching us through a
                retailer&apos;s listing rather than the maker&apos;s own page. Still the maker&apos;s claim, and still not measured here.
              </li>
              <li className="flex items-center gap-2"><VerificationTag verification="independently_verified" /> Measured by an independent test we cite. None yet in this prototype.</li>
              <li className="flex items-center gap-2"><VerificationTag verification="demo" /> Placeholder value in the prototype. Not a real measurement.</li>
              <li className="flex items-center gap-2"><VerificationTag verification="not_stated" /> The source was read and does not state this. We do not fill the gap with a number.</li>
              <li className="flex items-center gap-2"><VerificationTag verification="unknown" /> Source did not state who measured it.</li>
            </ul>
          </Card>
          <Card title="Badges">
            <ul className="flex flex-col gap-2">
              <li><strong>{BADGE_LABELS.best_overall}.</strong> Highest quality score in the category.</li>
              <li><strong>{BADGE_LABELS.best_value}.</strong> Highest blend of quality and affordability. Weights per category are below. When the same product wins both, the card shows Best Overall and notes the value win.</li>
              <li><strong>{BADGE_LABELS.best_budget}.</strong> Highest score at or under the category budget line. Awarded only when at least two products qualify.</li>
              <li><strong>{BADGE_LABELS.best_premium}.</strong> Highest score at or above the premium line. Same two-product rule.</li>
            </ul>
          </Card>
          <Card title="What never counts">
            <ul className="flex flex-col gap-2">
              <li>Whether a retailer pays us. Affiliate status is not an input to scoring. A test in our code flips every relationship and checks the ranking does not move.</li>
              <li>Medical outcomes. We compare products by stated attributes and price. We do not claim any product treats, cures or prevents a condition, and the matcher declines those questions.</li>
              <li>Experience we have not had. No claim about how a product feels, sounds or performs appears without a cited source.</li>
            </ul>
          </Card>
        </section>

        <section className="mt-14">
          <h2 className="font-display text-3xl">Weights by category</h2>
          <p className="mt-1 text-sm text-fg-soft">Quality score criteria and their share of the score. Values are normalized within the category. Missing values score zero. Products missing too many required specs are not badge-eligible.</p>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {categories.map((cat) => {
              const total = cat.scoring.criteria.reduce((s, c) => s + c.weight, 0);
              return (
                <div key={cat.id} className="rounded-card border border-edge bg-surface-raised p-5">
                  <p className="eyebrow">{cat.name}</p>
                  <ul className="mt-3 divide-y divide-edge">
                    {cat.scoring.criteria.map((c) => {
                      const def = attributeDef(cat, c.key);
                      return (
                        <li key={c.key} className="flex items-center justify-between py-2 text-sm">
                          <span>
                            {def?.label ?? c.key}
                            {def?.scoreCap !== undefined ? <span className="text-fg-muted"> (capped at {def.scoreCap})</span> : null}
                          </span>
                          <span className="tabular font-semibold">{Math.round((c.weight / total) * 100)}%</span>
                        </li>
                      );
                    })}
                  </ul>
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-fg-soft">
                    <dt>Value blend</dt>
                    <dd className="tabular text-right">{Math.round(cat.value.qualityWeight * 100)}% quality, {Math.round(cat.value.affordabilityWeight * 100)}% affordability</dd>
                    <dt>Budget line</dt>
                    <dd className="text-right">{cat.priceTiers[0].label}</dd>
                    <dt>Premium line</dt>
                    <dd className="text-right">{cat.priceTiers[cat.priceTiers.length - 1].label}</dd>
                    <dt>Completeness floor</dt>
                    <dd className="tabular text-right">{Math.round(cat.scoring.completenessFloor * 100)}% of required specs</dd>
                  </dl>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-14 max-w-3xl">
          <h2 className="font-display text-3xl">Prototype status</h2>
          <p className="mt-3 text-fg-soft">Every product here is demo data. Maker figures were relayed from public search summaries and carry a &ldquo;relayed, not fetched&rdquo; mark until we verify them against the source page. Prices show the date checked. Rankings are provisional until pricing is verified.</p>
        </section>
      </Container>
    </Shell>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-edge bg-surface-raised p-5 text-sm text-fg-soft">
      <h2 className="font-display text-xl text-fg">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
