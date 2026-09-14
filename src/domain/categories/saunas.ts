import { CategoryDefinition } from "../category";

// Family-level comparison only. Cosmetic choices and checkout options remain
// beneath each family and never become cards or comparison dimensions.
export const saunas = CategoryDefinition.parse({
  id: "saunas", slug: "saunas", name: "Saunas", navLabel: "Saunas",
  tagline: "Compare sauna families, then choose the exact configuration with the maker.",
  intro: "Compare model-level space, capacity, heating and electrical information stated in the supplier feed. Configuration choices and final pricing are confirmed on Sweat Kingdom's product page.",
  subcategories: [{ id: "traditional", label: "Traditional" }],
  attributeDefinitions: [
    { key: "form", label: "Form / style", type: "list", group: "Model", compareOrder: 1, required: true },
    { key: "capacity", label: "Capacity range", type: "string", group: "Model", compareOrder: 2, required: true },
    { key: "placement", label: "Placement", type: "list", group: "Model", compareOrder: 3 },
    { key: "footprint", label: "Footprint", type: "string", group: "Space", compareOrder: 4 },
    { key: "heating_options", label: "Heating options", type: "list", group: "Heat and power", compareOrder: 5, required: true },
    { key: "electrical", label: "Electrical needs", type: "list", group: "Heat and power", compareOrder: 6 },
    { key: "lead_time", label: "Lead time", type: "string", group: "Buying", compareOrder: 7 },
    { key: "configuration_categories", label: "Configuration categories", type: "list", group: "Buying", compareOrder: 8 },
    { key: "standout_features", label: "Feed highlights", type: "list", group: "Buying", compareOrder: 9, alwaysShowVerification: true },
  ],
  cardSpecKeys: ["form", "capacity", "heating_options"],
  compareGroups: [
    { label: "Model", keys: ["form", "capacity", "placement"] },
    { label: "Space", keys: ["footprint"] },
    { label: "Heat and power", keys: ["heating_options", "electrical"] },
    { label: "Buying", keys: ["lead_time", "standout_features"] },
  ],
  filters: [
    { key: "price", label: "Starting price", kind: "range", presets: [{ label: "From under $5,000", condition: { key: "price", op: "lt", value: 500000 } }] },
    { key: "form", label: "Form / style", kind: "list" },
  ],
  scoring: { criteria: [{ key: "price", weight: 1 }], label: "Starting-price position", meaning: "Orders families by the lowest active configuration price in this feed. It does not measure quality, health effects or fit.", completenessFloor: 0 },
  value: { qualityWeight: 0, affordabilityWeight: 1, priceBasis: "price" },
  badges: { budgetMaxMinor: 500000, premiumMinMinor: 1000000, minQualifying: 2, tieBreak: [] },
  insightRules: [], relaxationOrder: ["price", "form"],
  priceTiers: [{ id: "entry", label: "From under $5,000", maxMinor: 500000 }, { id: "higher", label: "From $5,000 and up" }],
  facets: [], aliases: ["sauna", "saunas"],
});
