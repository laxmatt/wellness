/**
 * Three partners that publish their own Shopify catalogue, read into drafts.
 *
 * None of these stores is reachable from the machine this was written on: the
 * environment's network policy answers CONNECT to all three with 403. So every
 * assertion here runs against fixtures shaped exactly like a Shopify
 * `/products.json`, and not one number in this file is presented as a count of
 * a real partner's inventory. What is proved is the machinery: that a snapshot
 * becomes rows, that a store's own product types separate saunas from heaters
 * and stones and red-light panels, that variants group into models, that the
 * same product in two stores is recognised without being merged on a guess,
 * and that a partner going down costs a refresh rather than the inventory.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { saunas } from "@/domain/categories/saunas";
import { canonicalGroups, canonicalRecordOf, mergeCanonical, normalise, reviewCanonical, type CanonicalRecord } from "@/domain/canonical/match";
import { adapterFor } from "@/domain/ingestion/adapter";
import { buildCandidates } from "@/domain/ingestion/build";
import { applyEditorialEdit } from "@/domain/ingestion/editorial";
import { MappingProfile } from "@/domain/ingestion/profile";
import { bodyText, readSnapshot, shopifyAdapter, tableFromSnapshot, SHOPIFY_COLUMNS } from "@/domain/ingestion/shopify";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { runIngestionImport } from "@/providers/ingestion/import";
import { HOOGA, SELECT_SAUNAS, TOPTURE, BLOCKED_PARTNERS, shopifyProfile } from "../../scripts/shopify-partners";

const CATALOG = join(process.cwd(), "catalog");
const FIXTURES = join(process.cwd(), "src/__tests__/fixtures/shopify");
const TODAY = "2026-09-15";
const snapshotText = (id: string) => readFileSync(join(FIXTURES, `${id}.json`), "utf8");

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A workspace with all three sources and their profiles approved, as an administrator would leave it. */
function workspace(): IngestionStore {
  const dir = mkdtempSync(join(tmpdir(), "shopify-"));
  temps.push(dir);
  const store = new IngestionStore(dir);
  for (const source of [TOPTURE, SELECT_SAUNAS, HOOGA]) {
    store.saveSource(source);
    const profile = shopifyProfile(source, TODAY, source.merchantName);
    // An administrator reads the counts and approves the rules, which is the
    // step the seeded profile deliberately leaves undone.
    store.saveProfile(MappingProfile.parse({
      ...profile,
      columns: profile.columns.map((c) => (c.extract ? { ...c, extract: { ...c.extract, approved: true, approvedBy: "a reviewer" } } : c)),
      attributes: profile.attributes.map((a) => (a.from === "extract" ? { ...a, approved: true, approvedBy: "a reviewer" } : a)),
    }));
    store.approveProfile(source.id, 1, "a reviewer", TODAY);
  }
  return store;
}

const importInto = (store: IngestionStore, sourceId: string, text = snapshotText(sourceId), today = TODAY) =>
  runIngestionImport({ store, catalogDir: CATALOG, sourceId, version: 1, fileName: `${sourceId}.json`, text, today });

// ---------------------------------------------------------------- the adapter

