/**
 * The partner ingestion flow, exercised on the file it was built against.
 *
 * The Sweat Kingdom feed in `intake/sweat-kingdom/` is a real Awin export, so
 * everything here that says "225 rows" or "no specification" is an assertion
 * about a partner's actual file rather than about a fixture written to agree
 * with the code. The small CSVs further down are fixtures on purpose: a
 * three-way merge needs a second and a third version of a file, and this
 * project has only ever been sent one.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { saunas } from "@/domain/categories/saunas";
import { comparisonCount, familyIssues } from "@/domain/family";
import { adapterFor, csvAdapter, formatOptions } from "@/domain/ingestion/adapter";
import { buildCandidates } from "@/domain/ingestion/build";
import { applyEditorialEdit } from "@/domain/ingestion/editorial";
import { applyExtraction } from "@/domain/ingestion/extract";
import { mergeRecord, nextSnapshot } from "@/domain/ingestion/merge";
import { normaliseAttribute, readAvailability, readPrice } from "@/domain/ingestion/normalize";
import { preflight } from "@/domain/ingestion/preflight";
import { checkFamilyRules, checkProfile, compilePattern, MappingProfile } from "@/domain/ingestion/profile";
import { suggestColumns } from "@/domain/ingestion/suggest";
import { findCredentials, IngestionStore } from "@/providers/ingestion/IngestionStore";
import { runIngestionImport } from "@/providers/ingestion/import";
import { FIRST_PROFILE, SWEAT_KINGDOM } from "../../scripts/ingestion-seed";

const CATALOG = join(process.cwd(), "catalog");
const FEED = join(process.cwd(), "intake/sweat-kingdom/awin-125462-f3219-2026-09-13.csv");
const RAW = readFileSync(FEED, "utf8");
const TODAY = "2026-09-14";

const table = () => {
  const read = csvAdapter.read(RAW, Buffer.byteLength(RAW, "utf8"));
  if (!read.ok) throw new Error(read.reason);
  return read.table;
};
const TABLE = table();

/** The same table, written back out, so a test can change one cell of a real feed. */
function toCsv(rows: Record<string, string>[], columns: string[]): string {
  const quote = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns.map(quote).join(","), ...rows.map((r) => columns.map((c) => quote(r[c] ?? "")).join(","))].join("\n");
}

const temps: string[] = [];
function workspace(): IngestionStore {
  const dir = mkdtempSync(join(tmpdir(), "ingestion-"));
  temps.push(dir);
  return new IngestionStore(dir);
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A seeded store with the source and an approved v1, which is what an import needs. */
function seeded(): IngestionStore {
  const store = workspace();
  store.saveSource(SWEAT_KINGDOM);
  store.saveProfile(FIRST_PROFILE(1, TODAY));
  store.approveProfile(SWEAT_KINGDOM.id, 1, "reviewer", TODAY);
  return store;
}

// --------------------------------------------------------------- the adapter

describe("the adapter boundary", () => {
  it("reads CSV and refuses every other format by name rather than guessing", () => {
    expect(adapterFor("csv").ok).toBe(true);
    for (const format of ["xlsx", "xml", "json", "api"] as const) {
      const result = adapterFor(format);
      expect(result.ok, format).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/does not read/);
    }
  });

  it("offers the unimplemented formats as choices, marked unsupported", () => {
    const options = formatOptions();
    expect(options.filter((o) => o.supported).map((o) => o.format)).toEqual(["csv"]);
    expect(options).toHaveLength(5);
  });

  it("turns the real feed into named columns and rows", () => {
    expect(TABLE.rows).toHaveLength(225);
    expect(TABLE.columns).toHaveLength(62);
    expect(TABLE.columns).toContain("aw_deep_link");
    expect(TABLE.rows[0].price).toMatch(/^\d+\.\d\d USD$/);
  });
});

// --------------------------------------------------------------- suggestions

describe("suggesting a first mapping", () => {
  it("matches headings this project wrote down and leaves the rest unmapped", () => {
    const suggestion = suggestColumns(TABLE.columns);
    const byTarget = Object.fromEntries(suggestion.columns.map((c) => [c.target, c.column]));
    expect(byTarget.name).toBe("title");
    expect(byTarget.price).toBe("price");
    expect(byTarget.image).toBe("image_link");
    // The issued tracking link, not the plain merchant address beside it.
    expect(byTarget.link).toBe("aw_deep_link");
    expect(suggestion.grouping).toEqual({ mode: "url_path", column: "link", representative: "cheapest" });
    expect(suggestion.unmapped.length).toBeGreaterThan(40);
  });

  it("suggests nothing for a heading nobody wrote down", () => {
    const suggestion = suggestColumns(["prod_ttl", "amt", "pic"]);
    expect(suggestion.columns).toEqual([]);
  });
});

