/**
 * The staged records, through the catalogue the storefront actually reads.
 *
 * Nothing here is stubbed. The base is the real `catalog/` directory, the
 * overlay is a real directory on disk written by the same `PreviewStore` the
 * operator tool writes with, and the reads go through `src/lib/queries.ts`,
 * which is the code every page uses. `process.cwd()` is pointed at a sandbox so
 * the composition root builds its own catalogue from it, and the module graph
 * is reset between states because `getCatalog()` memoises.
 */

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { categoryBySlug } from "@/domain/categories";
import { applyFilters, buildFilterGroups } from "@/domain/filters";
import { readCsv } from "@/domain/import/csv";
import { buildDrafts } from "@/domain/import/draft";
import { suggestMapping } from "@/domain/import/mapping";
import { stageDrafts } from "@/domain/inventory/stage";
import { applyEdit } from "@/domain/inventory/edit";
import { transition, type InventoryAction } from "@/domain/inventory/status";
import type { ProductStatus } from "@/domain/product";
import { PreviewStore } from "@/providers/catalog/PreviewStore";

const REPO = process.cwd();
const SAMPLE = join(REPO, "docs/import-demo/samples/supplier-a-northwind-SYNTHETIC.csv");
const ENERGY = "preview-northwind-hydration-berry-sparkling-energy-12-cans";
const DEPLOYMENT_VARS = ["VERCEL", "VERCEL_ENV", "NEXT_PUBLIC_VERCEL_ENV", "CI", "CONTEXT", "NEXT_PUBLIC_SITE_URL"];

/** Every file under a directory, and its contents, as one string. */
function fingerprint(dir: string): string {
  const hash = createHash("sha256");
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else hash.update(path).update(readFileSync(path));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

let root: string;
let store: PreviewStore;
let cwd: ReturnType<typeof vi.spyOn>;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wellness-preview-"));
  // The real catalogue, not a copy of it. Anything this suite proves about
  // preserving catalogue facts is proved about the facts that ship.
  symlinkSync(join(REPO, "catalog"), join(root, "catalog"), "dir");
  store = new PreviewStore(join(root, "catalog-preview"));
  for (const name of DEPLOYMENT_VARS) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  process.env.WELLNESS_PREVIEW_INVENTORY = "1";
  cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
});

afterEach(() => {
  cwd.mockRestore();
  delete process.env.WELLNESS_PREVIEW_INVENTORY;
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
  rmSync(root, { recursive: true, force: true });
  vi.resetModules();
});

/** The storefront's own read helpers, over a freshly built catalogue. */
async function storefront() {
  vi.resetModules();
  return import("@/lib/queries");
}

function stageSample(): void {
  const text = readFileSync(SAMPLE, "utf8");
  const table = readCsv(text, Buffer.byteLength(text, "utf8"));
  if (!table.ok) throw new Error(table.reason);
  const result = stageDrafts(buildDrafts(table.headers, table.rows, suggestMapping(table.headers).mapping), {
    supplierName: "Northwind Hydration",
    sourceFile: "supplier-a-northwind-SYNTHETIC.csv",
    pricedOn: "2026-09-12",
    stagedOn: "2026-09-12",
  });
  if (result.merchant) store.write("merchants", result.merchant.id, result.merchant);
  for (const b of result.brands) store.write("brands", b.id, b);
  for (const s of result.staged) store.write("products", s.product.id, s.product);
}

/** What the operator tool does: read the record, check the move, write it back. */
function operate(id: string, action: InventoryAction): void {
  const product = store.product(id);
  const next = transition(product.status, action);
  if (!next.ok) throw new Error(next.error);
  store.write("products", id, { ...product, status: next.to });
}

const idsIn = async (): Promise<string[]> => {
  const { getCategoryPage } = await storefront();
  const page = await getCategoryPage("wellness-drinks");
  return page!.products.map((p) => p.view.id);
};