describe("a Shopify catalogue, read as rows", () => {
  it("is the format the flow now offers, beside the CSV one", () => {
    const json = adapterFor("json");
    expect(json.ok).toBe(true);
    if (json.ok) expect(json.adapter.label).toContain("Shopify");
  });

  it("makes one row per variant, with the store's own fields on it", () => {
    const snapshot = readSnapshot(snapshotText("topture-shopify"));
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const table = tableFromSnapshot(snapshot.snapshot);
    expect(table.columns).toEqual([...SHOPIFY_COLUMNS]);
    // Six products, one with no handle and so no row, seven variants between them.
    expect(snapshot.snapshot.productCount).toBe(6);
    expect(table.rows).toHaveLength(6);
    const luna = table.rows.filter((r) => r.product_handle === "dundalk-luna-4-person");
    expect(luna).toHaveLength(2);
    expect(luna[0].product_url).toBe("https://topture.com/products/dundalk-luna-4-person");
    expect(luna[0].variant_url).toBe("https://topture.com/products/dundalk-luna-4-person?variant=1011");
    expect(luna.map((r) => r.price).sort()).toEqual(["10995.00", "8995.00"]);
    expect(luna[0].vendor).toBe("Dundalk LeisureCraft");
    expect(luna[0].product_updated_at).toBe("2026-09-10T00:00:00Z");
  });

  it("counts what it could not turn into a row rather than dropping it silently", () => {
    const snapshot = readSnapshot(snapshotText("topture-shopify"));
    if (!snapshot.ok) return;
    expect(tableFromSnapshot(snapshot.snapshot).notes.join(" ")).toContain("carry no handle or no variant");
  });

  it("refuses anything that is not a catalogue, by name", () => {
    expect(shopifyAdapter.read("not json", 8)).toMatchObject({ ok: false });
    const noProducts = shopifyAdapter.read(JSON.stringify({ storeUrl: "https://x.test" }), 40);
    expect(noProducts.ok).toBe(false);
    if (!noProducts.ok) expect(noProducts.reason).toContain("products");
    const noStore = shopifyAdapter.read(JSON.stringify({ products: [] }), 20);
    expect(noStore.ok).toBe(false);
    if (!noStore.ok) expect(noStore.reason).toContain("which store it came from");
  });

  it("keeps a description as text and reads nothing out of it", () => {
    expect(bodyText('<p>A <b>sauna</b>&nbsp;for four.</p><script>x()</script>')).toBe("A sauna for four.");
  });

  it("carries no credential in anything it records", () => {
    for (const id of ["topture-shopify", "select-saunas-shopify", "hooga-shopify"]) {
      const snapshot = readSnapshot(snapshotText(id));
      if (!snapshot.ok) return;
      for (const url of snapshot.snapshot.requested) {
        expect(url, url).not.toMatch(/key|token|secret|password|auth/i);
      }
    }
  });
});

// ------------------------------------------------------------- what is a sauna

describe("separating saunas from the rest of a store", () => {
  const built = (id: string, source = id === "topture-shopify" ? TOPTURE : id === "select-saunas-shopify" ? SELECT_SAUNAS : HOOGA) => {
    const raw = snapshotText(id);
    const read = shopifyAdapter.read(raw, Buffer.byteLength(raw, "utf8"));
    if (!read.ok) throw new Error(read.reason);
    return buildCandidates(read.table, shopifyProfile(source, TODAY, source.merchantName), source, saunas);
  };

  it("keeps the complete saunas Topture sells and excludes the rest, with a reason for each", () => {
    const out = built("topture-shopify");
    expect(out.candidates.map((c) => c.id).sort()).toEqual(["topture-dundalk-luna-4-person", "topture-topture-barrel-6"]);
    const reasons = out.excluded.map((e) => e.reason);
    expect(reasons).toContain("A heater is a part fitted inside a sauna, not a sauna.");
    expect(reasons).toContain("An accessory is not a complete sauna.");
    expect(reasons).toContain("A cold plunge belongs to another category of this site.");
    expect(out.excluded).toHaveLength(3);
  });

  it("excludes a store's stones and its red-light panels", () => {
    const out = built("select-saunas-shopify");
    const reasons = out.excluded.map((e) => e.reason);
    expect(reasons).toContain("Stones are a consumable, not a sauna.");
    expect(reasons).toContain("A red-light product belongs to another category of this site.");
    expect(out.candidates.map((c) => c.id).sort()).toEqual(["select-saunas-dundalk-luna-4-person", "select-saunas-harvia-solide-compact"]);
  });

  it("finds no complete sauna in a red-light catalogue, and says why rather than finding one anyway", () => {
    const out = built("hooga-shopify");
    expect(out.candidates).toEqual([]);
    expect(out.excluded.map((e) => e.reason)).toEqual([
      "A red-light product belongs to another category of this site.",
      "An accessory is not a complete sauna.",
    ]);
  });

  it("reads no rule over the description, whatever a description says", () => {
    for (const source of [TOPTURE, SELECT_SAUNAS, HOOGA]) {
      const profile = shopifyProfile(source, TODAY, source.merchantName);
      for (const rule of profile.attributes) expect(rule.column, source.id).not.toBe("body_text");
      for (const rule of profile.exclusions) expect(rule.column, source.id).not.toBe("body_text");
      for (const column of profile.columns) {
        if (column.extract) expect(column.column, source.id).not.toBe("body_text");
      }
    }
  });
});

