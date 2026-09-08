import { z } from "zod";
import { Condition } from "./category";

// Output of AIProvider.extractPreferences. Validated against the category's
// filter keys before use. rawText is never persisted or tracked.
export const HardConstraint = Condition;
export type HardConstraint = z.infer<typeof HardConstraint>;

export const SoftPreference = z.object({
  key: z.string(),
  direction: z.enum(["prefer_high", "prefer_low", "prefer_value"]),
  value: z.union([z.number(), z.string(), z.boolean(), z.array(z.string())]).optional(),
  weight: z.number().min(0).max(1).default(0.5),
});
export type SoftPreference = z.infer<typeof SoftPreference>;

export const PreferenceSet = z.object({
  hard: z.array(HardConstraint).default([]),
  soft: z.array(SoftPreference).default([]),
  // Phrases the extractor understood but the category does not compare.
  unmapped: z.array(z.string()).default([]),
  medicalIntent: z.boolean().default(false),
});
export type PreferenceSet = z.infer<typeof PreferenceSet>;

export type Relaxation = {
  relaxedKey: string;
  productId: string;
  // Human-readable distance from the constraint, e.g. "$180 over budget".
  distance: string;
};

export type ProductExplanation = {
  productId: string;
  fits: string[];
  misses: string[];
  softScore: number;
};

export type MatchResult = {
  bestMatchId: string | null;
  alternativeIds: string[];
  explanations: Record<string, ProductExplanation>;
  relaxations: Relaxation[];
  medicalRedirect: boolean;
};