// ----------------------------------------------------------------- normalise

describe("normalising a partner's value", () => {
  const type = saunas.attributeDefinitions.find((d) => d.key === "sauna_type")!;
  const kw = saunas.attributeDefinitions.find((d) => d.key === "heater_kw")!;
  const seats = saunas.attributeDefinitions.find((d) => d.key === "capacity_max_people")!;

  it("treats an empty cell as unknown rather than as a value", () => {
    expect(normaliseAttribute("", type).ok).toBe("empty");
    expect(normaliseAttribute("   ", seats).ok).toBe("empty");
  });

  it("refuses a word outside the enum instead of matching the nearest option", () => {
    const result = normaliseAttribute("Infrared", type);
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.reason).toContain("far_infrared");
  });

  it("accepts the same word through a value map somebody typed", () => {
    expect(normaliseAttribute("Infrared", type, { Infrared: "far_infrared" })).toMatchObject({ ok: true, value: "far_infrared" });
  });

  it("refuses a figure stated in another unit rather than converting it", () => {
    expect(normaliseAttribute("7.5 kW", kw)).toMatchObject({ ok: true, value: 7.5 });
    const watts = normaliseAttribute("7500 W", kw);
    expect(watts.ok).toBe(false);
    if (watts.ok === false) expect(watts.reason).toContain("refused");
  });

  it("refuses a decimal where the category holds whole numbers", () => {
    expect(normaliseAttribute("2.5", seats).ok).toBe(false);
  });

  it("reads the one price shape this feed uses, and refuses a bare amount", () => {
    expect(readPrice("5145.00 USD")).toMatchObject({ ok: true, minor: 514500, currency: "USD" });
    const bare = readPrice("5145.00");
    expect(bare.ok).toBe(false);
    if (bare.ok === false) expect(bare.reason).toContain("No currency");
    // A symbol names no country's money.
    expect(readPrice("$5145.00").ok).toBe(false);
  });

  it("takes the merchant's stock word or refuses it, and never reads one out of prose", () => {
    expect(readAvailability("out_of_stock")).toMatchObject({ ok: true, value: "out_of_stock" });
    const ships = readAvailability("Ships in 5 weeks");
    expect(ships.ok).toBe(false);
    if (ships.ok === false) expect(ships.reason).toContain("value map");
  });
});

// ---------------------------------------------------------------- extraction

describe("extraction rules", () => {
  const seats = saunas.attributeDefinitions.find((d) => d.key === "capacity_max_people")!;
  const rule = { from: "extract" as const, key: "capacity_max_people", column: "title", pattern: "(\\d+)\\s*-?\\s*person", flags: "i", ownership: "review_on_change" as const, approved: false };

  it("shows a value and does not write it while the rule is unapproved", () => {
    const result = applyExtraction(rule, "The Sweat Box 1 Person Sauna", seats);
    expect(result.value).toBe(1);
    expect(result.reviewState).toBe("needs_approval");
    expect(result.notes.join(" ")).toContain("not approved");
  });

  it("says whether it read the whole cell or found something inside prose", () => {
    expect(applyExtraction({ ...rule, approved: true }, "2 Person", seats).confidence).toBe("whole_cell");
    const prose = applyExtraction({ ...rule, approved: true }, "A roomy 2 person cabin with generous headroom", seats);
    expect(prose.confidence).toBe("in_prose");
    expect(prose.notes.join(" ")).toContain("Prose is where a partner sells the product");
  });

  it("keeps the source text and exactly what it matched, for the person approving it", () => {
    const result = applyExtraction({ ...rule, approved: true }, "The Ascent 3-Person Sauna", seats);
    expect(result.sourceText).toBe("The Ascent 3-Person Sauna");
    expect(result.matchedText).toBe("3");
    expect(result.reviewState).toBe("approved");
  });

  it("refuses a match the attribute cannot hold", () => {
    const words = { ...rule, approved: true, pattern: "(\\w+)\\s*-?\\s*person" };
    const result = applyExtraction(words, "The Ascent Three-Person Sauna", seats);
    expect(result.reviewState).toBe("refused");
    expect(result.value).toBeUndefined();
  });

  it("finds nothing rather than something, where the title says nothing", () => {
    expect(applyExtraction(rule, "The Summit Sauna", seats).reviewState).toBe("no_match");
  });
});

