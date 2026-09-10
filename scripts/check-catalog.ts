import { join } from "node:path";
import { categoryById } from "@/domain/categories";
import { formatMoney } from "@/domain/money";
import { recommendCategory } from "@/domain/recommend";
import { toProductView } from "@/domain/view";
import { loadLocalCatalog } from "@/providers/catalog/LocalCatalogProvider";

// Loads and validates the catalog, then prints the ranking and badges per
// category. Run after editing any JSON under catalog/.
const cat = loadLocalCatalog(join(process.cwd(), "catalog"));
console.log(`Catalog OK: ${cat.products.length} products, ${cat.brands.length} brands, ${cat.merchants.length} merchants\n`);

for (const c of cat.categories) {
  const views = cat.products
    .filter((p) => p.categoryId === c.id)
    .map((p) => toProductView(p, { category: categoryById(p.categoryId)!, brands: cat.brands, merchants: cat.merchants }));
  const { products, set } = recommendCategory(views, c);
  console.log(`== ${c.name} (${products.length})`);
  for (const p of products) {
    const badges = p.badges.join("+") || "";
    const demoCount = Object.values(p.view.provenance).filter((x) => x.verification === "demo").length;
    console.log(
      `  ${badges.padEnd(24)} ${String(p.score).padStart(5)} ${(p.view.price.money ? formatMoney(p.view.price.money) : "no price").padStart(10)}  ${p.view.brand.name} ${p.view.name}` +
        (p.eligible ? "" : "  [ineligible]") +
        (demoCount ? `  [${demoCount} demo fields]` : ""),
    );
  }
  for (const b of set.badges) console.log(`    ${b.badge} -> ${b.productId}: ${b.reason}`);
  console.log();
}
