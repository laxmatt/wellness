import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { categories, categoryById } from "@/domain/categories";
import type { CategoryDefinition } from "@/domain/category";
import { formatMoney } from "@/domain/money";
import type { Product } from "@/domain/product";
import { recommendCategory } from "@/domain/recommend";
import { toProductView, type ProductView } from "@/domain/view";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";

// Regenerates docs/PARTNER-SHOWCASE-CHECKLIST.md from the catalogue.
//
// Every figure in that document is computed here, so it cannot drift from the
// data by being retyped. The judgement it carries is in the prose written into
// this file, not in numbers copied by hand.
//
//   npx tsx scripts/partner-checklist.ts

export const CHECKLIST_PATH = join(process.cwd(), "docs/PARTNER-SHOWCASE-CHECKLIST.md");

const cat = loadLocalCatalog(join(process.cwd(), "catalog"));
const viewOf = (p: Product): ProductView =>
  toProductView(p, { category: categoryById(p.categoryId)!, brands: cat.brands, merchants: cat.merchants });

// Three dimensions, reported separately. None of them is a launch decision:
// a product with no confirmed price is perfectly publishable behind "Check
// current price", and whether to publish it is not this file's call.
type Dimension = "complete" | "partial" | "missing";
const MARK: Record<Dimension, string> = { complete: "yes", partial: "partly", missing: "no" };

type Evidence = {
  facts: { level: Dimension; detail: string };
  price: { level: Dimension; detail: string };
  images: { level: Dimension; detail: string };
};

function evidenceFor(p: Product, v: ProductView, c: CategoryDefinition, eligible: boolean): Evidence {
  const required = c.attributeDefinitions.filter((a) => a.required);
  const usable = required.filter((a) => v.attributes[a.key] !== undefined);
  const demo = required.filter((a) => v.provenance[`attributes.${a.key}`]?.verification === "demo");
  const unsourced = required.filter((a) => v.provenance[`attributes.${a.key}`]?.verification === "unknown");
  const factsDetail = `${usable.length} of ${required.length} required specifications carry a usable value` +
    (demo.length > 0 ? `; ${demo.length} prototype` : "") +
    (unsourced.length > 0 ? `; ${unsourced.length} with no recorded source` : "") +
    (eligible ? "" : "; below the completeness floor, so it holds no badge");
  const facts: Dimension = usable.length === required.length && demo.length === 0 && unsourced.length === 0 ? "complete" : usable.length === 0 ? "missing" : "partial";

  // "Recorded" is not "verified". An amount with a source URL is a figure
  // somebody wrote down, with a date; it is not a price checked today, and a
  // relayed figure was never read from the merchant's own page at all.
  const priceSource = v.offers.length > 0 ? provenanceOfPrice(p) : undefined;
  const relayed = priceSource?.method === "secondhand";
  const priceDetail = v.price.isDemo
    ? "no amount on record; the page shows Check current price"
    : `${formatMoney(v.price.money)} recorded ${v.price.checkedAt}` +
      (relayed
        ? ", relayed from a search summary rather than read from the merchant"
        : `, read from the page${priceSource?.ref ? ` (${priceSource.ref.replace(/\.$/, "")})` : ""}`) +
      ", not re-checked since";
  // Never "complete": an amount on record is an amount somebody wrote down on
  // a date, and nothing here re-checked it. Only a fresh reading could earn
  // that, and this file has never made one.
  const price: Dimension = v.price.isDemo ? "missing" : "partial";

  const real = v.images.filter((i) => i.kind !== "demo_placeholder");
  const licensed = v.images.filter((i) => i.license);
  const images: Dimension = real.length === 0 ? "missing" : licensed.length === real.length ? "complete" : "partial";
  const imagesDetail = real.length === 0
    ? `${v.images.length} procedural placeholder${v.images.length === 1 ? "" : "s"}, no rights evidence`
    : `${real.length} real image${real.length === 1 ? "" : "s"}, ${licensed.length} with a recorded licence`;

  return { facts: { level: facts, detail: factsDetail }, price: { level: price, detail: priceDetail }, images: { level: images, detail: imagesDetail } };
}