describe("patterns a profile will accept", () => {
  it("needs exactly one capture group", () => {
    expect(compilePattern("(\\d+)", "i").ok).toBe(true);
    expect(compilePattern("\\d+", "i").ok).toBe(false);
    expect(compilePattern("(\\d+)x(\\d+)", "i").ok).toBe(false);
  });

  it("refuses a repeated group inside a repetition, and says why", () => {
    const result = compilePattern("(a+)+b", "i");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("exponential");
  });

  it("refuses something that is not a pattern at all", () => {
    expect(compilePattern("(unclosed", "i").ok).toBe(false);
  });
});

// ------------------------------------------------------------------- profile

describe("checking a profile against a file and a category", () => {
  const category = saunas;

  it("passes the seeded Sweat Kingdom mapping against the real feed", () => {
    expect(checkProfile(FIRST_PROFILE(1, TODAY), TABLE.columns, category.attributeDefinitions.map((d) => d.key))).toEqual([]);
  });

  it("refuses an attribute the category does not define, rather than adding one", () => {
    const profile = MappingProfile.parse({ ...FIRST_PROFILE(1, TODAY), attributes: [{ from: "column", key: "wood_type", column: "title", ownership: "feed" }] });
    const problems = checkProfile(profile, TABLE.columns, category.attributeDefinitions.map((d) => d.key));
    expect(problems.map((p) => p.message).join(" ")).toContain("never adds one");
  });

  it("names a column the file does not have instead of reading it as empty", () => {
    const problems = checkProfile(FIRST_PROFILE(1, TODAY), TABLE.columns.filter((c) => c !== "price"), category.attributeDefinitions.map((d) => d.key));
    expect(problems.some((p) => p.where === "columns.price")).toBe(true);
  });

  it("refuses two columns claiming one field", () => {
    const profile = MappingProfile.parse({
      ...FIRST_PROFILE(1, TODAY),
      columns: [...FIRST_PROFILE(1, TODAY).columns, { target: "name", column: "description", ownership: "feed" }],
    });
    expect(checkProfile(profile, TABLE.columns, category.attributeDefinitions.map((d) => d.key)).some((p) => p.where === "columns.name")).toBe(true);
  });
});

// ------------------------------------------------------------------ building

