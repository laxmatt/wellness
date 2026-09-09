import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPartnerChecklist, CHECKLIST_PATH } from "../../scripts/partner-checklist";
import { categories, categoryById } from "@/domain/categories";
import { formatMoney } from "@/domain/money";
import { toProductView } from "@/domain/view";
import { catalog } from "./fixtures";

// The checklist is what a partner conversation would be run from, so a stale
// one is worse than none: it would describe a catalogue that has moved.

const committed = () => readFileSync(CHECKLIST_PATH, "utf8");

describe("the partner showcase checklist", () => {
  it("is the document the catalogue produces right now", () => {
    expect(committed()).toBe(buildPartnerChecklist());
  });

  it("names every product", () => {
    const doc = committed();
    for (const p of catalog().products) expect(doc, p.id).toContain(`\`${p.id}\``);
  });

  it("quotes no amount for a product whose price is prototype data", () => {
    const doc = committed();
    for (const c of categories) {
      for (const p of catalog().products.filter((x) => x.categoryId === c.id)) {
        const view = toProductView(p, { category: categoryById(c.id)!, brands: catalog().brands, merchants: catalog().merchants });
        if (!view.price.isDemo) continue;
        const entry = doc.slice(doc.indexOf(`\`${p.id}\``), doc.indexOf(`\`${p.id}\``) + 1200);
        expect(entry, p.id).not.toContain(formatMoney(view.price.money));
        expect(entry, p.id).toContain("no confirmed price");
      }
    }
  });

  it("holds back every product without a confirmed price", () => {
    const doc = committed();
    const hold = doc.slice(doc.indexOf("**Hold it back:"));
    for (const c of categories) {
      for (const p of catalog().products.filter((x) => x.categoryId === c.id)) {
        const view = toProductView(p, { category: categoryById(c.id)!, brands: catalog().brands, merchants: catalog().merchants });
        if (view.price.isDemo) expect(hold, p.id).toContain(view.name);
      }
    }
  });

  it("says no source was fetched to produce it", () => {
    expect(committed()).toContain("No manufacturer page was fetched");
  });
});