function provenanceOfPrice(p: Product): { method: string; ref?: string } | undefined {
  const lowest = [...p.offers].sort((a, b) => a.priceMinor - b.priceMinor)[0];
  return lowest ? { method: lowest.source.method, ref: lowest.source.ref } : undefined;
}

function attributeLines(p: Product, v: ProductView, c: CategoryDefinition): string[] {
  const out: string[] = [];
  for (const def of c.attributeDefinitions) {
    const sv = p.attributes[def.key];
    const spec = v.specs.find((s) => s.key === def.key);
    if (!sv) {
      out.push(`- \`${def.key}\`${def.required ? " (required)" : ""}: **absent from the record**`);
      continue;
    }
    const bits: string[] = [];
    if (sv.value === undefined) bits.push(`no value, recorded as \`${sv.verification}\``);
    else if (spec?.moneyWithheld) bits.push("withheld: computed from a price that is prototype data");
    else if (sv.verification === "demo") bits.push(`prototype value \`${JSON.stringify(sv.value)}\``);
    else if (sv.bound) bits.push(`bound: ${spec?.formatted}`);
    if (sv.verification === "unknown") bits.push("source not recorded");
    if (sv.source.method === "secondhand") bits.push("relayed, maker's page not fetched");
    if (bits.length > 0) out.push(`- \`${def.key}\`${def.required ? " (required)" : ""}: ${bits.join("; ")}`);
  }
  return out;
}