describe("reading the real feed through the seeded profile", () => {
  const built = buildCandidates(TABLE, FIRST_PROFILE(1, TODAY), SWEAT_KINGDOM, saunas);

  it("drops every row the feed does not classify as a sauna, and says which rule did it", () => {
    expect(built.excluded.length).toBeGreaterThan(0);
    expect(built.excluded.length + built.candidates.reduce((n, c) => n + c.rows.length, 0)).toBe(225);
    expect(new Set(built.excluded.map((e) => e.column))).toEqual(new Set(["google_product_category"]));
    expect(built.excluded[0].reason).toContain("blank category is not a yes");
  });

  it("makes 17 products out of 225 rows, because a page is a product and a row is a configuration", () => {
    expect(built.candidates).toHaveLength(17);
    expect(built.candidates.every((c) => c.failures.length === 0)).toBe(true);
  });

  it("derives ids the catalogue already uses for the five records imported by hand", () => {
    const ids = built.candidates.map((c) => c.id);
    for (const id of ["sweat-kingdom-the-ascent", "sweat-kingdom-the-summit", "sweat-kingdom-the-sweat-box-1-person"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("represents a group by its cheapest row and writes the choice down", () => {
    const big = built.candidates.find((c) => c.rows.length > 1)!;
    expect(big.groupNote).toMatch(/Chosen from \d+ rows/);
    expect(big.groupNote).toContain("cheapest");
  });

  it("writes only what the two approved rules read out of the retailer's model names", () => {
    for (const candidate of built.candidates) {
      const written = Object.keys(candidate.fields).filter((k) => k.startsWith("attr:"));
      for (const key of written) expect(["attr:capacity_max_people", "attr:sauna_style"], candidate.id).toContain(key);
      // Capacity is in every model name; style is in nine of the fifteen.
      expect(written, candidate.id).toContain("attr:capacity_max_people");
    }
    // Eleven of the seventeen source records name a shape: nine of the fifteen
    // models, plus the two blackout configurations of two of them.
    const styled = built.candidates.filter((c) => c.fields["attr:sauna_style"] !== undefined);
    expect(styled).toHaveLength(11);
  });

  it("keeps the rule, the whole title and the match beside every value it writes", () => {
    for (const candidate of built.candidates) {
      for (const [key, derivation] of Object.entries(candidate.derivations)) {
        expect(derivation.field, `${candidate.id}.${key}`).toBe("title");
        expect(derivation.reviewState, `${candidate.id}.${key}`).toBe("approved");
        expect(derivation.sourceText, `${candidate.id}.${key}`).toContain(derivation.matched);
      }
    }
  });

  it("writes nothing from a rule nobody approved", () => {
    const unapproved = MappingProfile.parse({
      ...FIRST_PROFILE(1, TODAY),
      attributes: [{ from: "extract", key: "capacity_max_people", column: "title", pattern: "(\\d+)\\s*Person", flags: "", ownership: "review_on_change", approved: false }],
    });
    const out = buildCandidates(TABLE, unapproved, SWEAT_KINGDOM, saunas);
    for (const candidate of out.candidates) {
      expect(Object.keys(candidate.fields).filter((k) => k.startsWith("attr:")), candidate.id).toEqual([]);
      expect(candidate.extractions[0]?.reviewState, candidate.id).toBe("needs_approval");
    }
  });

  it("takes the issued tracking link and never the plain merchant address", () => {
    for (const candidate of built.candidates) {
      expect(String(candidate.fields.link), candidate.id).toMatch(/^https:\/\/www\.awin1\.com\//);
    }
  });
});

// ----------------------------------------------------------------- preflight

describe("what the report says before anything is written", () => {
  const report = () =>
    preflight({
      table: TABLE,
      profile: FIRST_PROFILE(1, TODAY),
      source: SWEAT_KINGDOM,
      category: saunas,
      fileName: "awin-125462-f3219-2026-09-13.csv",
      today: TODAY,
      workspace: new Map(),
      catalogIds: new Set(["sweat-kingdom-the-ascent"]),
      snapshot: {},
    });

  it("refuses to let an unapproved mapping import, and says so as a blocker", () => {
    expect(report().blockers.join(" ")).toContain("has not been approved");
  });

  it("reports filter coverage honestly: a price, and nothing else", () => {
    const coverage = Object.fromEntries(report().filterCoverage.map((c) => [c.key, c]));
    expect(coverage.price.covered).toBe("price");
    expect(coverage.price.withValue).toBe(17);
    for (const key of ["sauna_type", "connection", "placement"]) {
      expect(coverage[key].covered, key).toBe("unmapped");
      expect(coverage[key].withValue, key).toBe(0);
    }
    // Filled by approved rules over the retailer's own model names.
    expect(coverage.capacity_max_people.covered).toBe("extracted");
    expect(coverage.capacity_max_people.withValue).toBe(17);
    expect(coverage.sauna_style.covered).toBe("extracted");
    expect(coverage.sauna_style.withValue).toBe(11);
  });

  it("says which records would shadow one the catalogue already holds", () => {
    const shadowed = report().plans.filter((p) => p.shadowsCatalog).map((p) => p.id);
    expect(shadowed).toEqual(["sweat-kingdom-the-ascent"]);
  });

  it("calls every record an addition when the workspace is empty", () => {
    expect(report().counts.added).toBe(17);
    expect(report().counts.changed + report().counts.conflict + report().counts.unchanged).toBe(0);
  });

  it("says this source has never been refreshed rather than guessing a date", () => {
    expect(report().lastSuccessfulRefresh).toBeUndefined();
    expect(report().stalenessDays).toBeUndefined();
  });
});

// --------------------------------------------------------------- the merge

describe("who owns a field when the same file arrives again", () => {
  const meta = {
    name: { label: "Name", ownership: "review_on_change" as const, provenance: "direct" as const },
    description: { label: "Description", ownership: "feed" as const, provenance: "direct" as const },
    brand: { label: "Brand", ownership: "editorial" as const, provenance: "direct" as const },
  };
  const merge = (incoming: Record<string, unknown>, current: Record<string, unknown>, last?: Record<string, unknown>) =>
    mergeRecord({ incoming, incomingNotes: {}, incomingDerivations: {}, meta, current: { fields: current, notes: {}, derivations: {} }, last });
  const outcome = (r: ReturnType<typeof merge>, key: string) => r.outcomes.find((o) => o.key === key)!;

  it("writes a feed-owned field when the record still says what the last import wrote", () => {
    const result = merge({ description: "new" }, { description: "old" }, { description: "old" });
    expect(outcome(result, "description").outcome).toBe("written");
    expect(result.fields.description).toBe("new");
    expect(result.action).toBe("changed");
  });

  it("holds a feed-owned field the file has not moved, so a local correction stands", () => {
    const result = merge({ description: "old" }, { description: "corrected" }, { description: "old" });
    expect(outcome(result, "description").outcome).toBe("held_local");
    expect(result.fields.description).toBe("corrected");
  });

  it("queues a conflict when both the file and this site have moved", () => {
    const result = merge({ description: "newer" }, { description: "corrected" }, { description: "old" });
    expect(outcome(result, "description").outcome).toBe("conflict");
    expect(result.fields.description).toBe("corrected");
    expect(result.action).toBe("conflict");
  });

  it("never changes an editorial field, whatever the file says", () => {
    const result = merge({ brand: "theirs" }, { brand: "ours" }, { brand: "theirs" });
    expect(outcome(result, "brand").outcome).toBe("held_editorial");
    expect(result.fields.brand).toBe("ours");
  });

  it("queues a review-on-change field rather than applying it", () => {
    const result = merge({ name: "Their new title" }, { name: "Our title" }, { name: "Their old title" });
    expect(outcome(result, "name").outcome).toBe("review");
    expect(result.fields.name).toBe("Our title");
  });

  it("leaves a review-on-change field alone when the file has not moved", () => {
    const result = merge({ name: "Their title" }, { name: "Our title" }, { name: "Their title" });
    expect(outcome(result, "name").outcome).toBe("held_local");
  });

  it("queues rather than writes when there is no record of the last import", () => {
    const result = merge({ description: "new" }, { description: "old" }, undefined);
    expect(outcome(result, "description").outcome).toBe("review");
    expect(result.fields.description).toBe("old");
  });

  it("never blanks a field the file has stopped carrying", () => {
    const result = merge({}, { description: "kept" }, { description: "kept" });
    expect(outcome(result, "description").outcome).toBe("withdrawn");
    expect(result.fields.description).toBe("kept");
  });

  it("keeps a conflict reported until somebody changes one side of it", () => {
    const first = merge({ description: "newer" }, { description: "corrected" }, { description: "old" });
    const snapshot = nextSnapshot(first.outcomes, { description: "old" });
    // The snapshot still says what the last import wrote, not what the file
    // says now, so the same conflict comes back next time.
    expect(snapshot.description).toBe("old");
    const again = merge({ description: "newer" }, { description: "corrected" }, snapshot);
    expect(outcome(again, "description").outcome).toBe("conflict");
  });
});

// -------------------------------------------------------------------- store

describe("what the workspace stores", () => {
  it("refuses an upload that looks like it carries a credential, and writes nothing", () => {
    const store = seeded();
    const result = store.saveUpload(SWEAT_KINGDOM.id, "feed.csv", "url\nhttps://productdata.awin.com/datafeed/download/apikey=abcd1234efgh5678/fid/3219/feed.csv\n", TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("looks like it carries a credential");
    expect(store.uploads(SWEAT_KINGDOM.id)).toEqual([]);
  });

  it("finds the shapes a feed actually leaks and leaves an ordinary product row alone", () => {
    expect(findCredentials("api_key: 9f8e7d6c5b4a3210")).toHaveLength(1);
    expect(findCredentials("Authorization: Bearer abcdefghijklmnop")).toHaveLength(1);
    expect(findCredentials("The Ascent,5145.00 USD,https://sweatkingdom.com/products/the-ascent")).toEqual([]);
  });

  it("keeps the real feed, named by its own content hash", () => {
    const store = seeded();
    const saved = store.saveUpload(SWEAT_KINGDOM.id, "awin-125462-f3219-2026-09-13.csv", RAW, TODAY);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.hash).toBe("9db0be0014d640489585346d4776760458e8c5d2b136dc9490dcd03da726bb6d");
    expect(store.uploads(SWEAT_KINGDOM.id)).toHaveLength(1);
  });

  it("writes a profile version once and refuses to edit one in place", () => {
    const store = seeded();
    expect(() => store.saveProfile(FIRST_PROFILE(1, TODAY))).toThrow(/written once/);
  });

  it("refuses to approve the same version twice", () => {
    const store = seeded();
    expect(() => store.approveProfile(SWEAT_KINGDOM.id, 1, "somebody else", TODAY)).toThrow(/already approved/);
  });

  it("builds no filename from anything that is not a record id", () => {
    const store = workspace();
    expect(() => store.source("../../etc/passwd")).toThrow(/not a record id/);
  });
});

// ------------------------------------------------------------- the full run

describe("importing, editing and importing again", () => {
  it("refuses an import from a mapping nobody approved", () => {
    const store = workspace();
    store.saveSource(SWEAT_KINGDOM);
    store.saveProfile(FIRST_PROFILE(1, TODAY));
    const outcome = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]).toContain("two decisions");
    expect(store.drafts().products).toEqual([]);
  });

  it("writes drafts, and only drafts, in a directory the site does not read", () => {
    const store = seeded();
    const outcome = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.written).toHaveLength(17);
    const drafts = store.drafts();
    expect(drafts.products.every((p) => p.status === "draft")).toBe(true);
    expect(drafts.products.every((p) => p.categoryId === "saunas")).toBe(true);
    expect(drafts.merchants.map((m) => m.id)).toEqual(["sweat-kingdom-store"]);
    expect(store.state(SWEAT_KINGDOM.id).lastSuccessfulRefresh).toBe(TODAY);
  });

  it("records the issued link as an affiliate link and claims no right to the image", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    for (const product of store.drafts().products) {
      expect(product.offers[0].affiliate).toMatchObject({ status: "affiliate", network: "awin", programRef: "awin-advertiser-125462-publisher-3090899" });
      expect(product.offers[0].url).toMatch(/^https:\/\/www\.awin1\.com\//);
      expect(product.images[0].kind).toBe("affiliate_feed");
      expect(product.images[0].license).toBeUndefined();
      expect(product.images[0].source?.note).toContain("not a grant to publish it");
    }
  });

  it("says a maker's claim reached us through a shop, on every attribute it writes", () => {
    // The seeded profile writes none, because the feed states none. This holds
    // the rule for the day one is approved: `catalog.test.ts` refuses a record
    // claiming a direct reading of the maker from anywhere but the maker.
    const store = seeded();
    const approved = MappingProfile.parse({ ...FIRST_PROFILE(2, TODAY), attributes: [{ from: "extract", key: "capacity_max_people", column: "title", pattern: "(\\d+)\\s*-?\\s*person", flags: "i", ownership: "review_on_change", approved: true }] });
    store.saveProfile(approved);
    store.approveProfile(SWEAT_KINGDOM.id, 2, "reviewer", TODAY);
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 2, fileName: "feed.csv", text: RAW, today: TODAY });
    const withCapacity = store.drafts().products.filter((p) => p.attributes.capacity_max_people?.value !== undefined);
    expect(withCapacity.length).toBeGreaterThan(0);
    for (const product of withCapacity) {
      expect(product.attributes.capacity_max_people.verification).toBe("manufacturer_reported");
      expect(product.attributes.capacity_max_people.source.kind).toBe("merchant_feed");
      expect(product.attributes.capacity_max_people.source.method).toBe("secondhand");
      expect(product.attributes.capacity_max_people.source.note).toContain("approved by a person");
    }
  });

  it("changes nothing on a second run of the same file", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const second = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: "2026-09-15" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.counts.unchanged).toBe(17);
    expect(second.written).toEqual([]);
    expect(second.report.stalenessDays).toBe(1);
  });

  it("keeps an editorial edit through the next import of the same file", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const id = "sweat-kingdom-the-ascent";
    const before = store.draft(id)!;
    const edited = applyEditorialEdit(before, { name: "The Ascent (2-3 person infrared cabin)" }, { by: "editor", on: TODAY });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    store.writeDraft("products", id, edited.product);

    const second = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: "2026-09-15" });
    expect(second.ok).toBe(true);
    expect(store.draft(id)!.name).toBe("The Ascent (2-3 person infrared cabin)");
    if (!second.ok) return;
    const plan = second.report.plans.find((p) => p.id === id)!;
    expect(plan.outcomes.find((o) => o.key === "name")!.outcome).toBe("held_local");
  });

  it("queues a conflict when the partner moves a field somebody edited here", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const id = "sweat-kingdom-the-ascent";
    const edited = applyEditorialEdit(store.draft(id)!, { description: "Rewritten here while the partner's own copy was unclear." }, { by: "editor", on: TODAY });
    if (!edited.ok) return;
    store.writeDraft("products", id, edited.product);

    // The partner's next file says something different again. Description is
    // feed-owned, so without the snapshot this would silently take the new one.
    const moved = toCsv(
      TABLE.rows.map((r) => (r.link.includes("/products/the-ascent") ? { ...r, description: `${r.description} Now shipping with a WiFi controller.` } : r)),
      TABLE.columns,
    );
    const second = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed-2.csv", text: moved, today: "2026-09-15" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const plan = second.report.plans.find((p) => p.id === id)!;
    expect(plan.action).toBe("conflict");
    expect(plan.outcomes.find((o) => o.key === "description")!.outcome).toBe("conflict");
    expect(store.draft(id)!.description).toContain("Rewritten here");
  });

  it("reports a record the file has stopped carrying and deletes nothing", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const shorter = toCsv(TABLE.rows.filter((r) => !r.link.includes("/products/the-summit")), TABLE.columns);
    const second = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed-3.csv", text: shorter, today: "2026-09-15" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.withdrawn).toContain("sweat-kingdom-the-summit");
    expect(store.draft("sweat-kingdom-the-summit")).toBeDefined();
  });
});

