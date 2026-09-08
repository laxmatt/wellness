import { z } from "zod";
import { CONDITION_OPS, FilterKey } from "./category";
import { ModelMoney } from "./money-contract";
import { HardConstraint, SOFT_DIRECTIONS, SOFT_WEIGHT_RANGE, SoftPreference } from "./personalization";

// The assistant is a way to express preferences in words. It is never the only
// way: filters, comparison and product pages do the same work without it.

export const AssistantRole = z.enum(["user", "assistant"]);

export const AssistantMessage = z.object({
  role: AssistantRole,
  text: z.string().max(2000),
});
export type AssistantMessage = z.infer<typeof AssistantMessage>;

// Slots the assistant tries to fill. Each maps to real category filters, so an
// answer given in chat is the same object the filter chips produce.
export const SLOTS = ["budget", "use", "space", "preferences"] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABELS: Record<Slot, string> = {
  budget: "Budget",
  use: "Intended use",
  space: "Space",
  preferences: "Other preferences",
};

// A change the assistant would like to make. Nothing is applied until the
// shopper accepts it.
export const ProposedAction = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("apply_preferences"),
    summary: z.string(),
    hard: z.array(HardConstraint).default([]),
    soft: z.array(SoftPreference).default([]),
    // Exactly the products these constraints admit, computed by the engine
    // for THESE constraints, so applying delivers what the summary promised.
    matchingIds: z.array(z.string()).default([]),
    matchCount: z.number().int().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal("add_to_compare"),
    summary: z.string(),
    productIds: z.array(z.string()).min(1).max(4),
  }),
  z.object({
    kind: z.literal("relax_constraint"),
    summary: z.string(),
    // The constraint to drop, by filter key.
    key: z.string(),
  }),
]);
export type ProposedAction = z.infer<typeof ProposedAction>;

export type EvidenceTier = "sourced" | "manufacturer_claim" | "not_stated";

export type AssistantProductRef = {
  productId: string;
  slug: string;
  name: string;
  brand: string;
  price: string;
  priceIsPlaceholder: boolean;
  fits: string[];
  misses: string[];
  // Rendered by the site from its own records, with attribution. Never
  // written by the model.
  facts: { label: string; value: string; attribution: string }[];
};

export type AssistantReply = {
  // Prose shown to the shopper. Never contains a ranking the engine did not make.
  text: string;
  // Whether a real model produced this reply or the built-in scripted stand-in.
  mode: "live" | "prototype" | "unavailable";
  // Question the assistant is waiting on, if any.
  question?: { text: string; options: string[] };
  products: AssistantProductRef[];
  // Every product satisfying the agreed hard constraints, in personalized
  // order. The page filters by this rather than approximating it with chips.
  matchingIds: string[];
  // Products that could not be confirmed against a price constraint because
  // their price is unverified. Shown apart, with the reason.
  unconfirmedPrice: AssistantProductRef[];
  proposals: ProposedAction[];
  // Constraints currently held for this session, in words, each removable.
  activeConstraints: { key: string; label: string }[];
  medicalRedirect: boolean;
  // Written by the site's own code from the engine's count, on every reply,
  // beside the cards it describes. True by construction: it is not derived
  // from anything the model said. The prose above it is screened against this,
  // but the screen is a heuristic and this sentence is the guarantee.
  matchSummary: string;
  // Set when the model answered and nothing usable came back. The reply then
  // carries the shopper's existing preferences unchanged and proposes nothing,
  // because a reply that could not be read is not a request to change
  // anything.
  failure?: "unreadable_reply" | "unconvertible_constraint";
  // A short, non-financial explanation when the assistant is unavailable.
  // Spend figures are operator information and never reach the customer.
  notice?: string;
};

export const AssistantRequest = z.object({
  sessionId: z.string().min(8).max(64),
  categoryId: z.string(),
  messages: z.array(AssistantMessage).max(40),
  hard: z.array(HardConstraint).default([]),
  soft: z.array(SoftPreference).default([]),
});
export type AssistantRequest = z.infer<typeof AssistantRequest>;

// What the model is allowed to return. Anything outside this shape is dropped,
// so every limit here is stated to the model in its instructions, generated
// from this object rather than written next to it.
export const INTENT_LIMITS = {
  replyChars: 1200,
  hard: 8,
  soft: 8,
  unmapped: 6,
  questionChars: 300,
  questionOptions: 5,
  questionOptionChars: 60,
  suggestCompare: 4,
} as const;

// The model's own constraint shapes. They differ from the engine's in exactly
// one way: money crosses this boundary as {amount, currency} in whole dollars,
// and code converts it to the integer minor units the engine compares. See
// src/domain/money-contract.ts for why a bare number is refused.
export const ModelHardConstraint = z.object({
  key: FilterKey,
  op: z.enum(CONDITION_OPS),
  value: z.union([ModelMoney, z.number(), z.string(), z.boolean(), z.array(z.string()), z.array(z.number())]).optional(),
});
export type ModelHardConstraint = z.infer<typeof ModelHardConstraint>;

export const ModelSoftPreference = z.object({
  key: z.string(),
  direction: z.enum(SOFT_DIRECTIONS),
  value: z.union([ModelMoney, z.number(), z.string(), z.boolean(), z.array(z.string())]).optional(),
  weight: z.number().min(SOFT_WEIGHT_RANGE.min).max(SOFT_WEIGHT_RANGE.max).default(SOFT_WEIGHT_RANGE.default),
});
export type ModelSoftPreference = z.infer<typeof ModelSoftPreference>;

export const ModelIntent = z.object({
  reply: z.string().max(INTENT_LIMITS.replyChars),
  hard: z.array(ModelHardConstraint).max(INTENT_LIMITS.hard).default([]),
  soft: z.array(ModelSoftPreference).max(INTENT_LIMITS.soft).default([]),
  unmapped: z.array(z.string()).max(INTENT_LIMITS.unmapped).default([]),
  question: z
    .object({
      text: z.string().max(INTENT_LIMITS.questionChars),
      options: z.array(z.string().max(INTENT_LIMITS.questionOptionChars)).max(INTENT_LIMITS.questionOptions).default([]),
    })
    .optional(),
  medicalIntent: z.boolean().default(false),
  suggestCompare: z.array(z.string()).max(INTENT_LIMITS.suggestCompare).default([]),
});
export type ModelIntent = z.infer<typeof ModelIntent>;