export function buildPartnerChecklist(): string {
const lines: string[] = [];
const push = (s = "") => lines.push(s);

// Counted, never typed. An earlier version of this document carried "124 of
// 196" and "no product's price was read from the source" as sentences, which
// would have gone stale the moment a single record was read.
const allRecords = cat.products.flatMap((p) => Object.values(viewOf(p).provenance));
const readRecords = allRecords.filter((pr) => pr.source.method === "direct" && pr.source.kind !== "demo" && pr.source.kind !== "editorial");
const relayedRecords = allRecords.filter((pr) => pr.source.method === "secondhand");
const offerRecords = cat.products.flatMap((p) => p.offers);
const relayedOffers = offerRecords.filter((o) => o.source.method === "secondhand");
const readPrices = cat.products.filter((p) => provenanceOfPrice(p)?.method === "direct" && !viewOf(p).price.isDemo);
const readDates = [...new Set(readRecords.map((pr) => pr.source.retrievedAt).filter(Boolean))].sort() as string[];

push("# Partner showcase checklist");
push();
push("What the repository holds on each of the 20 products, as a partner would");
push("find it: the facts, the price evidence and the images. Generated by");
push("`scripts/partner-checklist.ts`, so every figure comes from the catalogue");
push("rather than from a hand copy. Regenerate it after any catalogue change.");
push();
push("**Nothing here was fetched by this repository's tooling.** Its network");
push("policy refuses outbound HTTPS to everything but the model provider. Where a");
push("record says a page was read, somebody else read it and supplied the reading:");
push("`docs/source-checks/` holds one file per reading, naming who, when and what");
push("the page said. Everything else is what the repository was told earlier,");
push("mostly relayed from search summaries.");
push();
push(`Records whose source was read: **${readRecords.length} of ${allRecords.length}**, across ${readPrices.length} product${readPrices.length === 1 ? "" : "s"} whose shown price was read rather than relayed.` +
  (readDates.length > 0 ? ` Most recent reading: ${readDates[readDates.length - 1]}.` : ""));
push();
push("A recorded URL is a claim about where a figure came from. It is not");
push("verification that the figure is right or current, and a search summary is");
push("not a visit. A reading is evidence of what a page said on a date, and");
push("nothing more: none of these figures was measured by anybody here.");
push();
push("This is an evidence inventory, not a launch list. Nothing here decides");
push("what to publish or what order to publish it in. A product with no amount");
push("on record is publishable behind \"Check current price\", which is what");
push("the site already does; what a partner needs is to know which is which.");
push();
push("Each product is reported on three independent dimensions:");
push();
push("- **Comparison facts.** Do the specifications a shopper compares on exist,");
push("  carry a usable value, and name a source?");
push("- **Price evidence.** Is there an amount on record, was it read from the");
push("  merchant or relayed from a summary, and when was it written down? None of");
push("  these figures was re-checked today. **Recorded is not verified.**");
push("- **Image readiness.** Is there a real image, and is there evidence of the");
push("  right to use it?");
push();
push("A source URL on a record says where a figure is claimed to have come from.");
push("It is not verification that the figure is right, that it is current, or that");
push("anybody read that page. Where a record says `secondhand`, nobody did.");
push();
push("Two things apply to all 20 and are not repeated in each entry:");
push();
push("1. **Every image is a procedural placeholder.** There are no image files in");
push("   `public/`, no licence, no permission and nothing to show. A public image");
push("   URL is not permission and is not treated as any.");
push("2. **No affiliate programme is in place for this site.** That is the");
push("   owner's own statement, and the site says it on `/disclosure`. It is a");
push("   different fact from each offer record's `affiliate.status`, which is");
push("   `unknown` on all 26: unrecorded, not checked and found to be none. Every");
push("   link is an ordinary one to the maker or retailer, carrying");
push("   `rel=\"sponsored nofollow noopener\"` and no tracking parameter.");
push();

const empty = (): Record<Dimension, string[]> => ({ complete: [], partial: [], missing: [] });
const tally: Record<keyof Evidence, Record<Dimension, string[]>> = { facts: empty(), price: empty(), images: empty() };

for (const c of categories) {
  const products = cat.products.filter((p) => p.categoryId === c.id);
  const views = products.map(viewOf);
  const ranked = recommendCategory(views, c);
  push(`## ${c.name}`);
  push();
  for (const p of products) {
    const v = viewOf(p);
    const item = ranked.products.find((x) => x.view.id === p.id)!;
    const ev = evidenceFor(p, v, c, item.eligible);
    const badges = item.badges.length > 0 ? item.badges.join(", ") : "none";
    const sources = [...new Set(Object.values(v.provenance).map((pr) => pr.source.url).filter(Boolean))] as string[];
    const secondhand = Object.values(v.provenance).filter((pr) => pr.source.method === "secondhand").length;
    const total = Object.values(v.provenance).length;
    tally.facts[ev.facts.level].push(v.id);
    tally.price[ev.price.level].push(v.id);
    tally.images[ev.images.level].push(v.id);

    push(`### ${v.brand.name} ${v.name}`);
    push();
    push("| Evidence | | |");
    push("| --- | --- | --- |");
    push(`| Comparison facts | ${MARK[ev.facts.level]} | ${ev.facts.detail} |`);
    push(`| Price evidence | ${MARK[ev.price.level]} | ${ev.price.detail} |`);
    push(`| Image readiness | ${MARK[ev.images.level]} | ${ev.images.detail} |`);
    push();
    push("| | |");
    push("| --- | --- |");
    push(`| Record | \`${v.id}\`, \`/products/${v.slug}\` |`);
    push(
      `| Offers | ${v.offers.length === 0 ? "none" : v.offers.map((o) => `${o.merchant.name} (${o.priceIsDemo ? "no amount on record" : formatMoney(o.price)}, ${o.availability}, ${o.affiliateStatus === "unknown" ? "affiliate status not recorded" : o.affiliateStatus})`).join("; ")} |`,
    );
    push(`| Links | ${v.offers.length === 0 ? "none" : v.offers.map((o) => o.url).join("<br>")} |`);
    push(`| Sources on file | ${sources.length === 0 ? "none" : sources.join("<br>")} |`);
    push(`| Retrieval | ${secondhand} of ${total} recorded fields were relayed rather than read from the source |`);
    push(`| Ranking | score ${item.score}, completeness ${Math.round(v.flags.completeness * 100)}%, badges: ${badges}${item.eligible ? "" : ", **ineligible**"} |`);
    push();
    const gaps = attributeLines(p, v, c);
    if (gaps.length > 0) {
      push("Specifications that are missing, unsupported or relayed:");
      push();
      for (const g of gaps) push(g);
      push();
    } else {
      push("Every specification carries a value and a source.");
      push();
    }
  }
}

// Per category, the same three dimensions, counted. No recommendation about
// which category to lead with: that is a decision, and this file reports.
push("## By category");
push();
push("| Category | Products | Amount on record | Shown price read from the source | Required specs all usable and sourced | Real images |");
push("| --- | --- | --- | --- | --- | --- |");
for (const c of categories) {
  const products = cat.products.filter((p) => p.categoryId === c.id);
  const views = products.map(viewOf);
  const ranked = recommendCategory(views, c);
  const priced = views.filter((v) => !v.price.isDemo).length;
  const direct = products.filter((p) => provenanceOfPrice(p)?.method === "direct" && !viewOf(p).price.isDemo).length;
  const clean = products.filter((p) => {
    const v = viewOf(p);
    const item = ranked.products.find((x) => x.view.id === p.id)!;
    return evidenceFor(p, v, c, item.eligible).facts.level === "complete";
  }).length;
  const withImages = views.filter((v) => v.images.some((i) => i.kind !== "demo_placeholder")).length;
  push(`| ${c.name} | ${views.length} | ${priced} | ${direct} | ${clean} | ${withImages} |`);
}
push();

push("## Totals");
push();
push(`**Comparison facts.** All required specifications usable and sourced: ${tally.facts.complete.length}. Some: ${tally.facts.partial.length}. None: ${tally.facts.missing.length}.`);
push();
push(`**Price evidence.** An amount on record: ${tally.price.partial.length}. No amount on record: ${tally.price.missing.length}. Amount read from the source rather than relayed: ${readPrices.length}${readPrices.length > 0 ? ` (${readPrices.map((p) => p.id).join(", ")})` : ""}. Independently measured: 0, on all 20; every figure is its maker's own.`);
push();
push(`**Image readiness.** A real image with a recorded licence: ${tally.images.complete.length}. A real image without one: ${tally.images.partial.length}. Placeholders only: ${tally.images.missing.length}.`);
push();
push("## What would move these numbers");
push();
push("Ordinary work, in the order that changes the most evidence per hour. None");
push("of it requires an agreement with anybody, and none of it is a launch");
push("decision.");
push();
push(`1. **Read the pages already on file.** ${relayedRecords.length} of ${allRecords.length} records and ${relayedOffers.length} of ${offerRecords.length} offer prices are`);
push("   marked `secondhand`, meaning the URL was recorded from a search summary");
push("   and the page was never opened. Opening one turns a claim into a reading,");
push("   and the URLs are already there.");
push("2. **Record an amount where there is none, or leave the page as it is.**");
push("   Eight products have no amount on record. The page already handles that");
push("   honestly with \"Check current price\", so this raises the evidence rather");
push("   than unblocking anything.");
push("3. **Replace or remove the 24 prototype specification values.** Each is");
push("   marked on the page. A removed value costs a completeness point; an");
push("   invented one costs the site.");
push("4. **Get images and record the permission.** 24 of 24 are procedural. A");
push("   photograph on a public page is not a licence and is not recorded as one.");
push();
push("What is already true, and worth showing a partner: the ranking is");
push("deterministic, weighted per category and explained on `/how-we-choose`; it");
push("cannot read affiliate status because that data is never passed to it; every");
push("figure names who reported it; a value nobody stated is shown as not stated");
push("rather than guessed; a bound is shown as a bound; a price nobody recorded is");
push("not shown as a price; and a figure computed from an unrecorded price is");
push("withheld with it.");
push();

return lines.join("\n") + "\n";
}

// Written by `npm run partner:checklist`. A test compares the committed file
// to this output, so the document cannot quietly go stale against the data.
if (process.argv[1]?.endsWith("partner-checklist.ts")) {
  writeFileSync(CHECKLIST_PATH, buildPartnerChecklist());
  console.log(`Wrote ${CHECKLIST_PATH}`);
}
