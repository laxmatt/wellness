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

  it("quotes no amount for a product with none on record", () => {
    const doc = committed();
    for (const c of categories) {
      for (const p of catalog().products.filter((x) => x.categoryId === c.id)) {
        const view = toProductView(p, { category: categoryById(c.id)!, brands: catalog().brands, merchants: catalog().merchants });
        if (!view.price.isDemo) continue;
        const at = doc.indexOf(`\`${p.id}\``);
        const entry = doc.slice(Math.max(0, at - 1200), at + 1200);
        expect(entry, p.id).not.toContain(formatMoney(view.price.money));
        expect(entry, p.id).toContain("no amount on record");
      }
    }
  });

  it("reports evidence rather than deciding what to launch", () => {
    const doc = committed();
    // The earlier version sorted products into "show it" and "hold it back",
    // which made an amount on record a prerequisite for publishing. It is not:
    // the page says "Check current price" and the product is publishable
    // behind it.
    expect(doc).not.toMatch(/Hold it back|Show it, with the gaps/);
    expect(doc).toContain("This is an evidence inventory, not a launch list");
    expect(doc).toContain("Comparison facts");
    expect(doc).toContain("Price evidence");
    expect(doc).toContain("Image readiness");
  });

  it("never calls a recorded price a verified one", () => {
    const doc = committed();
    expect(doc).toContain("Recorded is not verified");
    expect(doc).toMatch(/Verified today: 0/);
    expect(doc).not.toMatch(/confirmed price|verified price/i);
  });

  it("separates the site having no programme from an offer record saying so", () => {
    const doc = committed();
    expect(doc).toContain("affiliate status not recorded");
    expect(doc).toContain("unrecorded, not checked and found to be none");
  });

  it("says no source was fetched to produce it", () => {
    expect(committed()).toContain("No manufacturer page was fetched");
  });
});
