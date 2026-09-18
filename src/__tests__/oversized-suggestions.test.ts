import { describe, expect, it, vi } from "vitest";
import { OpenAIConversationProvider, UNREADABLE_REPLY } from "@/providers/ai/OpenAIProvider";
import { INTENT_LIMITS } from "@/domain/assistant";

// An optional suggestion must not destroy a valid answer.
//
// These are the two replies the run of 2026-09-09T01:35 threw away, copied from
// the diagnostics file rather than invented. Both were schema-valid. Both
// extracted correctly. Both were discarded whole, because `suggestCompare`
// carried more product ids than `ModelIntent` allows and the strict schema
// expresses no such bound. Two of fifteen cases, and the shopper saw "I could
// not read that reliably" for a reply the model got right.

const INPUT = {
  categoryName: "Red light",
  filterVocabulary: "price, coverage",
  moneyContract: "MONEY: price is money.",
  products: [],
  catalogueSize: 8,
  messages: [{ role: "user" as const, text: "under 500" }],
  activeConstraints: [],
};

function modelReturns(raw: string) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: raw } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

// Captured 2026-09-09T01:35. red-light, "under 500". Five ids, limit four.
const UNDER_500 = JSON.stringify({
  reply: "The following products are available under $500.",
  hard: [{ key: "price", op: "lte", value: { amount: 500, currency: "USD" } }],
  soft: [],
  unmapped: [],
  medicalIntent: false,
  suggestCompare: ["hooga-pro1500", "platinumled-biomax-900", "joovv-solo-3", "bon-charge-max", "hooga-hg300"],
});

// Captured 2026-09-09T01:35. wellness-drinks, "Which one is healthiest?". Six.
const HEALTHIEST = JSON.stringify({
  reply: "I cannot determine which product is healthiest. I can compare their specifications instead.",
  hard: [],
  soft: [],
  unmapped: [],
  medicalIntent: true,
  suggestCompare: [
    "lmnt-citrus-salt-30",
    "celsius-sparkling-orange-12",
    "ag1-pouch-30",
    "cure-hydration-lemonade-14",
    "liquid-iv-hydration-multiplier-16",
    "olipop-root-beer-12",
  ],
});

async function parse(raw: string) {
  vi.stubGlobal("fetch", modelReturns(raw));
  const result = await new OpenAIConversationProvider("sk-test-key").converse(INPUT);
  vi.unstubAllGlobals();
  return result;
}

describe("the reply that was lost with five suggestions", () => {
  it("is read, not discarded", async () => {
    const { intent, status } = await parse(UNDER_500);
    expect(status).toBe("ok");
    expect(intent.reply).not.toBe(UNREADABLE_REPLY);
  });

  it("keeps the budget, which is what the call was for", async () => {
    const { intent } = await parse(UNDER_500);
    expect(intent.hard).toEqual([{ key: "price", op: "lte", value: { amount: 500, currency: "USD" } }]);
  });

  it("trims the suggestion to the limit rather than dropping it", async () => {
    const { intent } = await parse(UNDER_500);
    expect(intent.suggestCompare).toHaveLength(INTENT_LIMITS.suggestCompare);
    expect(intent.suggestCompare[0]).toBe("hooga-pro1500");
  });
});

describe("the reply that was lost with six suggestions", () => {
  it("is read, and still carries nothing to apply", async () => {
    const { intent, status } = await parse(HEALTHIEST);
    expect(status).toBe("ok");
    expect(intent.reply).not.toBe(UNREADABLE_REPLY);
    expect(intent.hard).toEqual([]);
    expect(intent.soft).toEqual([]);
  });

  it("trims six to four", async () => {
    const { intent } = await parse(HEALTHIEST);
    expect(intent.suggestCompare).toHaveLength(4);
    expect(intent.suggestCompare).toEqual([
      "lmnt-citrus-salt-30",
      "celsius-sparkling-orange-12",
      "ag1-pouch-30",
      "cure-hydration-lemonade-14",
    ]);
  });
});

describe("what trimming does not do", () => {
  it("leaves a list at the limit alone", async () => {
    const four = ["a", "b", "c", "d"];
    const { intent } = await parse(JSON.stringify({ reply: "Four.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: four }));
    expect(intent.suggestCompare).toEqual(four);
  });

  it("does not rescue a reply that is broken in a way that matters", async () => {
    // A constraint count over the limit still fails: those are the shopper's
    // filters, not an optional suggestion, and silently dropping four of them
    // would change what the search means.
    const tooManyHard = Array.from({ length: INTENT_LIMITS.hard + 1 }, () => ({ key: "price", op: "lte", value: 1 }));
    const { intent, status } = await parse(
      JSON.stringify({ reply: "Many.", hard: tooManyHard, soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    expect(status).toBe("unreadable");
    expect(intent.reply).toBe(UNREADABLE_REPLY);
  });
});