// ---------------------------------------------------------- variants to models

describe("variants become configurations of one model", () => {
  it("groups a product's variants and represents it by the cheapest", () => {
    const raw = snapshotText("topture-shopify");
    const read = shopifyAdapter.read(raw, Buffer.byteLength(raw, "utf8"));
    if (!read.ok) return;
    const out = buildCandidates(read.table, shopifyProfile(TOPTURE, TODAY, "Topture"), TOPTURE, saunas);
    const luna = out.candidates.find((c) => c.id === "topture-dundalk-luna-4-person")!;
    expect(luna.rows).toHaveLength(2);
    expect(luna.fields.price).toEqual({ minor: 899500, currency: "USD" });
    expect(luna.groupNote).toContain("Chosen from 2 rows");
    expect(String(luna.fields.link)).toContain("?variant=1011");
  });
});

// ------------------------------------------------------------------- importing

describe("importing three partners to drafts", () => {
  it("writes drafts and nothing else, for every source it can read", () => {
    const store = workspace();
    const topture = importInto(store, "topture-shopify");
    const select = importInto(store, "select-saunas-shopify");
    expect(topture.ok && select.ok).toBe(true);
    const drafts = store.drafts().products;
    expect(drafts.every((p) => p.status === "draft")).toBe(true);
    expect(drafts.map((p) => p.id).sort()).toEqual([
      "select-saunas-dundalk-luna-4-person",
      "select-saunas-harvia-solide-compact",
      "topture-dundalk-luna-4-person",
      "topture-topture-barrel-6",
    ]);
  });

  it("refuses a source whose rules nobody approved", () => {
    const dir = mkdtempSync(join(tmpdir(), "shopify-"));
    temps.push(dir);
    const store = new IngestionStore(dir);
    store.saveSource(TOPTURE);
    store.saveProfile(shopifyProfile(TOPTURE, TODAY, "Topture"));
    const outcome = importInto(store, "topture-shopify");
    expect(outcome.ok).toBe(false);
    expect(store.drafts().products).toEqual([]);
  });

  it("keeps every offer's partner, ids, price, availability, link and affiliate state", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    const luna = store.draft("topture-dundalk-luna-4-person")!;
    const offer = luna.offers[0];
    expect(offer.merchantId).toBe("topture-store");
    expect(offer.priceMinor).toBe(899500);
    expect(offer.availability).toBe("in_stock");
    expect(offer.url).toBe("https://topture.com/products/dundalk-luna-4-person?variant=1011");
    expect(offer.merchantSku).toBe("DUN-LUNA-4");
    expect(luna.sourceTitle).toBe("Dundalk Luna (4 Person) - Outdoor Sauna");
    expect(luna.name).toBe("Dundalk Luna (4 Person)");
    expect(offer.source.ref).toContain("topture-shopify.json");
    expect(offer.lastChecked).toBe(TODAY);
  });

  it("says the affiliate link is unresolved rather than inventing a tracked one", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    importInto(store, "select-saunas-shopify");
    for (const product of store.drafts().products) {
      // Approved programmes, and no demonstrated way to link to one product so
      // that the programme credits it.
      expect(product.offers[0].affiliate.status, product.id).toBe("unknown");
      expect(product.offers[0].url, product.id).not.toMatch(/ref=|aff=|utm_/);
    }
  });

  it("claims no right to any picture", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    for (const product of store.drafts().products) {
      expect(product.images[0]?.license, product.id).toBeUndefined();
      expect(product.images[0]?.source?.note ?? "", product.id).toContain("unresolved");
    }
  });
});

// --------------------------------------------------------------- refreshing

