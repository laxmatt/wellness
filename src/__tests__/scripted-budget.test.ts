import { describe, expect, it } from "vitest";
import { redLight, wellnessDrinks } from "@/domain/categories";
import { toEngineConstraints } from "@/domain/model-constraints";
import { ScriptedConversationProvider } from "@/providers/ai/ScriptedProvider";
import type { ConverseInput } from "@/providers/ai/OpenAIProvider";

// The prototype route is the one a reviewer sees, because no key is configured.
// Every budget typed into it was rejected: the stand-in answered in the
// engine's cents, the route accepts only the model's dollars, and the route
// refuses a bare number for money rather than guessing its unit. The shopper
// got "I could not read that reliably" for the single most common thing anyone
// types.

function input(text: string): ConverseInput {
  return {
    categoryName: "test",
    filterVocabulary: "",
    moneyContract: "",
    products: [],
    catalogueSize: 0,
    messages: [{ role: "user", text }],
    activeConstraints: [],
  };
}

describe("the scripted stand-in speaks the route's money contract", () => {
  it("sends a budget as dollars with a currency, not as bare cents", async () => {
    const res = await new ScriptedConversationProvider(redLight).converse(input("a full body panel under $700"));
    expect(res.intent.hard).toEqual([{ key: "price", op: "lte", value: { amount: 700, currency: "USD" } }]);
  });

  it("converts back to the exact cents the engine compares", async () => {
    const res = await new ScriptedConversationProvider(redLight).converse(input("under $700"));
    const converted = toEngineConstraints(redLight, res.intent.hard, res.intent.soft);
    expect(converted.ok).toBe(true);
    expect(converted.ok && converted.hard).toEqual([{ key: "price", op: "lte", value: 70000 }]);
  });

  it("survives a fractional per-serving budget without losing a cent", async () => {
    const res = await new ScriptedConversationProvider(wellnessDrinks).converse(input("under $1.99 per serving"));
    expect(res.intent.hard).toEqual([{ key: "price_per_serving_minor", op: "lte", value: { amount: 1.99, currency: "USD" } }]);
    const converted = toEngineConstraints(wellnessDrinks, res.intent.hard, res.intent.soft);
    expect(converted.ok && converted.hard).toEqual([{ key: "price_per_serving_minor", op: "lte", value: 199 }]);
  });

  it("leaves constraints that are not money alone", async () => {
    const res = await new ScriptedConversationProvider(redLight).converse(input("something for a small apartment"));
    expect(res.intent.soft.every((s) => typeof s.value !== "object" || s.value === null || !("currency" in s.value))).toBe(true);
    expect(toEngineConstraints(redLight, res.intent.hard, res.intent.soft).ok).toBe(true);
  });
});
