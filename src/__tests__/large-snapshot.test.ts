/**
 * A real storefront is bigger than a spreadsheet, and the tool now knows it.
 *
 * The first real fetch produced Select Saunas at 737 products and 6,333 kB, a
 * valid snapshot inside every bound the adapter states. The tool refused it
 * with "that is more than 1200 kB": the transport had been sized from the CSV
 * ceiling, which is a bound about partner price files and says nothing about a
 * store's whole catalogue. Nothing here removes a bound. Each format states its
 * own, and a catalogue too big to travel through a browser is read from the
 * disk it is already sitting on.
 *
 * Payloads are generated rather than committed. A megabyte of fabricated
 * marketing copy in the repository would be read by somebody one day as a real
 * partner's catalogue, and it would be six thousand lines of noise in every
 * diff until then.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { adapterFor, maxUploadBytes, withinUploadLimit } from "@/domain/ingestion/adapter";
import { LIMITS } from "@/domain/import/csv";
import { BYTES_PER_PRODUCT, SHOPIFY_LIMITS, SNAPSHOT_UPLOAD_LIMIT, readSnapshot, shopifyAdapter } from "@/domain/ingestion/shopify";
import { MappingProfile } from "@/domain/ingestion/profile";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { runIngestionImport } from "@/providers/ingestion/import";
import { SELECT_SAUNAS, shopifyProfile } from "../../scripts/shopify-partners";
import { snapshotDir, snapshotFor, snapshotsOnDisk } from "@/providers/ingestion/snapshots";

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

const temp = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

/**
 * A product shaped like the real ones: most of its bytes are `body_html`, and
 * that markup is dense with the quotes that make JSON escaping cost something.
 */
function product(i: number) {
  const copy = "Eastern White Cedar staves, stainless steel bands, and a tempered glass door. ".repeat(12);
  return {
    id: 100_000 + i,
    title: `Dundalk Luna ${(i % 8) + 2} Person Outdoor Barrel Sauna - Model ${i}`,
    handle: `dundalk-luna-model-${i}`,
    vendor: "Dundalk LeisureCraft",
    product_type: "Outdoor Sauna",
    tags: ["sauna", "outdoor sauna", "barrel", "cedar"],
    body_html: `<div class="product-description" id="desc-${i}" data-model="${i}"><p>The <strong>Luna ${i}</strong> is a "flat roof" barrel sauna.</p><img src="https://cdn.shopify.com/s/files/1/0000/luna-${i}.jpg" alt="Luna ${i}" /><p>${copy}</p></div>`,
    created_at: "2025-01-02T10:00:00-05:00",
    updated_at: "2026-09-15T08:00:00-04:00",
    options: [{ name: "Heater" }],
    images: [{ src: `https://cdn.shopify.com/s/files/1/0000/luna-${i}.jpg`, position: 1 }],
    variants: [
      { id: 200_000 + i, title: "Electric", sku: `DUN-LUNA-${i}-E`, price: `${8000 + i}.00`, available: true, position: 1, updated_at: "2026-09-15T08:00:00-04:00" },
      { id: 300_000 + i, title: "Wood", sku: `DUN-LUNA-${i}-W`, price: `${9000 + i}.00`, available: false, position: 2, updated_at: "2026-09-15T08:00:00-04:00" },
    ],
  };
}

/** A snapshot of a given number of products, in the shape the fetch command writes. */
function snapshot(products: number, sourceId = "select-saunas-shopify"): string {
  return JSON.stringify({
    sourceId,
    storeUrl: "https://selectsaunas.com",
    requested: [`https://selectsaunas.com/products.json?limit=250&page=1`],
    pages: Math.ceil(products / 250),
    productCount: products,
    variantCount: products * 2,
    fetchedAt: "2026-09-15T08:00:00.000Z",
    products: Array.from({ length: products }, (_, i) => product(i + 1)),
  });
}

const bytesOf = (text: string): number => Buffer.byteLength(text, "utf8");