// ------------------------------------------------------- comparison families

describe("the editorial family layer", () => {
  const report = (profile = FIRST_PROFILE(1, TODAY)) =>
    preflight({
      table: TABLE,
      profile,
      source: SWEAT_KINGDOM,
      category: saunas,
      fileName: "awin-125462-f3219-2026-09-13.csv",
      today: TODAY,
      workspace: new Map(),
      catalogIds: new Set(),
      snapshot: {},
    });

  it("keeps all 17 source pages and compares 15 of them", () => {
    const r = report();
    expect(r.sourceRecords).toBe(17);
    expect(r.plans).toHaveLength(17);
    expect(r.comparisonFamilies).toHaveLength(15);
  });

  it("puts each blackout edition under the model it is a finish of", () => {
    const families = Object.fromEntries(report().comparisonFamilies.map((f) => [f.id, f.members.map((m) => m.id)]));
    expect(families["sweat-kingdom-the-sweat-cabin"]).toEqual(["sweat-kingdom-the-sweat-cabin-blackout-edition"]);
    expect(families["sweat-kingdom-the-sweat-pod"]).toEqual(["sweat-kingdom-the-sweat-pod-blackout-edition"]);
    // And nothing else was folded into anything.
    expect(Object.values(families).flat()).toHaveLength(2);
  });

  it("says why, in the words of the person who decided it", () => {
    const cabin = report().comparisonFamilies.find((f) => f.id === "sweat-kingdom-the-sweat-cabin")!;
    expect(cabin.members[0].because).toContain("blackout finish");
  });

  it("leaves every member a record with its own price, stock, picture and issued link", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const member = store.draft("sweat-kingdom-the-sweat-cabin-blackout-edition")!;
    const head = store.draft("sweat-kingdom-the-sweat-cabin")!;
    expect(member.family).toEqual({ of: "sweat-kingdom-the-sweat-cabin", because: expect.stringContaining("blackout finish") });
    expect(head.family).toBeUndefined();
    // A blackout finish costs more, and the record says so rather than
    // inheriting the model's price.
    expect(member.offers[0].priceMinor).toBe(924500);
    expect(head.offers[0].priceMinor).toBe(744500);
    expect(member.offers[0].url).not.toBe(head.offers[0].url);
    expect(member.offers[0].url).toMatch(/^https:\/\/www\.awin1\.com\//);
    expect(member.images[0].src).not.toBe(head.images[0].src);
    expect(member.offers[0].availability).toBeDefined();
    expect(member.source.ref).toContain("Mapping profile sweat-kingdom-awin v1");
  });

  it("groups the written drafts into 15 comparables by the catalogue's own rule", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const products = store.drafts().products;
    expect(products).toHaveLength(17);
    expect(comparisonCount(products)).toBe(15);
    expect(familyIssues(products)).toEqual([]);
  });

  it("keeps the grouping through a repeat import, and changes nothing", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const second = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: "2026-09-15" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.report.counts.unchanged).toBe(17);
    expect(second.report.comparisonFamilies).toHaveLength(15);
    expect(store.draft("sweat-kingdom-the-sweat-cabin-blackout-edition")!.family?.of).toBe("sweat-kingdom-the-sweat-cabin");
    expect(comparisonCount(store.drafts().products)).toBe(15);
  });

  it("keeps the grouping through a repeat import that carries an editorial edit", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const id = "sweat-kingdom-the-sweat-cabin-blackout-edition";
    const edited = applyEditorialEdit(store.draft(id)!, { name: "The Sweat Cabin, blackout" }, { by: "editor", on: TODAY });
    if (!edited.ok) return;
    store.writeDraft("products", id, edited.product);

    const second = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: "2026-09-15" });
    expect(second.ok).toBe(true);
    expect(store.draft(id)!.name).toBe("The Sweat Cabin, blackout");
    expect(store.draft(id)!.family?.of).toBe("sweat-kingdom-the-sweat-cabin");
    expect(comparisonCount(store.drafts().products)).toBe(15);
  });

  it("applies a family a later approved version adds, without rewriting anything else", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const v2 = MappingProfile.parse({
      ...FIRST_PROFILE(2, TODAY),
      families: [
        ...FIRST_PROFILE(1, TODAY).families,
        { member: "sweat-kingdom-the-sweat-cabin-deluxe-6-person-copy", family: "sweat-kingdom-the-sweat-cabin", because: "A duplicate page the merchant left up for the same cabin." },
      ],
    });
    store.saveProfile(v2);
    store.approveProfile(SWEAT_KINGDOM.id, 2, "reviewer", TODAY);
    const second = runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 2, fileName: "feed.csv", text: RAW, today: "2026-09-15" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.written).toEqual(["sweat-kingdom-the-sweat-cabin-deluxe-6-person-copy"]);
    expect(second.report.comparisonFamilies).toHaveLength(14);
    expect(comparisonCount(store.drafts().products)).toBe(14);
  });
});

