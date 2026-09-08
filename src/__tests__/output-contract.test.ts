import { describe, expect, it } from "vitest";
import { INTENT_LIMITS, ModelIntent } from "@/domain/assistant";
import { CONDITION_OPS } from "@/domain/category";
import { SOFT_DIRECTIONS, SOFT_WEIGHT_RANGE } from "@/domain/personalization";
import { OpenAIConversationProvider, type ConverseInput } from "@/providers/ai/OpenAIProvider";

// The contract the model is given and the contract the validator enforces are
// two descriptions of one thing. When they disagreed, every reply carrying a
// constraint was discarded whole and the shopper saw an error. These tests fail
// if they drift apart again.

const provider = new OpenAIConversationProvider(null);

const input = (over: Partial<ConverseInput> = {}): ConverseInput => ({
  categoryName: "Red light therapy",
  filterVocabulary: "price (integer cents, use op lte); coverage (one of full_body|targeted)",
  products: [
    { id: "p1", name: "One", brand: "B", price: "$100", priceIsPlaceholder: false, facts: [], notStated: [] },
    { id: "p2", name: "Two", brand: "B", price: "$200", priceIsPlaceholder: false, facts: [], notStated: [] },
  ],
  catalogueSize: 8,
  moneyContract: "MONEY: price is money.",
  messages: [{ role: "user", text: "under 500" }],
  activeConstraints: [],
  ...over,
});

// The provider builds its messages privately. Reading them through the public
// estimate is indirect, so the prompt text is asserted against the constants
// instead: anything the validator enforces must be findable in what is sent.
function promptText(i: ConverseInput): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (provider as any).buildMessages(i).map((m: { content: string }) => m.content).join("\n");
}

describe("the model is told the contract the validator enforces", () => {
  const text = promptText(input());

  it("names every operator the schema accepts, and no others", () => {
    for (const op of CONDITION_OPS) expect(text).toContain(op);
    // The list is given as one line, so a new op added to the schema without
    // updating the prompt would leave that line short.
    expect(text).toContain(CONDITION_OPS.join(" | "));
  });

  it("names every soft direction the schema accepts", () => {
    for (const d of SOFT_DIRECTIONS) expect(text).toContain(d);
    expect(text).toContain(SOFT_DIRECTIONS.join(" | "));
  });

  it("states the weight range and the array limits the schema enforces", () => {
    expect(text).toContain(`from ${SOFT_WEIGHT_RANGE.min} to ${SOFT_WEIGHT_RANGE.max}`);
    expect(text).toContain(`at most ${INTENT_LIMITS.hard} entries`);
    expect(text).toContain(`at most ${INTENT_LIMITS.soft} entries`);
    expect(text).toContain(`at most ${INTENT_LIMITS.unmapped} strings`);
    expect(text).toContain(`at most ${INTENT_LIMITS.replyChars} characters`);
    expect(text).toContain(`at most ${INTENT_LIMITS.suggestCompare} product ids`);
  });

  it("warns against the spellings a model reaches for instead of the enums", () => {
    expect(text).toMatch(/not "less_than"/);
    expect(text).toMatch(/not "lower"/);
  });

  it("says plainly that a broken reply is discarded whole", () => {
    expect(text).toMatch(/discarded whole/i);
  });
});

describe("the validator still refuses what the contract forbids", () => {
  const ok = { reply: "Sure.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] };

  it("accepts a constraint written exactly as the contract describes", () => {
    const r = ModelIntent.safeParse({ ...ok, hard: [{ key: "price", op: "lte", value: 50000 }] });
    expect(r.success).toBe(true);
  });

  it("rejects an operator outside the enum rather than guessing at it", () => {
    for (const op of ["less_than", "<", "under", "max"]) {
      expect(ModelIntent.safeParse({ ...ok, hard: [{ key: "price", op, value: 50000 }] }).success).toBe(false);
    }
  });

  it("rejects a soft direction outside the enum", () => {
    for (const direction of ["low", "lower", "minimize", "cheap"]) {
      expect(ModelIntent.safeParse({ ...ok, soft: [{ key: "price", direction, weight: 0.5 }] }).success).toBe(false);
    }
  });

  it("rejects a weight outside the range", () => {
    expect(ModelIntent.safeParse({ ...ok, soft: [{ key: "price", direction: "prefer_low", weight: 5 }] }).success).toBe(false);
  });

  it("rejects more constraints than the limit the model was given", () => {
    const many = Array.from({ length: INTENT_LIMITS.hard + 1 }, () => ({ key: "price", op: "lte", value: 1 }));
    expect(ModelIntent.safeParse({ ...ok, hard: many }).success).toBe(false);
  });
});

describe("the shortlist is described as partial", () => {
  it("tells the model how many products it cannot see", () => {
    const text = promptText(input({ catalogueSize: 8 }));
    expect(text).toContain("a shortlist of 2 of the 8 products");
    expect(text).toContain("You cannot see the other 6");
  });

  it("forbids claiming that nothing exists, which is what produced the $500 answer", () => {
    const text = promptText(input());
    expect(text).toMatch(/Never say that no product exists/i);
    expect(text).toMatch(/the site's engine searches every product/i);
  });

  it("does not go negative when the shortlist is the whole category", () => {
    const text = promptText(input({ catalogueSize: 2 }));
    expect(text).toContain("You cannot see the other 0");
  });
});

describe("evidence tiers are described to the model", () => {
  it("names all three, and says what each one licenses", () => {
    const text = promptText(input());
    expect(text).toContain("sourced");
    expect(text).toContain("manufacturer_claim");
    expect(text).toContain("unattributed");
    expect(text).toMatch(/source is not recorded/i);
    expect(text).toMatch(/Say whose claim it is/i);
  });
});