describe("a staged record, and the storefront on this machine", () => {
  it("survives a round trip to disk unchanged", () => {
    stageSample();
    const reread = new PreviewStore(join(root, "catalog-preview")).records();
    expect(reread.products).toHaveLength(5);
    const p = reread.products.find((x) => x.id === ENERGY)!;
    expect(p.status).toBe("draft");
    expect(p.identifiers.merchantSkus).toEqual({ "preview-supplier-northwind-hydration": "NW-1002" });
    expect(p.attributes.caffeine_mg).toMatchObject({ verification: "demo", value: 200, unit: "mg" });
    expect(p.offers[0].priceMinor).toBe(1612);
  });

  it("keeps a draft out of the storefront entirely", async () => {
    const before = await idsIn();
    stageSample();
    const after = await idsIn();
    expect(after).toEqual(before);
    const { getProductPage, getProductViewsByIds } = await storefront();
    expect(await getProductPage(ENERGY)).toBeNull();
    expect(await getProductViewsByIds([ENERGY])).toEqual([]);
  });

  it("puts it in the storefront when, and only when, somebody approves it", async () => {
    stageSample();
    const before = await idsIn();
    operate(ENERGY, "approve");
    const after = await idsIn();
    expect(after).toContain(ENERGY);
    expect(after).toHaveLength(before.length + 1);
    expect(before.every((id) => after.includes(id))).toBe(true);
  });

  it("gives it a product page, a comparison and a store link once approved", async () => {
    stageSample();
    operate(ENERGY, "approve");
    const { getProductPage, getProductViewsByIds, lowestOfferUrl } = await storefront();
    const page = await getProductPage(ENERGY);
    expect(page?.item.view.name).toBe("Berry Sparkling Energy, 12 cans");
    expect(lowestOfferUrl(page!.item.view)).toBe("https://example.invalid/northwind/berry-sparkling");
    expect(page!.item.view.price.isDemo).toBe(true);
    const compared = await getProductViewsByIds([ENERGY, "celsius-sparkling-orange-12"]);
    expect(compared.map((v) => v.id).sort()).toEqual([ENERGY, "celsius-sparkling-orange-12"].sort());
  });

  it("takes it back out when it is hidden, and puts it back when it is not", async () => {
    stageSample();
    operate(ENERGY, "approve");
    expect(await idsIn()).toContain(ENERGY);

    operate(ENERGY, "hide");
    expect(await idsIn()).not.toContain(ENERGY);
    const hidden = await storefront();
    expect(await hidden.getProductPage(ENERGY)).toBeNull();
    expect(await hidden.getProductViewsByIds([ENERGY])).toEqual([]);
    // Hidden is out of the storefront and still on disk. Removing is a
    // different thing and it is a different command.
    expect(store.has(ENERGY)).toBe(true);

    operate(ENERGY, "unhide");
    expect(await idsIn()).toContain(ENERGY);
  });

  it("leaves it out of the storefront once it is removed", async () => {
    stageSample();
    operate(ENERGY, "approve");
    expect(await idsIn()).toContain(ENERGY);
    store.remove(ENERGY);
    expect(await idsIn()).not.toContain(ENERGY);
  });
});

