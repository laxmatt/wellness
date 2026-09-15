import { CategoryDefinition } from "../category";

/**
 * Saunas. Approved on 2026-09-13, launched on 2026-09-14.
 *
 * It launched knowing what it does not know. Every record comes from Sweat
 * Kingdom's Awin feed, that feed states no specification at all, and so no
 * sauna here carries a heating type, a footprint, a circuit or a capacity.
 * Those attributes stay defined, stay filterable, and read "Not stated" on
 * every record until somebody gets the figures from the makers. Nothing is
 * read out of a product title to fill them: a cabin sold as "2-3 Person" is a
 * name, and a name is not a specification.
 *
 * **No ranking.** `scoring.criteria` is empty and stays empty until somebody
 * establishes what would justify one. Type, footprint, power draw and price
 * separate these products, and not one of them says a sauna is better: a
 * one-person far-infrared cabin that plugs into a wall socket is not a worse
 * product than a hardwired traditional room, it is a different one. No
 * capability score, no wellness claim, and no score derived from how hard a
 * thing is to install.
 */
export const saunas = CategoryDefinition.parse({
  id: "saunas",
  slug: "saunas",
  name: "Saunas",
  navLabel: "Saunas",
  tagline: "Type, footprint and what it takes to power one.",
  intro:
    "Home saunas differ on whether they heat the air or the body, how much floor they take, what circuit they need, and what they cost. Only price is stated by the retailer these listings come from; the rest read as not stated until the makers supply them. Nothing here rates a sauna, and nothing here is a figure read out of a product name.",  images: [],
  subcategories: [],
  attributeDefinitions: [
    {
      key: "sauna_type",
      label: "Heating",
      type: "enum",
      enumOptions: [
        { value: "far_infrared", label: "Far infrared" },
        { value: "traditional", label: "Traditional (heated air)" },
        { value: "steam", label: "Steam" },
      ],
      group: "Basics",
      compareOrder: 10,
      filterable: true,
      required: true,
      showOnCard: true,
      tooltip: "Far infrared warms the body directly. A traditional sauna heats the air in the cabin.",
    },
    {
      key: "capacity_label",
      label: "Capacity",
      type: "string",
      group: "Basics",
      compareOrder: 20,
      required: true,
      showOnCard: true,
      tooltip: "The maker's own words. A cabin sold as 1-2 person is recorded as the maker states it, not rounded.",
    },
    {
      key: "sauna_style",
      label: "Style",
      type: "enum",
      enumOptions: [
        { value: "cabin", label: "Cabin" },
        { value: "barrel", label: "Barrel" },
        { value: "pod", label: "Pod" },
        { value: "box", label: "Box" },
        { value: "mobile", label: "Mobile (towable)" },
        { value: "tent", label: "Portable tent" },
      ],
      group: "Basics",
      compareOrder: 15,
      filterable: true,
      showOnCard: true,
      tooltip: "The shape the retailer sells it as, read from the model name. It says what the thing looks like and where it will go, and nothing about how well it works.",
    },
    {
      key: "capacity_max_people",
      label: "Seats up to",
      shortLabel: "Seats",
      type: "integer",
      unit: "people",
      group: "Basics",
      compareOrder: 21,
      filterable: true,
      required: true,
      tooltip: "The upper end of the maker's stated capacity, so a filter has a number to work with. More seats is not better.",
    },
    {
      key: "width_in",
      label: "Exterior width",
      type: "number",
      unit: "in",
      group: "Space",
      compareOrder: 30,
      required: true,
      showOnCard: true,
    },
    { key: "depth_in", label: "Exterior depth", type: "number", unit: "in", group: "Space", compareOrder: 31, required: true },
    { key: "height_in", label: "Exterior height", type: "number", unit: "in", group: "Space", compareOrder: 32, required: true },
    {
      key: "placement",
      label: "Placement",
      type: "enum",
      enumOptions: [
        { value: "indoor", label: "Indoor" },
        { value: "outdoor", label: "Outdoor" },
        { value: "indoor_outdoor", label: "Indoor or outdoor" },
      ],
      group: "Space",
      compareOrder: 33,
      filterable: true,
    },
    {
      key: "connection",
      label: "Connection",
      type: "enum",
      enumOptions: [
        { value: "plug_in", label: "Plugs into a wall socket" },
        { value: "hardwired", label: "Hardwired circuit" },
      ],
      group: "Power",
      compareOrder: 40,
      filterable: true,
      required: true,
      showOnCard: true,
      tooltip: "A hardwired sauna needs an electrician and a dedicated circuit. That is a cost and a decision, not a fault.",
    },
    { key: "voltage", label: "Voltage", type: "enum", enumOptions: [{ value: "120v", label: "120V" }, { value: "240v", label: "240V" }], group: "Power", compareOrder: 41, filterable: true },
    { key: "amperage_a", label: "Circuit", type: "integer", unit: "A", group: "Power", compareOrder: 42 },
    { key: "heater_kw", label: "Heater output", type: "number", unit: "kW", group: "Power", compareOrder: 43 },
    { key: "heater_model", label: "Heater", type: "string", group: "Power", compareOrder: 44 },
  ],
  cardSpecKeys: ["sauna_style", "capacity_max_people", "sauna_type"],
  compareGroups: [
    { label: "Basics", keys: ["sauna_type", "sauna_style", "capacity_label", "capacity_max_people"] },
    { label: "Space", keys: ["width_in", "depth_in", "height_in", "placement"] },
    { label: "Power", keys: ["connection", "voltage", "amperage_a", "heater_kw", "heater_model"] },
  ],
  filters: [
    {
      key: "price",
      label: "Price",
      kind: "range",
      // Four bands over the fifteen models this category actually lists, which
      // run from $5,145 to $28,500. They split 4 / 4 / 3 / 4. Bands chosen to
      // sit where the prices are, rather than at round numbers with nothing
      // between them: the old "Under $2,500" matched nothing at all.
      presets: [
        { label: "Under $7,000", condition: { key: "price", op: "lt", value: 700000 } },
        { label: "$7,000 to $10,000", condition: { key: "price", op: "gte", value: 700000 }, and: { key: "price", op: "lt", value: 1000000 } },
        { label: "$10,000 to $15,000", condition: { key: "price", op: "gte", value: 1000000 }, and: { key: "price", op: "lt", value: 1500000 } },
        { label: "$15,000 and up", condition: { key: "price", op: "gte", value: 1500000 } },
      ],
    },
    { key: "sauna_style", label: "Style", kind: "enum" },
    {
      key: "capacity_max_people",
      label: "Seats up to",
      kind: "range",
      // Bands rather than every stated number. The fifteen models state six
      // different capacities, the generic row offers four of them, and a
      // shopper choosing between a one-person box and a six-person cabin is
      // not choosing between four and five. These three cover all fifteen.
      presets: [
        { label: "1 to 2 people", condition: { key: "capacity_max_people", op: "lte", value: 2 } },
        { label: "3 to 4 people", condition: { key: "capacity_max_people", op: "gte", value: 3 }, and: { key: "capacity_max_people", op: "lte", value: 4 } },
        { label: "5 or more", condition: { key: "capacity_max_people", op: "gte", value: 5 } },
      ],
    },
    { key: "sauna_type", label: "Heating", kind: "enum" },
    { key: "connection", label: "Connection", kind: "enum" },
    { key: "placement", label: "Placement", kind: "enum" },
  ],
  // Empty, and it is the point. See the note at the top of this file.
  scoring: { criteria: [], label: "Not ranked", meaning: "Saunas are not ranked here. Nothing in this catalogue establishes that one sauna is better than another, so no score is shown and no badge is awarded.", completenessFloor: 1 },
  value: { qualityWeight: 0, affordabilityWeight: 1, priceBasis: "price", minQualityShare: 0 },
  // Never reached today: no sauna is published, and a price-tier badge needs
  // priced products. Three rather than two, because with two products a
  // "budget" badge says nothing but "the cheaper of the pair".
  badges: { priceBasis: "price", budgetMaxMinor: 250000, premiumMinMinor: 600000, minQualifying: 3, tieBreak: [] },
  insightRules: [],
  relaxationOrder: ["placement", "voltage", "sauna_style", "capacity_max_people", "connection", "sauna_type"],
  priceTiers: [
    { id: "under-2500", label: "Under $2,500", maxMinor: 250000 },
    { id: "mid-2500-6000", label: "$2,500 to $6,000", maxMinor: 600000 },
    { id: "over-6000", label: "Over $6,000" },
  ],
  facets: [],
  matcherVocabulary: {
    sauna_type: { far_infrared: ["infrared", "far infrared", "ir"], traditional: ["traditional", "finnish", "rocks"], steam: ["steam"] },
    connection: { plug_in: ["plug in", "plugs in", "standard outlet", "no electrician"], hardwired: ["hardwired", "hard wired", "dedicated circuit"] },
  },
  aliases: ["sauna", "saunas", "home sauna", "infrared sauna", "sweat room"],
});