describe("family rules that would be wrong", () => {
  const rules = (families: { member: string; family: string; because: string }[]) =>
    checkFamilyRules(families as Parameters<typeof checkFamilyRules>[0]);

  it("refuses a record given as a configuration of itself", () => {
    expect(rules([{ member: "a-thing", family: "a-thing", because: "why" }])[0].message).toContain("configuration of itself");
  });

  it("refuses one record belonging to two families", () => {
    const problems = rules([
      { member: "a-thing", family: "b-thing", because: "why" },
      { member: "a-thing", family: "c-thing", because: "why" },
    ]);
    expect(problems[0].message).toContain("One record belongs to one family");
  });

  it("refuses a chain, which is what makes a cycle impossible", () => {
    const problems = rules([
      { member: "a-thing", family: "b-thing", because: "why" },
      { member: "b-thing", family: "c-thing", because: "why" },
    ]);
    expect(problems.some((p) => p.message.includes("one level deep"))).toBe(true);
  });

  it("refuses a two-record cycle for the same reason", () => {
    const problems = rules([
      { member: "a-thing", family: "b-thing", because: "why" },
      { member: "b-thing", family: "a-thing", because: "why" },
    ]);
    expect(problems.some((p) => p.message.includes("one level deep"))).toBe(true);
  });

  it("names a rule pointing at a record this file does not produce", () => {
    const profile = MappingProfile.parse({
      ...FIRST_PROFILE(1, TODAY),
      families: [{ member: "sweat-kingdom-the-ascent", family: "sweat-kingdom-a-sauna-nobody-sells", because: "why" }],
    });
    const built = buildCandidates(TABLE, profile, SWEAT_KINGDOM, saunas);
    expect(built.familyProblems[0].message).toContain("no such record");
    expect(built.candidates.find((c) => c.id === "sweat-kingdom-the-ascent")!.fields.family).toBeUndefined();
  });

  it("refuses a catalogue whose records point at a missing or chained family", () => {
    const store = seeded();
    runIngestionImport({ store, catalogDir: CATALOG, sourceId: SWEAT_KINGDOM.id, version: 1, fileName: "feed.csv", text: RAW, today: TODAY });
    const products = store.drafts().products;
    const head = products.find((p) => p.id === "sweat-kingdom-the-sweat-cabin")!;
    const chained = products.map((p) => (p.id === head.id ? { ...p, family: { of: "sweat-kingdom-the-ascent", because: "invented" } } : p));
    expect(familyIssues(chained).some((i) => i.message.includes("one level deep"))).toBe(true);
    const orphaned = products.filter((p) => p.id !== head.id);
    expect(familyIssues(orphaned).some((i) => i.message.includes("there is no such record"))).toBe(true);
  });
});
