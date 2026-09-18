/**
 * The Sweat Kingdom source and a first mapping, written into the local
 * ingestion workspace.
 *
 *   npm run ingestion:seed
 *
 * A convenience, not a fixture. Everything it writes is something an
 * administrator would type into the tool, and the tool can do all of it: this
 * exists so the walkthrough starts from a real partner instead of fifteen
 * minutes of form filling.
 *
 * Two things it deliberately does not do.
 *
 * **It approves nothing.** The mapping lands as version 1, unapproved, and an
 * import refuses it until somebody approves it in the tool and signs their
 * name. An approval seeded by a script is not an approval.
 *
 * **It writes no attribute this feed does not state.** The feed carries 62
 * columns and not one specification: no dimensions, no power, no capacity, no
 * material. The one extraction rule here reads a capacity out of the product
 * title, it is left unapproved, and the point of it in the walkthrough is to
 * show what an unapproved rule looks like and that nothing it produces is
 * written. A number found in a marketing title is not a specification.
 */

import { MappingProfile, PartnerSource } from "@/domain/ingestion/profile";
import { IngestionStore } from "@/providers/ingestion/IngestionStore";
import { ingestionRoot } from "@/providers/ingestion/root";

const store = new IngestionStore(ingestionRoot());

export const SWEAT_KINGDOM = PartnerSource.parse({
  id: "sweat-kingdom-awin",
  name: "Sweat Kingdom (Awin advertiser 125462, feed F3219)",
  format: "csv",
  merchantId: "sweat-kingdom-store",
  merchantName: "Sweat Kingdom",
  merchantWebsite: "https://sweatkingdom.com",
  categoryId: "saunas",
  // A shop, selling other makers' cabins as well as its own. A specification in
  // this feed is somebody's claim reaching us through them.
  relationship: "retailer",
  idPrefix: "sweat-kingdom",
  defaultBrand: "Sweat Kingdom",
  affiliate: {
    status: "affiliate",
    network: "awin",
    programRef: "awin-advertiser-125462-publisher-3090899",
    // The network issued these links. No link is composed here, and a row
    // arriving without one is refused rather than pointed somewhere else.
    linkPrefix: "https://www.awin1.com/",
  },
  allowQuoteOnly: false,
  notes: "Approved 2026-09-13 by email. The feed is downloaded from an address carrying an API key; that address is not recorded here or anywhere in this repository.",
});

