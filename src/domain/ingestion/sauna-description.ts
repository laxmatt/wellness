import type { AttributeRule } from "./profile";

/** Approved, label-anchored readings from structured specification prose. */
export const SAUNA_DESCRIPTION_RULES: AttributeRule[] = [
  { from: "extract", key: "width_in", column: "body_text", pattern: "(?:(?:Assembled|Exterior) Dimensions[^:()]{0,20}(?:\\((?:WDH|W\\s*x\\s*D\\s*x\\s*H)\\))?\\s*:?\\s*|Exterior dimensions \\(LWH\\):\\s*\\d+(?:\\.\\d+)?[\\\"”″]\\s*x\\s*)(?<![-/\\d])(\\d+(?:\\.\\d+)?)[\\\"”″]", flags: "i", ownership: "review_on_change", approved: true, approvedBy: "Matt (site owner)" },
  { from: "extract", key: "depth_in", column: "body_text", pattern: "(?:(?:Assembled|Exterior) Dimensions[^:()]{0,20}(?:\\((?:WDH|W\\s*x\\s*D\\s*x\\s*H)\\))?\\s*:?\\s*\\d+(?:\\.\\d+)?[\\\"”″]?\\s*W?\\s*x\\s*|Exterior dimensions \\(LWH\\):\\s*)(?<![-/\\d])(\\d+(?:\\.\\d+)?)[\\\"”″](?!\\s*\\+)", flags: "i", ownership: "review_on_change", approved: true, approvedBy: "Matt (site owner)" },
  { from: "extract", key: "height_in", column: "body_text", pattern: "(?:Assembled|Exterior) Dimensions[^:()]{0,20}(?:\\((?:WDH|LWH|W\\s*x\\s*D\\s*x\\s*H)\\))?\\s*:?\\s*\\d+(?:\\.\\d+)?[\\\"”″]?\\s*[WL]?\\s*x\\s*\\d+(?:\\.\\d+)?[\\\"”″]?\\s*[DW]?\\s*x\\s*(?<![-/\\d])(\\d+(?:\\.\\d+)?)[\\\"”″]", flags: "i", ownership: "review_on_change", approved: true, approvedBy: "Matt (site owner)" },
  { from: "extract", key: "voltage", column: "body_text", pattern: "(?:(?:Electrical service|Electrical requirements):\\s*|Heater size:\\s*\\d+(?:\\.\\d+)?\\s*kW,\\s*)(120|240)\\s*V", flags: "i", valueMap: { "120": "120v", "240": "240v" }, ownership: "review_on_change", approved: true, approvedBy: "Matt (site owner)" },
  { from: "extract", key: "amperage_a", column: "body_text", pattern: "(?:(?:Electrical service|Electrical requirements):\\s*(?:120|240)\\s*V\\s*[/,]?\\s*|Heater size:\\s*\\d+(?:\\.\\d+)?\\s*kW,\\s*(?:120|240)V,\\s*)(\\d+)\\s*(?:-|)amp", flags: "i", ownership: "review_on_change", approved: true, approvedBy: "Matt (site owner)" },
  { from: "extract", key: "heater_kw", column: "body_text", pattern: "(?:(?:Heater size|Heating system):\\s*(?:Powerful\\s*)?|Harvia Stove\\s*)(\\d+(?:\\.\\d+)?)\\s*kW", flags: "i", ownership: "review_on_change", approved: true, approvedBy: "Matt (site owner)" },
  { from: "extract", key: "heater_model", column: "body_text", pattern: "(Harvia\\s+(?:(?!Features|Specifications|Digital|for\\b)[^.;:\\s]+\\s+){0,8}(?:Stove|Heater)|stove with built-in controls)", flags: "i", ownership: "review_on_change", approved: true, approvedBy: "Matt (site owner)" },
];

export type ExtractedSaunaSpec = { key: string; value: string | number; matched: string; pattern: string };

export function extractSaunaDescription(text: string): ExtractedSaunaSpec[] {
  const out: ExtractedSaunaSpec[] = [];
  for (const rule of SAUNA_DESCRIPTION_RULES) {
    if (rule.from !== "extract") continue;
    const match = new RegExp(rule.pattern, rule.flags).exec(text);
    const captured = match?.slice(1).find(Boolean)?.trim();
    if (!captured) continue;
    const mapped = rule.valueMap?.[captured.toLowerCase()] ?? captured;
    const numeric = ["width_in", "depth_in", "height_in", "amperage_a", "heater_kw"].includes(rule.key);
    const parsed = numeric ? Number(mapped) : mapped;
    if (numeric && !Number.isFinite(parsed)) continue;
    out.push({ key: rule.key, value: parsed, matched: match![0], pattern: rule.pattern });
  }
  // LWH is the one supported layout whose first number is depth, not width.
  // Keep the mapping-profile regexes single-capture and handle that explicit
  // label here so the dimensions cannot be silently swapped.
  const lwhPattern = "Exterior dimensions \\(LWH\\):\\s*(\\d+(?:\\.\\d+)?)[\\\"”″](?!\\s*\\+)\\s*x\\s*(\\d+(?:\\.\\d+)?)[\\\"”″]\\s*x\\s*(\\d+(?:\\.\\d+)?)[\\\"”″]";
  const lwh = new RegExp(lwhPattern, "i").exec(text);
  if (lwh) {
    const matched = lwh[0];
    for (const [key, capture] of [["width_in", 2], ["depth_in", 1], ["height_in", 3]] as const) {
      const value = Number(lwh[capture]);
      const fact = { key, value, matched, pattern: lwhPattern };
      const index = out.findIndex((entry) => entry.key === key);
      if (index >= 0) out[index] = fact;
      else out.push(fact);
    }
  }
  const dimensions = new Set(out.filter((entry) => ["width_in", "depth_in", "height_in"].includes(entry.key)).map((entry) => entry.key));
  // A lone number near an exterior-dimensions heading can be a diameter,
  // overhang, or a mixed-number fragment. Publish a rectangular footprint only
  // when the source supports the complete three-axis set.
  return dimensions.size === 0 || dimensions.size === 3
    ? out
    : out.filter((entry) => !["width_in", "depth_in", "height_in"].includes(entry.key));
}
