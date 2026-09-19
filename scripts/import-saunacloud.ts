/** Publish SaunaCloud's four current public model configurations. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { productLink, programmeFor } from "@/domain/affiliate/programmes";

const TODAY = "2026-09-19";
const models = [
  { slug: "atlas", name: "Atlas Custom Infrared Sauna", url: "https://saunacloud.com/atlas/", image: "https://saunacloud.com/images/hero-sauna.webp", capacity: 4, label: "Custom, 1–4 person", placement: "indoor", description: "SaunaCloud's flagship custom indoor far-infrared sauna, designed to the buyer's room with VantaWave wall heaters, CORE 5 controls, solid Western Red Cedar and optional integrated red light." },
  { slug: "sierra", name: "Sierra Custom Infrared Sauna", url: "https://saunacloud.com/sierra/", image: "https://saunacloud.com/images/hero-sauna.webp", capacity: 2, label: "Custom, 1–2 person", placement: "indoor", description: "A compact custom indoor far-infrared sauna for smaller spaces, using SaunaCloud's VantaWave heaters, CORE 5 controls and solid Western Red Cedar." },
  { slug: "atlas-one", name: "Atlas One Red Light Infrared Sauna", url: "https://saunacloud.com/atlas-one/", image: "https://saunacloud.com/images/custom/sauna-cloud-hero-14.jpg", capacity: 4, label: "Custom, 1–4 person", placement: "indoor", description: "SaunaCloud's custom dual-therapy model combines VantaWave far-infrared heat with integrated 630 nm red and 850 nm near-infrared light as a standard feature." },
  { slug: "outdoor", name: "Outdoor Custom Infrared Sauna", url: "https://saunacloud.com/outdoor-infrared-saunas/", image: "https://saunacloud.com/images/outdoor-sauna-cloud-hero-5.webp", capacity: 4, label: "Custom, 1–4 person", placement: "outdoor", description: "A custom outdoor far-infrared sauna configured for the buyer's site and climate with weather-sealed construction, VantaWave heaters, CORE 5 controls and Western Red Cedar." },
] as const;
const programme = programmeFor("saunacloud");
if (!programme) throw new Error("SaunaCloud programme missing");
for (const model of models) {
  const id = `saunacloud-${model.slug}`;
  const tagged = productLink(programme, model.url);
  if (!tagged.ok) throw new Error(tagged.reason);
  const source = { kind: "manufacturer" as const, ref: `SaunaCloud official ${model.name} page`, url: model.url, retrievedAt: TODAY, method: "direct" as const, note: "SaunaCloud told Wellness Fit Check to use its public model and specification pages as the current configurations. Each sauna is custom designed and quote-only; dimensions, circuit requirements, room-air temperature and price vary by project and are not inferred." };
  const attribute = (value: unknown) => ({ value, source, verification: "manufacturer_reported" as const });
  const record = Product.parse({ id, slug: id, name: model.name, brandId: "saunacloud", categoryId: "saunas", description: model.description, status: "published", availability: "unknown", market: "US", images: [{ id: `${id}-image-1`, kind: "approved_creative", role: "primary", src: model.image, alt: model.name, source }], offers: [{ id: `${id}-offer`, merchantId: "saunacloud-store", market: "US", currency: "USD", quoteOnly: true, url: tagged.url, affiliate: { status: "affiliate", network: "direct", programRef: programme.programRef }, discountCodes: [], availability: "unknown", lastChecked: TODAY, source }], variants: [], identifiers: { gtin: [], merchantSkus: {} }, attributes: { sauna_type: attribute("far_infrared"), sauna_style: attribute("cabin"), placement: attribute(model.placement), capacity_label: attribute(model.label), capacity_max_people: attribute(model.capacity) }, sourceTitle: model.name, editorial: { strengths: [], tradeoffs: [] }, source, lastUpdated: TODAY, flags: { demo: false, newArrival: true } });
  writeFileSync(join(process.cwd(), "catalog/products", `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
}
console.log(`SaunaCloud: published ${models.length} current quote-only model configurations.`);