export const FIRST_PROFILE = (version: number, on: string): MappingProfile =>
  MappingProfile.parse({
    sourceId: SWEAT_KINGDOM.id,
    version,
    format: "csv",
    createdOn: on,
    createdBy: "seed script",
    note: "Mapping of the Awin feed as it arrived on 2026-09-13. 17 source pages, 15 comparable models: two of the pages are blackout finishes of two others. Model name, capacity and style are read from the retailer's own title by approved rules; the whole title is kept on every record.",
    grouping: {
      // 225 rows share 38 merchant product pages. `item_group_id` is empty on
      // every row, so the page is the only grouping the feed carries, and it is
      // the merchant's own rather than one invented here.
      mode: "url_path",
      column: "link",
      representative: "cheapest",
    },
    columns: [
      {
        target: "name",
        column: "title",
        ownership: "review_on_change",
        // A title is a model and a configuration in one string:
        // "The Sweat Cabin (4 Person) - Blackout Edition - Harvia 8kw KIP / 6 Feet".
        // Everything up to the first " - " is the model, and the one edition
        // token that changes which thing you are buying rather than how it is
        // fitted is kept with it. The whole title stays on the record and is
        // shown on the product page.
        extract: { pattern: "^(.*?(?: - Blackout Edition)?)(?: - (?!Blackout Edition)|$)", flags: "", approved: true, approvedBy: "Matt (site owner), relayed through Codex" },
      },
      { target: "description", column: "description", ownership: "feed" },
      { target: "brand", column: "brand", ownership: "review_on_change" },
      { target: "price", column: "price", ownership: "feed" },
      { target: "availability", column: "availability", ownership: "feed" },
      { target: "image", column: "image_link", ownership: "review_on_change" },
      // The tracking link the network issued for this exact row, not the plain
      // merchant address beside it.
      { target: "link", column: "aw_deep_link", ownership: "feed" },
      { target: "merchant_sku", column: "id", ownership: "feed" },
      { target: "mpn", column: "mpn", ownership: "feed" },
    ],
    attributes: [
      {
        from: "extract",
        key: "capacity_max_people",
        column: "title",
        // The upper end of a stated capacity token: "(4 Person)" is four,
        // "(2-6 Person)" is six, "2-3 Person" is three. The first such token in
        // a title belongs to the model, because the model comes first in it;
        // configuration tokens like "Regular (2 Person)" come after and are not
        // reached. Nothing here reads a number out of a sentence.
        pattern: "(?:\\d+\\s*[-\\u2013]\\s*)?(\\d+)\\s*Person",
        flags: "",
        ownership: "review_on_change",
        approved: true,
        approvedBy: "Matt (site owner), relayed through Codex",
      },
      {
        from: "extract",
        key: "sauna_style",
        column: "title",
        // A closed vocabulary of shape words the retailer puts in its own model
        // names. Case-sensitive, so it matches the name and not a stray word,
        // and every value is translated by the map below rather than guessed.
        pattern: "(Barrel|Cabin|Pod|Box|Mobile)",
        flags: "",
        valueMap: { Barrel: "barrel", Cabin: "cabin", Pod: "pod", Box: "box", Mobile: "mobile" },
        ownership: "review_on_change",
        approved: true,
        approvedBy: "Matt (site owner), relayed through Codex",
      },
    ],
    exclusions: [
      {
        column: "google_product_category",
        op: "not_equals",
        value: "Home & Garden > Pool & Spa > Saunas",
        reason: "The feed's own classification. Accessories, covers and heaters ship in the same file, and a blank category is not a yes.",
      },
    ],
    // Two pages that are one product each, in a finish. Written out, both of
    // them, rather than matched by a rule: a pattern catching "Blackout
    // Edition" would also fold two genuinely different saunas together the day
    // their titles happened to agree, and nothing would show that it had.
    //
    // Both members keep everything that makes them a record: their own price,
    // which is higher than the plain finish, their own stock, their own
    // pictures and their own issued Awin link. What changes is what a shopper
    // is asked to choose between.
    families: [
      {
        member: "sweat-kingdom-the-sweat-cabin-blackout-edition",
        family: "sweat-kingdom-the-sweat-cabin",
        because: "\"The Sweat Cabin (4 Person) - Blackout Edition\" is the same cabin in a blackout finish. A shopper choosing a four-person cabin is not choosing between it and its own paint.",
      },
      {
        member: "sweat-kingdom-the-sweat-pod-blackout-edition",
        family: "sweat-kingdom-the-sweat-pod",
        because: "\"The Sweat Pod (2-4 Person) - Blackout Edition\" is the same pod in a blackout finish, sold in the same two sizes.",
      },
    ],
    proposedFilters: [
      { key: "heater_kw", label: "Heater output", reason: "The category compares it and this feed states it nowhere in a field. Titles name a heater model and a kW figure, which is the fitted heater rather than the sauna, so it is not read here.", proposedBy: "seed script" },
      { key: "sauna_type", label: "Heating", reason: "Nothing in this feed says infrared or traditional: neither word appears in any title, and the descriptions are prose. It stays Not stated on all 17 records.", proposedBy: "seed script" },
      { key: "placement", label: "Placement", reason: "Neither indoor nor outdoor appears anywhere in this feed. It stays Not stated on all 17 records.", proposedBy: "seed script" },
      { key: "material", label: "Wood", reason: "Not a filter this category defines. Buyers ask about cedar against hemlock, and adding it is a change to the category schema rather than to a mapping.", proposedBy: "seed script" },
    ],
  });

function main(): void {
  store.saveSource(SWEAT_KINGDOM);
  const existing = store.profiles(SWEAT_KINGDOM.id);
  if (existing.length > 0) {
    console.log(`${SWEAT_KINGDOM.name} already has ${existing.length} mapping version(s). Nothing was overwritten.`);
    return;
  }
  const profile = FIRST_PROFILE(1, new Date().toISOString().slice(0, 10));
  store.saveProfile(profile);
  console.log(`Wrote the source and mapping v1 into ingestion/.`);
  console.log(`v1 is not approved. Approve it in the tool, signing your name, before anything imports:`);
  console.log(`\n  WELLNESS_INGESTION_ADMIN=1 npm run ingestion:server\n`);
}

if (process.argv[1]?.endsWith("ingestion-seed.ts")) main();
