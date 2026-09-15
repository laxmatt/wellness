/**
 * The first real Select Saunas preflight, and what it let through.
 *
 * 786 rows became 737 product records, nothing was excluded, and all 737 failed
 * to build on `columns.description`. Two separate defects, and the second is
 * the one that mattered.
 *
 * The build error was the suggester: a person uploading a snapshot got a
 * mapping with no description, no image and no stock, because this project's
 * list of headings had never been shown a Shopify catalogue and `body_text`,
 * `image_src` and `available` are not names it knew.
 *
 * Zero exclusions was the rules. They leaned on `product_type not_contains
 * "sauna"`, which assumes a store files its non-saunas somewhere else. Select
 * Saunas is a sauna shop: a rain jacket, a floor kit and a tiki bar all sit
 * under a sauna product type, so every row survived and the candidate set was
 * the whole catalogue.
 *
 * The named rows below are the ones from that preflight. The real snapshot is
 * not in this environment, so they are reproduced in the fixture with the
 * classification the store gave them, which is the part that broke the rules.
 */

import { describe, expect, it } from "vitest";
import { saunas } from "@/domain/categories/saunas";
import { buildCandidates } from "@/domain/ingestion/build";
import { classifiedAs, shopifyAdapter, SHOPIFY_COLUMNS } from "@/domain/ingestion/shopify";
import { suggestColumns } from "@/domain/ingestion/suggest";
import { SELECT_SAUNAS, saunaExclusions, shopifyProfile } from "../../scripts/shopify-partners";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TODAY = "2026-09-15";
const raw = (): string => readFileSync(join(process.cwd(), "src/__tests__/fixtures/shopify/select-saunas-shopify.json"), "utf8");

const built = () => {
  const text = raw();
  const read = shopifyAdapter.read(text, Buffer.byteLength(text, "utf8"));
  if (!read.ok) throw new Error(read.reason);
  return buildCandidates(read.table, shopifyProfile(SELECT_SAUNAS, TODAY, "Select Saunas"), SELECT_SAUNAS, saunas);
};

describe("the mapping a person is offered for a Shopify snapshot", () => {
  it("maps the fields a record cannot be built without", () => {
    const suggestion = suggestColumns([...SHOPIFY_COLUMNS]);
    const by = new Map(suggestion.columns.map((c) => [c.target, c.column]));
    // The one that failed 737 records with nothing on screen to say why.
    expect(by.get("description")).toBe("body_text");
    expect(by.get("image")).toBe("image_src");
    expect(by.get("availability")).toBe("available");
    expect(by.get("name")).toBe("product_title");
    expect(by.get("brand")).toBe("vendor");
    expect(by.get("price")).toBe("price");
  });

  it("sends a shopper to the configuration, and groups on the product", () => {
    const suggestion = suggestColumns([...SHOPIFY_COLUMNS]);
    const by = new Map(suggestion.columns.map((c) => [c.target, c.column]));
    // The variant address is the configuration a shopper is being sent to.
    expect(by.get("link")).toBe("variant_url");
    expect(by.get("merchant_sku")).toBe("variant_sku");
    // The product address is the grouping: variants are configurations of one
    // model, not models of their own.
    expect(suggestion.grouping).toEqual({ mode: "url_path", column: "product_url", representative: "cheapest" });
  });

  it("is the same mapping the seed writes, so the two do not disagree", () => {
    const profile = shopifyProfile(SELECT_SAUNAS, TODAY, "Select Saunas");
    const by = new Map(profile.columns.map((c) => [c.target, c.column]));
    expect(by.get("description")).toBe("body_text");
    expect(by.get("image")).toBe("image_src");
    expect(by.get("availability")).toBe("available");
    expect(by.get("link")).toBe("variant_url");
    expect(profile.grouping).toEqual({ mode: "url_path", column: "product_url", representative: "cheapest" });
  });

  it("builds every candidate it keeps", () => {
    const out = built();
    expect(out.candidates.length).toBeGreaterThan(0);
    for (const candidate of out.candidates) {
      expect(candidate.failures, candidate.id).toEqual([]);
      expect(candidate.fields.description, candidate.id).toBeTruthy();
      expect(candidate.fields.image, candidate.id).toBeTruthy();
      expect(candidate.fields.availability, candidate.id).toBeTruthy();
    }
  });
});

