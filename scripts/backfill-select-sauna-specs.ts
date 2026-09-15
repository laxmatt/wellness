/** Replays approved Select Saunas description rules over the committed feed records. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Product } from "@/domain/product";
import { extractSaunaDescription } from "@/domain/ingestion/sauna-description";

const root = join(process.cwd(), "catalog", "products");
const files = readdirSync(root).filter((name) => name.startsWith("select-saunas-") && name.endsWith(".json")).sort();
const counts: Record<string, number> = {};
let changed = 0;

for (const file of files) {
  const path = join(root, file);
  const product = Product.parse(JSON.parse(readFileSync(path, "utf8")));
  const extracted = extractSaunaDescription(product.description);
  const attributes = { ...product.attributes };
  for (const [key, attribute] of Object.entries(attributes)) {
    if (attribute.derivation?.field === "body_text" && attribute.derivation.version === 5) delete attributes[key];
  }
  for (const fact of extracted) {
    const source = {
      ...product.source,
      method: "secondhand" as const,
      ref: product.source.ref?.replace(/Mapping profile select-saunas-shopify v\d+\./, "Mapping profile select-saunas-shopify v5."),
      note: `Extracted from the structured specification text preserved in the Select Saunas feed description. Matched ${JSON.stringify(fact.matched)}. This is a retailer-relayed manufacturer claim, not independent verification.`,
    };
    attributes[fact.key] = {
      value: fact.value,
      source,
      verification: "manufacturer_reported",
      derivation: { rule: fact.pattern, version: 5, field: "body_text", sourceText: product.description, matched: fact.matched, confidence: "within_text", reviewState: "approved", approvedBy: "Matt (site owner)" },
    };
    counts[fact.key] = (counts[fact.key] ?? 0) + 1;
  }
  if (JSON.stringify(attributes) === JSON.stringify(product.attributes)) continue;
  const updated = Product.parse({ ...product, attributes, lastUpdated: "2026-09-15" });
  const serialized = `${JSON.stringify(updated, null, 2)}\n`;
  if (serialized !== readFileSync(path, "utf8")) {
    writeFileSync(path, serialized, "utf8");
    changed += 1;
  }
}

console.log(JSON.stringify({ scanned: files.length, changed, populated: counts }, null, 2));