describe("the same catalogue, read again", () => {
  it("changes nothing", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    const second = importInto(store, "topture-shopify", snapshotText("topture-shopify"), "2026-09-20");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.counts.unchanged).toBe(2);
    expect(second.written).toEqual([]);
    expect(second.report.stalenessDays).toBe(5);
  });

  it("writes a price the store moved, and keeps an editorial name", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    const id = "topture-dundalk-luna-4-person";
    const edited = applyEditorialEdit(store.draft(id)!, { name: "Dundalk Luna, four-person" }, { by: "an editor", on: TODAY });
    if (!edited.ok) return;
    store.writeDraft("products", id, edited.product);

    const moved = JSON.parse(snapshotText("topture-shopify")) as { products: { handle: string; variants: { price: string }[] }[] };
    moved.products.find((p) => p.handle === "dundalk-luna-4-person")!.variants[0].price = "8495.00";
    const second = importInto(store, "topture-shopify", JSON.stringify(moved), "2026-09-20");
    expect(second.ok).toBe(true);
    expect(store.draft(id)!.name).toBe("Dundalk Luna, four-person");
    expect(store.draft(id)!.offers[0].priceMinor).toBe(849500);
  });

  it("reports a product the store has stopped selling and deletes nothing", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    const shorter = JSON.parse(snapshotText("topture-shopify")) as { products: { handle: string }[] };
    shorter.products = shorter.products.filter((p) => p.handle !== "topture-barrel-6");
    const second = importInto(store, "topture-shopify", JSON.stringify(shorter), "2026-09-20");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.withdrawn).toContain("topture-topture-barrel-6");
    expect(store.draft("topture-topture-barrel-6")).toBeDefined();
  });

  it("leaves the last good state alone when a snapshot will not read", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    const before = store.drafts().products.map((p) => p.id).sort();
    const state = store.state("topture-shopify");

    const broken = importInto(store, "topture-shopify", "{ this is not json", "2026-09-20");
    expect(broken.ok).toBe(false);
    expect(store.drafts().products.map((p) => p.id).sort()).toEqual(before);
    expect(store.state("topture-shopify").lastSuccessfulRefresh).toBe(state.lastSuccessfulRefresh);
    expect(store.state("topture-shopify").lastUploadHash).toBe(state.lastUploadHash);
  });

  it("records what was read, from where and when", () => {
    const store = workspace();
    const outcome = importInto(store, "topture-shopify");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const state = store.state("topture-shopify");
    expect(state.lastSuccessfulRefresh).toBe(TODAY);
    expect(state.lastFile).toBe("topture-shopify.json");
    expect(state.lastUploadHash).toHaveLength(64);
    expect(outcome.report.readerNotes.join(" ")).toContain("https://topture.com");
    expect(outcome.report.readerNotes.join(" ")).toContain("Fetched 2026-09-15T08:00:00Z");
  });
});

// ------------------------------------------------------- the same sauna twice

