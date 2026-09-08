import { z } from "zod";
import { sourced } from "./provenance";

export const AttributeType = z.enum([
  "number",
  "integer",
  "boolean",
  "enum",
  "string",
  "list",
  "number_list",
]);
export type AttributeType = z.infer<typeof AttributeType>;

export const PreferenceDirection = z.enum(["higher_better", "lower_better", "neutral"]);
export type PreferenceDirection = z.infer<typeof PreferenceDirection>;

export const EnumOption = z.object({
  value: z.string(),
  label: z.string(),
  // Ordinal rank for enums with a natural order (coverage: targeted < half < full).
  rank: z.number().optional(),
});
export type EnumOption = z.infer<typeof EnumOption>;

export const AttributeDefinition = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  shortLabel: z.string().optional(),
  type: AttributeType,
  unit: z.string().optional(),
  enumOptions: z.array(EnumOption).optional(),
  group: z.string(),
  compareOrder: z.number().int(),
  filterable: z.boolean().default(false),
  preferenceDirection: PreferenceDirection.default("neutral"),
  required: z.boolean().default(false),
  showOnCard: z.boolean().default(false),
  tooltip: z.string().optional(),
  // Manufacturer claims for this attribute are commonly disputed; UI must
  // always render the verification tag next to the value.
  alwaysShowVerification: z.boolean().default(false),
});
export type AttributeDefinition = z.infer<typeof AttributeDefinition>;

export const AttributePrimitive = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.array(z.number()),
]);
export type AttributePrimitive = z.infer<typeof AttributePrimitive>;

export const AttributeValue = sourced(AttributePrimitive);
export type AttributeValue = z.infer<typeof AttributeValue>;

export const AttributeMap = z.record(z.string(), AttributeValue);
export type AttributeMap = z.infer<typeof AttributeMap>;

export function formatAttribute(def: AttributeDefinition, value: AttributePrimitive | undefined): string {
  if (value === undefined || value === null) return "Not stated";
  switch (def.type) {
    case "boolean":
      return value ? "Yes" : "No";
    case "enum": {
      const opt = def.enumOptions?.find((o) => o.value === value);
      return opt?.label ?? String(value);
    }
    case "list":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "number_list":
      return Array.isArray(value)
        ? value.map((v) => `${v}${def.unit ?? ""}`).join(", ")
        : String(value);
    case "number":
    case "integer": {
      const n = typeof value === "number" ? value : Number(value);
      if (def.unit === "USD_minor") {
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
      }
      const s = Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 1 });
      return def.unit ? `${s} ${def.unit}` : s;
    }
    default:
      return String(value);
  }
}

export function validateAttributeAgainstDefinition(
  def: AttributeDefinition,
  value: AttributePrimitive,
): string | null {
  switch (def.type) {
    case "number":
      return typeof value === "number" ? null : "expected number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value) ? null : "expected integer";
    case "boolean":
      return typeof value === "boolean" ? null : "expected boolean";
    case "string":
      return typeof value === "string" ? null : "expected string";
    case "enum": {
      if (typeof value !== "string") return "expected enum string";
      const ok = def.enumOptions?.some((o) => o.value === value);
      return ok ? null : `"${value}" is not one of ${def.enumOptions?.map((o) => o.value).join("|")}`;
    }
    case "list":
      return Array.isArray(value) && value.every((v) => typeof v === "string") ? null : "expected string[]";
    case "number_list":
      return Array.isArray(value) && value.every((v) => typeof v === "number") ? null : "expected number[]";
  }
}