describe("a change made while the site is running", () => {
  it("carries an approved edit through category, detail and comparison, then hides and restores it", async () => {
    const before = fingerprint(join(REPO, "catalog"));
    // Hold the same query module throughout: resetting it would hide a stale cache.
    const queries = await storefront();
    const categoryIds = async () => (await queries.getCategoryPage("wellness-drinks"))!.products.map((p) => p.view.id);
    const originalIds = await categoryIds();
    stageSample();
    expect(await categoryIds()).toEqual(originalIds);
    expect(await queries.getProductPage(ENERGY)).toBeNull();

    operate(ENERGY, "approve");
    expect(await categoryIds()).toContain(ENERGY);
    const edited = applyEdit(store.product(ENERGY), {
      name: "Berry Sparkling Energy — reviewed demo",
      figures: [{ key: "caffeine_mg", raw: "160" }],
    }, { editedOn: "2026-09-12" });
    expect(edited.ok).toBe(true);
    if (!edited.ok) throw new Error("Demo edit rejected");
    store.write("products", ENERGY, edited.product);

    const detail = await queries.getProductPage(ENERGY);
    expect(detail?.item.view.name).toBe(edited.product.name);
    const category = await queries.getCategoryPage("wellness-drinks");
    expect(category!.products.find((p) => p.view.id === ENERGY)?.view.name).toBe(edited.product.name);
    expect((await queries.getProductViewsByIds([ENERGY]))[0]?.name).toBe(edited.product.name);
    expect(detail!.item.view.attributes.caffeine_mg).toBeUndefined();
    expect(store.product(ENERGY).attributes.caffeine_mg).toMatchObject({ value: 160, verification: "demo" });

    operate(ENERGY, "hide");
    expect(await categoryIds()).toEqual(originalIds);
    expect(await queries.getProductPage(ENERGY)).toBeNull();
    expect(await queries.getProductViewsByIds([ENERGY])).toEqual([]);
    expect(new PreviewStore(join(root, "catalog-preview")).product(ENERGY).name).toBe(edited.product.name);

    operate(ENERGY, "unhide");
    expect(await categoryIds()).toContain(ENERGY);
    expect((await queries.getProductPage(ENERGY))?.item.view.name).toBe(edited.product.name);
    expect(fingerprint(join(REPO, "catalog"))).toBe(before);
  });

  it("reaches the catalogue the running process reads, with nothing restarted", async () => {
    vi.resetModules();
    // One module instance, one `getCatalog`, held across every change below.
    // This is the whole claim: an approval is not something a restart delivers.
    const { getCatalog } = await import("@/providers");
    const published = async () => (await getCatalog().listProductViews({ status: ["published"] })).map((v) => v.id);

    stageSample();
    expect(await published()).not.toContain(ENERGY);

    operate(ENERGY, "approve");
    expect(await published()).toContain(ENERGY);

    operate(ENERGY, "hide");
    expect(await published()).not.toContain(ENERGY);

    operate(ENERGY, "unhide");
    expect(await published()).toContain(ENERGY);

    store.remove(ENERGY);
    expect(await published()).not.toContain(ENERGY);
  });

  it("notices two changes inside one filesystem timestamp tick", async () => {
    vi.resetModules();
    const { getCatalog } = await import("@/providers");
    stageSample();
    const name = async () => (await getCatalog().getProductView(ENERGY))?.name;
    const original = await name();
    const record = store.product(ENERGY);
    store.write("products", ENERGY, { ...record, name: "First" });
    expect(await name()).toBe("First");
    store.write("products", ENERGY, { ...record, name: "Second" });
    expect(await name()).toBe("Second");
    expect(original).not.toBe("Second");
  });

  it("builds the catalogue once where there is no preview catalogue to watch", async () => {
    vi.resetModules();
    delete process.env.WELLNESS_PREVIEW_INVENTORY;
    const { getCatalog } = await import("@/providers");
    // The same object, so the real site reads no directory on any call but the
    // first. The preview path is the only one that looks at anything twice.
    expect(getCatalog()).toBe(getCatalog());
  });
});

describe("what an approved sample does to the filters", () => {
  async function groupsNow() {
    const { getCategoryPage } = await storefront();
    const page = (await getCategoryPage("wellness-drinks"))!;
    const cat = categoryBySlug("wellness-drinks")!;
    return { page, groups: buildFilterGroups(page.products.map((p) => p.view), cat) };
  }

  it("answers no filter, because every figure on it is demo data", async () => {
    stageSample();
    operate(ENERGY, "approve");
    const { page, groups } = await groupsNow();
    expect(page.products.map((p) => p.view.id)).toContain(ENERGY);
    for (const group of groups) {
      for (const option of group.options) expect(option.matchIds).not.toContain(ENERGY);
    }
    const all = page.products.map((p) => p.view.id);
    expect(applyFilters(all, groups, ["function:energy"])).not.toContain(ENERGY);
    // Nothing on it reached the matchable attributes, which is what withholding
    // a demo figure means.
    expect(page.products.find((p) => p.view.id === ENERGY)!.view.attributes).toEqual({});
  });

  it("changes no chip and no count", async () => {
    const before = await groupsNow();
    stageSample();
    operate(ENERGY, "approve");
    const after = await groupsNow();
    const shape = (g: Awaited<ReturnType<typeof groupsNow>>["groups"]) =>
      g.map((x) => ({ key: x.key, options: x.options.map((o) => ({ id: o.id, matched: o.matchIds.length })) }));
    expect(shape(after.groups)).toEqual(shape(before.groups));
  });
});