describe("one sauna, two retailers", () => {
  const records = (store: IngestionStore): CanonicalRecord[] =>
    store.drafts().products.map((p) => canonicalRecordOf(p, p.id.startsWith("topture") ? "topture-shopify" : "select-saunas-shopify"));

  it("recognises the same model in two stores and asks rather than merging", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    importInto(store, "select-saunas-shopify");
    const review = reviewCanonical(records(store));
    expect(review.groups).toHaveLength(1);
    const group = review.groups[0];
    expect(group.members.map((m) => m.id)).toEqual(["select-saunas-dundalk-luna-4-person", "topture-dundalk-luna-4-person"]);
    // No shared identifier, so it is a proposal and it waits for a person.
    expect(group.strength).toBe("proposed");
    expect(group.evidence).toEqual(["brand_and_model"]);
    expect(review.confirmed).toEqual([]);
    expect(review.queued).toHaveLength(1);
    expect(review.unmatched).toBe(2);
  });

  it("never groups two records from the same store", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    expect(canonicalGroups(records(store))).toEqual([]);
  });

  it("normalises only case, spacing and punctuation", () => {
    expect(normalise("The Ascent (6 Person)")).toBe("the ascent 6 person");
    expect(normalise("the  ascent 6-person")).toBe("the ascent 6 person");
    // A different word is a different model.
    expect(normalise("The Ascent")).not.toBe(normalise("The Ascent 6 Person"));
  });

  const record = (over: Partial<CanonicalRecord>): CanonicalRecord => ({
    id: "x", sourceId: "a", merchantId: "m", name: "Luna 4", brandId: "dundalk", gtin: [], ...over,
  });

  it("settles a match on a shared GTIN", () => {
    const groups = canonicalGroups([
      record({ id: "a-1", sourceId: "a", gtin: ["0123456789012"] }),
      record({ id: "b-1", sourceId: "b", gtin: ["0123456789012"], name: "Luna Four Person" }),
    ]);
    expect(groups[0].strength).toBe("confirmed");
    expect(groups[0].evidence).toEqual(["gtin"]);
  });

  it("settles a match on one maker's part number under one brand", () => {
    const groups = canonicalGroups([record({ id: "a-1", sourceId: "a", mpn: "LUNA-4" }), record({ id: "b-1", sourceId: "b", mpn: "luna-4" })]);
    expect(groups[0].strength).toBe("confirmed");
    expect(groups[0].evidence).toEqual(["mpn_and_brand"]);
  });

  it("refuses to merge one name under two brands", () => {
    const groups = canonicalGroups([record({ id: "a-1", sourceId: "a", brandId: "topture" }), record({ id: "b-1", sourceId: "b", brandId: "sweat-kingdom" })]);
    expect(groups[0].strength).toBe("ambiguous");
    expect(groups[0].why).toContain("house brand");
  });

  it("refuses a match whose identifiers contradict each other", () => {
    const groups = canonicalGroups([record({ id: "a-1", sourceId: "a", mpn: "LUNA-4" }), record({ id: "b-1", sourceId: "b", mpn: "LUNA-6" })]);
    expect(groups[0].strength).toBe("ambiguous");
    expect(groups[0].why).toContain("One of them is wrong");
  });

  it("merges into one product with one offer per retailer, and keeps the incumbent's own words", () => {
    const store = workspace();
    importInto(store, "topture-shopify");
    importInto(store, "select-saunas-shopify");
    const products = new Map(store.drafts().products.map((p) => [p.id, p]));
    const edited = applyEditorialEdit(products.get("topture-dundalk-luna-4-person")!, { name: "Dundalk Luna, four-person" }, { by: "an editor", on: TODAY });
    if (edited.ok) products.set("topture-dundalk-luna-4-person", edited.product);

    const group = canonicalGroups(records(store))[0];
    const merged = mergeCanonical(group, products, {
      incumbentIds: new Set(["topture-dundalk-luna-4-person"]),
      sourceNames: { "select-saunas-dundalk-luna-4-person": "Select Saunas" },
      on: TODAY,
    })!;
    expect(merged.primary).toBe("topture-dundalk-luna-4-person");
    expect(merged.product.name).toBe("Dundalk Luna, four-person");
    expect(merged.product.offers.map((o) => o.merchantId).sort()).toEqual(["select-saunas", "topture-store"]);
    expect(merged.product.offers.map((o) => o.priceMinor).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([899500, 925000]);
    expect(merged.offersFrom).toHaveLength(2);
    expect(merged.product.source.note).toContain("Merged on 2026-09-15");
    expect(merged.product.source.note).toContain("brand_and_model");
  });

  it("merges nothing on its own: a group of one is not a merge", () => {
    const group = { key: "k", members: [{ id: "a-1" } as CanonicalRecord], strength: "confirmed" as const, evidence: [], why: "" };
    expect(mergeCanonical(group, new Map(), { incumbentIds: new Set(), sourceNames: {}, on: TODAY })).toBeUndefined();
  });
});

// ------------------------------------------------------------ what cannot be read

describe("partners that cannot be read", () => {
  it("records both, with the reason and without having gone around either", () => {
    expect(BLOCKED_PARTNERS.map((p) => p.state).sort()).toEqual(["blocked_pending_authorized_export", "blocked_pending_portal_review"]);
    const lifepro = BLOCKED_PARTNERS.find((p) => p.id === "lifepro")!;
    expect(lifepro.why).toContain("403");
    const therasage = BLOCKED_PARTNERS.find((p) => p.id === "therasage")!;
    expect(therasage.why).toContain("CAPTCHA");
  });

  it("gives them no source and no profile, so nothing can import from them", () => {
    const store = workspace();
    for (const partner of BLOCKED_PARTNERS) expect(store.source(partner.id)).toBeUndefined();
  });
});