describe("what the first preflight wrongly kept", () => {
  it("drops every row the real preflight let through as a sauna", () => {
    // Each of these is filed under a sauna product type by the store itself,
    // which is why the store's own classification is evidence of the aisle and
    // never evidence that a thing is a sauna.
    const out = built();
    expect(out.candidates).toHaveLength(3);
    expect(out.excluded).toHaveLength(10);
    expect(out.excluded.every((row) => row.reason.includes("complete-sauna product types"))).toBe(true);
  });

  it("keeps a complete sauna whose title brags about a door", () => {
    // "door", "window", "bench", "roof" and "band" are all parts a store sells
    // alone and features a sauna's title names. A word that appears in both is
    // not evidence, so none of them is a rule.
    const out = built();
    expect(out.candidates.map((c) => c.id)).toContain("select-saunas-dundalk-savannah-barrel-sauna");
  });

  it("keeps a sauna the store names only in its product type", () => {
    // "Harvia Solide Compact (2 Person)" says nothing about a sauna in its
    // title. The store's product type does, which is why the requirement reads
    // the classification and not the title alone.
    const out = built();
    expect(out.candidates.map((c) => c.id)).toContain("select-saunas-harvia-solide-compact");
  });

  it("would still catch an unlisted thing, because something has to say sauna", () => {
    const rules = saunaExclusions("Select Saunas");
    const first = rules[0];
    expect(first.op).toBe("not_one_of");
    expect(first.value).toContain("Indoor Infrared Sauna Kits");
    expect(first.column).toBe("product_type");
  });

  it("reads the store's own fields and never its marketing prose", () => {
    for (const rule of saunaExclusions("Select Saunas")) {
      expect(["classified_as", "product_type", "available"], rule.reason).toContain(rule.column);
    }
    for (const rule of shopifyProfile(SELECT_SAUNAS, TODAY, "Select Saunas").attributes) {
      expect(["classified_as", "product_title"], rule.key).toContain(rule.column);
    }
    // The joined field is the store's own three classification fields, and the
    // marketing paragraph is not one of them.
    const joined = classifiedAs("Barrel Sauna Rain Jacket", "Saunas", "sauna, barrel");
    expect(joined).toBe("Barrel Sauna Rain Jacket | Saunas | sauna, barrel");
    expect(joined).not.toContain("body");
  });

  it("matches words, so the tiki bar does not take the barrel saunas with it", () => {
    const out = built();
    const kept = out.candidates.map((c) => c.id);
    // "bar" excludes the tiki bar. "Barrel" is a different word.
    expect(kept).toContain("select-saunas-dundalk-savannah-barrel-sauna");
    expect(out.candidates.map((c) => c.id)).not.toContain("select-saunas-almost-heaven-tiki-bar");
  });
});

describe("filters a shopper can narrow with", () => {
  it("fills them only from the store's own title, type and tags", () => {
    const keys = shopifyProfile(SELECT_SAUNAS, TODAY, "Select Saunas").attributes.map((a) => a.key).sort();
    expect(keys).toEqual(["capacity_label", "capacity_max_people", "connection", "placement", "sauna_style", "sauna_type", "voltage"]);
  });

  it("leaves the specifications a Shopify catalogue does not carry empty", () => {
    const keys = shopifyProfile(SELECT_SAUNAS, TODAY, "Select Saunas").attributes.map((a) => a.key);
    // Real measurements, and a snapshot states none of them. An empty cell is
    // the honest answer; a number read out of a marketing paragraph is not.
    for (const absent of ["width_in", "depth_in", "height_in", "amperage_a", "heater_kw", "heater_model"]) {
      expect(keys, absent).not.toContain(absent);
    }
  });

  it("reads capacity, style and placement off the rows that state them", () => {
    const out = built();
    const savannah = out.candidates.find((c) => c.id === "select-saunas-dundalk-savannah-barrel-sauna")!;
    const read = new Map(savannah.extractions.map((e) => [e.key, e]));
    // The maker's own phrase, kept as written, and the number a filter needs.
    expect(read.get("capacity_label")?.value).toBe("6 Person");
    expect(read.get("capacity_max_people")?.value).toBe(6);
    // Translated by this profile's own value map, which is a person's table.
    expect(read.get("sauna_style")?.value).toBe("barrel");
    expect(read.get("placement")?.value).toBe("outdoor");
    // Shown, not written, until somebody approves the rule that read them.
    for (const key of ["capacity_label", "capacity_max_people", "sauna_style", "placement"]) {
      expect(read.get(key)?.reviewState, key).toBe("needs_approval");
    }
  });

  it("says nothing rather than guessing when a row states nothing", () => {
    const out = built();
    const harvia = out.candidates.find((c) => c.id === "select-saunas-harvia-solide-compact")!;
    const heating = harvia.extractions.find((e) => e.key === "sauna_type")!;
    expect(heating.reviewState).toBe("no_match");
    expect(heating.value).toBeUndefined();
    // Voltage and connection too: this store states neither, and an empty cell
    // is what the file says about them.
    for (const key of ["voltage", "connection"]) {
      expect(harvia.extractions.find((e) => e.key === key)?.reviewState, key).toBe("no_match");
    }
  });

  it("arrives unapproved, because a person has to read what it extracted", () => {
    for (const rule of shopifyProfile(SELECT_SAUNAS, TODAY, "Select Saunas").attributes) {
      if (rule.from === "extract") expect(rule.approved, rule.key).toBe(false);
    }
  });
});