describe("a catalogue larger than a spreadsheet", () => {
  it("generates a payload past the bound that refused the real one", () => {
    const text = snapshot(737);
    // The number in the message a person actually saw: 1200 kB.
    expect(bytesOf(text)).toBeGreaterThan(1_200_000);
    expect(bytesOf(text)).toBeGreaterThan(LIMITS.bytes);
  });

  it("reads it, in full, with no row lost", () => {
    const text = snapshot(737);
    const read = shopifyAdapter.read(text, bytesOf(text));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.table.rows.length).toBe(737 * 2);
    expect(read.table.truncated).toBe(0);
    expect(read.table.notes.join(" ")).toContain("737 products");
  });

  it("would have been refused by the ceiling written for partner price files", () => {
    const text = snapshot(737);
    const asCsv = withinUploadLimit("csv", bytesOf(text));
    expect(asCsv.ok).toBe(false);
    if (!asCsv.ok) expect(asCsv.reason).toContain("kB");
  });

  it("passes the ceiling written for storefront catalogues", () => {
    expect(withinUploadLimit("json", bytesOf(snapshot(737))).ok).toBe(true);
  });
});

describe("a bound per format, not one bound for both", () => {
  it("keeps the CSV ceiling exactly where it was", () => {
    const csv = adapterFor("csv");
    expect(csv.ok).toBe(true);
    if (csv.ok) expect(csv.adapter.maxUploadBytes).toBe(LIMITS.bytes);
    expect(withinUploadLimit("csv", LIMITS.bytes).ok).toBe(true);
    expect(withinUploadLimit("csv", LIMITS.bytes + 1).ok).toBe(false);
  });

  it("derives the snapshot ceiling from the products a snapshot may hold", () => {
    expect(SNAPSHOT_UPLOAD_LIMIT).toBe(1_000 * BYTES_PER_PRODUCT);
    expect(SHOPIFY_LIMITS.bytes).toBe(SHOPIFY_LIMITS.products * BYTES_PER_PRODUCT);
    // The transport bound is well under the adapter's own, which is the point:
    // a bigger catalogue is readable, it just does not travel through a browser.
    expect(SNAPSHOT_UPLOAD_LIMIT).toBeLessThan(SHOPIFY_LIMITS.bytes);
  });

  it("still refuses a snapshot over its own ceiling, and says what to do instead", () => {
    const over = withinUploadLimit("json", SNAPSHOT_UPLOAD_LIMIT + 1);
    expect(over.ok).toBe(false);
    if (!over.ok) {
      expect(over.reason).toContain("intake/shopify");
      expect(over.reason).toContain("read the snapshot on disk");
    }
  });

  it("refuses a snapshot past the adapter's own bound however it arrived", () => {
    const refused = readSnapshot("{}", SHOPIFY_LIMITS.bytes + 1);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toContain("MB");
  });

  it("sizes the transport from the largest format, not the smallest", () => {
    expect(maxUploadBytes()).toBe(SNAPSHOT_UPLOAD_LIMIT);
    expect(maxUploadBytes()).toBeGreaterThan(LIMITS.bytes);
  });
});

describe("reading a snapshot the fetch command already wrote", () => {
  it("finds it by naming the partner and nothing else", () => {
    const dir = temp("snapshots-");
    writeFileSync(join(dir, "select-saunas-shopify.json"), snapshot(12), "utf8");
    const found = snapshotFor("select-saunas-shopify", dir);
    expect(found.ok).toBe(true);
    if (found.ok) expect(found.path).toBe(join(dir, "select-saunas-shopify.json"));
  });

  it("refuses every id that is trying to be a path", () => {
    const dir = temp("snapshots-");
    writeFileSync(join(dir, "select-saunas-shopify.json"), snapshot(2), "utf8");
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "nested", "secret.json"), snapshot(1), "utf8");
    for (const id of ["../../etc/passwd", "..%2f..%2fetc%2fpasswd", "/etc/passwd", "nested/secret", "./select-saunas-shopify", "a/../select-saunas-shopify", "Select-Saunas", "select saunas", "select-saunas-shopify.json"]) {
      const found = snapshotFor(id, dir);
      expect(found.ok, id).toBe(false);
    }
  });

  it("says where a missing one comes from rather than failing blankly", () => {
    const found = snapshotFor("hooga-shopify", temp("snapshots-"));
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.reason).toContain("npm run fetch:shopify -- hooga-shopify");
  });

  it("lists what is on the machine, with sizes, for the tool to offer", () => {
    const dir = temp("snapshots-");
    writeFileSync(join(dir, "topture-shopify.json"), snapshot(3, "topture-shopify"), "utf8");
    writeFileSync(join(dir, "select-saunas-shopify.json"), snapshot(737), "utf8");
    writeFileSync(join(dir, "notes.txt"), "not a snapshot", "utf8");
    const listed = snapshotsOnDisk(dir);
    expect(listed.map((s) => s.sourceId)).toEqual(["select-saunas-shopify", "topture-shopify"]);
    expect(listed[0].bytes).toBeGreaterThan(1_200_000);
  });

  it("keeps the directory inside the project, whatever an environment variable says", () => {
    const env = (named?: string): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...(named === undefined ? {} : { SNAPSHOT_DIR: named }) });
    expect(snapshotDir("/home/x/project", env())).toBe("/home/x/project/intake/shopify");
    expect(snapshotDir("/home/x/project", env("tmp/snaps"))).toBe("/home/x/project/tmp/snaps");
    expect(() => snapshotDir("/home/x/project", env("../elsewhere"))).toThrow(/inside this project/);
    expect(() => snapshotDir("/home/x/project", env("/etc"))).toThrow(/inside this project/);
  });
});

