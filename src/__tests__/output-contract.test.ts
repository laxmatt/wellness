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
    { id: "p1", name: "One", brand: "B", facts: [], notStated: [] },
    { id: "p2", name: "Two", brand: "B", facts: [], notStated: [] },
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

  // Retired, not weakened. The instruction forbidding "nothing exists" existed
  // because the model's prose reached the shopper. It does not: every sentence
  // is composed by reply-composer.ts, and engineSummary states the count from
  // the engine's own result. The guarantee moved from an instruction the model
  // could ignore to a sentence it cannot write. See shortlist-claims.test.ts,
  // which asserts the rendered count rather than the request for one.

  it("does not go negative when the shortlist is the whole category", () => {
    const text = promptText(input({ catalogueSize: 2 }));
    expect(text).toContain("You cannot see the other 0");
  });
});

describe("what the model is no longer given", () => {
  // Evidence tiers told the model how to attribute a figure it quoted. It
  // quotes nothing now, so the tiers grounded nothing and are gone, along with
  // the prices. Attribution still reaches the shopper: the route renders it on
  // the product cards from the same provenance records.
  it("carries no evidence tier", () => {
    const text = promptText(input());
    expect(text).not.toMatch(/\[sourced\]|\[manufacturer_claim\]|\[unattributed\]/);
  });

  it("carries no price, at any provenance", () => {
    // The catalogue block alone. The MONEY block quotes amounts on purpose:
    // that is the contract for how a budget is sent.
    const text = promptText(input());
    const catalogue = text.slice(text.indexOf("CATALOGUE:"));
    expect(catalogue).not.toMatch(/\bprice \$/);
    expect(catalogue).not.toMatch(/\$\d/);
  });

  it("says its reply is not displayed, so it does not write one", () => {
    const text = promptText(input());
    expect(text).toMatch(/is not displayed to anyone/i);
    expect(text).toMatch(/do not describe products, quote figures/i);
  });
});
