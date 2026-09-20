import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { extractSaunaEnvironment } from "@/domain/ingestion/sauna-environment";

const directory = join(process.cwd(), "catalog/products");
const counts = { saunas: 0, maxTemperature: 0, insulated: 0, weatherReady: 0 };
for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
  const path = join(directory, file);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.categoryId !== "saunas") continue;
  counts.saunas += 1;
  delete raw.attributes.max_temperature_f;
  delete raw.attributes.enclosure_protection;
  const facts = extractSaunaEnvironment(raw.description ?? "");
  for (const fact of facts) {
    const source = {
      ...raw.source,
      note: `Explicit product-page evidence: “${fact.matched}”. Supplier or seller claim; not independently verified.`,
    };
    raw.attributes[fact.key] = { value: fact.value, source, verification: "manufacturer_reported" };
    if (fact.key === "max_temperature_f") counts.maxTemperature += 1;
    if (fact.key === "enclosure_protection" && String(fact.value).includes("insulated")) counts.insulated += 1;
    if (fact.key === "enclosure_protection" && String(fact.value).includes("weather_ready")) counts.weatherReady += 1;
  }
  Product.parse(raw);
  if (facts.length) writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}
console.log(counts);