describe("what a big file does to the workspace", () => {
  it("is still scanned for credentials before a byte is written", () => {
    const dir = temp("store-");
    const store = new IngestionStore(dir);
    const leaky = JSON.parse(snapshot(737)) as { requested: string[] };
    leaky.requested = ["https://selectsaunas.com/products.json?api_key=abcdef123456789"];
    const text = JSON.stringify(leaky);
    expect(bytesOf(text)).toBeGreaterThan(1_200_000);
    const saved = store.saveUpload("select-saunas-shopify", "select-saunas-shopify.json", text, "2026-09-15");
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.reason).toContain("credential");
    expect(existsSync(join(dir, "uploads", "select-saunas-shopify"))).toBe(false);
  });

  it("lands whole or not at all, and leaves nothing half written behind", () => {
    const dir = temp("store-");
    const store = new IngestionStore(dir);
    const text = snapshot(737);
    const saved = store.saveUpload("select-saunas-shopify", "select-saunas-shopify.json", text, "2026-09-15");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.bytes).toBe(bytesOf(text));
    expect(readFileSync(saved.path, "utf8")).toBe(text);
    // The name is a hash of the contents, so a partial file under it would be a
    // record that lies. Nothing is left beside it.
    expect(readdirSync(join(dir, "uploads", "select-saunas-shopify")).filter((f) => f.endsWith(".partial"))).toEqual([]);
  });
});

describe("importing a whole storefront", () => {
  it("writes drafts from a catalogue past the old bound, and touches no catalogue file", () => {
    const dir = temp("import-");
    const store = new IngestionStore(dir);
    store.saveSource(SELECT_SAUNAS);
    const profile = shopifyProfile(SELECT_SAUNAS, "2026-09-15", "Select Saunas");
    store.saveProfile(MappingProfile.parse({
      ...profile,
      columns: profile.columns.map((c) => (c.extract ? { ...c, extract: { ...c.extract, approved: true, approvedBy: "a reviewer" } } : c)),
      attributes: profile.attributes.map((a) => (a.from === "extract" ? { ...a, approved: true, approvedBy: "a reviewer" } : a)),
    }));
    store.approveProfile(SELECT_SAUNAS.id, 1, "a reviewer", "2026-09-15");

    const text = snapshot(737);
    expect(bytesOf(text)).toBeGreaterThan(1_200_000);
    const outcome = runIngestionImport({
      store,
      catalogDir: join(process.cwd(), "catalog"),
      sourceId: SELECT_SAUNAS.id,
      version: 1,
      fileName: "select-saunas-shopify.json",
      text,
      today: "2026-09-15",
    });
    expect(outcome.ok, outcome.ok ? "" : outcome.errors.join(" ")).toBe(true);
    if (!outcome.ok) return;
    // One draft per product, not per variant: the profile groups on the handle
    // and the cheapest variant represents the model, exactly as it does at six
    // products.
    expect(outcome.report.sourceRecords).toBe(737);
    expect(store.drafts().products).toHaveLength(737);
    expect(outcome.upload.bytes).toBe(bytesOf(text));
    // The upload is kept whole, under a name that is a hash of its contents.
    expect(readFileSync(outcome.upload.path, "utf8")).toBe(text);
  });
});