describe("the preview catalogue only ever adds", () => {
  function writeRaw(id: string, patch: Record<string, unknown>): void {
    stageSample();
    const base = store.product(ENERGY);
    mkdirSync(join(root, "catalog-preview", "products"), { recursive: true });
    writeFileSync(join(root, "catalog-preview", "products", `${id}.json`), JSON.stringify({ ...base, ...patch, id }, null, 2), "utf8");
  }

  it("refuses the whole overlay when a record takes a real product's id", async () => {
    const before = await idsIn();
    writeRaw("celsius-sparkling-orange-12", { status: "published", slug: "preview-clash" });
    expect(await idsIn()).toEqual(before);
  });

  it("refuses the whole overlay when a record takes a real product's slug", async () => {
    const before = await idsIn();
    writeRaw("preview-slug-thief", { status: "published", slug: "celsius-sparkling-orange-12-pack" });
    expect(await idsIn()).toEqual(before);
  });

  it("refuses the whole overlay when a record is not named as preview data", async () => {
    const before = await idsIn();
    writeRaw("plain-looking-record", { status: "published", slug: "plain-looking-record" });
    expect(await idsIn()).toEqual(before);
  });

  it("refuses the whole overlay when one record would not validate, and serves the real catalogue", async () => {
    const before = await idsIn();
    writeRaw("preview-no-image", { status: "published", slug: "preview-no-image", images: [] });
    const after = await idsIn();
    expect(after).toEqual(before);
    // The other four staged records are valid and they do not load either. A
    // partial overlay is a catalogue quietly missing something somebody staged.
    expect(after).not.toContain("preview-northwind-hydration-citrus-salt-sticks-30-pack");
  });

  it("refuses the whole overlay when a file is not a product at all", async () => {
    const before = await idsIn();
    stageSample();
    writeFileSync(join(root, "catalog-preview", "products", "preview-broken.json"), "{ not json", "utf8");
    expect(await idsIn()).toEqual(before);
  });
});

describe("where the preview catalogue may load", () => {
  it("does not load without the flag", async () => {
    stageSample();
    operate(ENERGY, "approve");
    delete process.env.WELLNESS_PREVIEW_INVENTORY;
    expect(await idsIn()).not.toContain(ENERGY);
  });

  it("does not load on anything that looks like a deployment, flag or no flag", async () => {
    stageSample();
    operate(ENERGY, "approve");
    for (const signal of ["VERCEL", "VERCEL_ENV", "CONTEXT", "CI"]) {
      process.env[signal] = signal === "VERCEL_ENV" ? "production" : "1";
      expect(await idsIn()).not.toContain(ENERGY);
      delete process.env[signal];
    }
  });

  it("does not load where a public address has been configured", async () => {
    stageSample();
    operate(ENERGY, "approve");
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.org";
    expect(await idsIn()).not.toContain(ENERGY);
  });

  it("loads on a machine with none of those", async () => {
    stageSample();
    operate(ENERGY, "approve");
    expect(await idsIn()).toContain(ENERGY);
  });
});

describe("the real catalogue", () => {
  it("is never written to", async () => {
    // The sandbox's `catalog` is a symlink to the repository's own, so a write
    // through any of these would change the files that ship.
    const before = fingerprint(join(REPO, "catalog"));
    stageSample();
    operate(ENERGY, "approve");
    operate(ENERGY, "hide");
    operate(ENERGY, "unhide");
    store.remove(ENERGY);
    store.clear();
    expect(fingerprint(join(REPO, "catalog"))).toEqual(before);
  });

  it("refuses a path outside the preview directory", () => {
    for (const bad of ["../catalog/products/celsius-sparkling-orange-12", "celsius-sparkling-orange-12"]) {
      expect(() => store.path("products", bad)).toThrow(/not a preview record id/);
    }
  });

  it("holds its statuses where the storefront reads them", async () => {
    const statuses: ProductStatus[] = ["draft", "published", "hidden"];
    stageSample();
    for (const status of statuses) {
      store.write("products", ENERGY, { ...store.product(ENERGY), status });
      const ids = await idsIn();
      expect(ids.includes(ENERGY)).toBe(status === "published");
    }
  });
});
