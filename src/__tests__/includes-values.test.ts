import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { ModelHardConstraint } from "@/domain/assistant";
import { coldPlunge, wellnessDrinks } from "@/domain/categories";
import { evaluateCondition } from "@/domain/conditions";
import { toEngineConstraints } from "@/domain/model-constraints";
import { describeConstraint } from "@/domain/personalization/describe";
import { intentJsonSchema } from "@/providers/ai/OpenAIProvider";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";
import { viewsFor } from "./fixtures";

// What `includes` means, in one place.
//
// It asks whether a product's list holds a value. A scalar names one value. An
// array names alternatives and matches a product holding any of them, which is
// how this site's own list filter chips behave: options within a group are OR.
//
// The engine used to compare the value against the array's members, so an array
// value matched only a product whose list held that same array, which is never.
// The live conversation of 2026-09-09T02:12 answered a clarification with
// `function includes ["electrolytes"]` and the shopper was told nothing matched
// while LMNT Citrus Salt sat in the catalogue at $1.50 a serving.

const config: MeterConfig = {
  monthlyCapUsd: 25,
  sessionTurnLimit: 20,
  clientHourlyLimit: 50,
  inputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  maxInputTokens: 6000,
  maxOutputTokens: 500,
  estimateSafetyFactor: 1.3,
};
const ENV = { ...process.env };

const lmnt = () => viewsFor("wellness-drinks").find((v) => v.id === "lmnt-citrus-salt-30")!;
const celsius = () => viewsFor("wellness-drinks").find((v) => v.id === "celsius-sparkling-orange-12")!;

function modelReturns(intent: unknown) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(intent) } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

async function ask(intent: unknown, text = "electrolytes") {
  vi.stubGlobal("fetch", modelReturns(intent));
  const res = await POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.88" },
      body: JSON.stringify({ sessionId: `s_inc_${Date.now()}`, categoryId: "wellness-drinks", messages: [{ role: "user", text }], hard: [], soft: [] }),
    }),
  );
  return res.json();
}

const intentWith = (hard: unknown[]) => ({ reply: "Noted.", hard, soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] });

beforeEach(() => {
  resetMeterForTests(new UsageMeter(new MemoryUsageStore(), config));
  process.env.OPENAI_API_KEY = "sk-test-key";
  delete process.env.ASSISTANT_CREDENTIAL_MODE;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.ASSISTANT_DIAGNOSTICS_FILE;
  process.env.ASSISTANT_ALLOW_UNSHARED_LEDGER = "1";
  process.env.ASSISTANT_TRUSTED_IP_HEADER = "x-forwarded-for";
  process.env.ASSISTANT_CLIENT_SALT = "a-long-enough-test-salt";
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMeterForTests(null);
  process.env = { ...ENV };
});

describe("the engine, on both supported shapes", () => {
  it("matches a scalar naming one of the list's values", () => {
    expect(evaluateCondition(lmnt(), wellnessDrinks, { key: "function", op: "includes", value: "electrolytes" })).toBe(true);
    expect(evaluateCondition(celsius(), wellnessDrinks, { key: "function", op: "includes", value: "electrolytes" })).toBe(false);
  });

  it("matches an array the same way, which it did not", () => {
    // The shape that produced zero matches on a live conversation.
    expect(evaluateCondition(lmnt(), wellnessDrinks, { key: "function", op: "includes", value: ["electrolytes"] })).toBe(true);
    expect(evaluateCondition(celsius(), wellnessDrinks, { key: "function", op: "includes", value: ["electrolytes"] })).toBe(false);
  });

  it("treats several values as alternatives, as the filter chips do", () => {
    const both = { key: "function", op: "includes" as const, value: ["electrolytes", "energy"] };
    expect(evaluateCondition(lmnt(), wellnessDrinks, both)).toBe(true);
    expect(evaluateCondition(celsius(), wellnessDrinks, both)).toBe(true);
    const neither = { key: "function", op: "includes" as const, value: ["greens", "prebiotic"] };
    expect(evaluateCondition(lmnt(), wellnessDrinks, neither)).toBe(false);
  });

  it("still says no when the product's list holds none of them", () => {
    expect(evaluateCondition(lmnt(), wellnessDrinks, { key: "function", op: "includes", value: "energy" })).toBe(false);
  });
});

describe("an unsupported shape fails visibly instead of matching nothing", () => {
  it("refuses an empty list, which no product can contain", () => {
    const r = toEngineConstraints(wellnessDrinks, [{ key: "function", op: "includes", value: [] }], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/empty list/);
  });

  it("refuses a number, which no list of names holds", () => {
    const r = toEngineConstraints(wellnessDrinks, [{ key: "function", op: "includes", value: 3 }], []);
    expect(r.ok).toBe(false);
  });

  it("refuses a mixed list", () => {
    const r = toEngineConstraints(wellnessDrinks, [{ key: "function", op: "includes", value: ["electrolytes", 2] as never }], []);
    expect(r.ok).toBe(false);
  });

  it("refuses includes on a key that is not a list", () => {
    const r = toEngineConstraints(wellnessDrinks, [{ key: "sugar_g", op: "includes", value: "zero" }], []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/not a list/);
  });

  it("accepts both supported shapes, on any list key", () => {
    expect(toEngineConstraints(wellnessDrinks, [{ key: "function", op: "includes", value: "electrolytes" }], []).ok).toBe(true);
    expect(toEngineConstraints(wellnessDrinks, [{ key: "function", op: "includes", value: ["electrolytes"] }], []).ok).toBe(true);
    expect(toEngineConstraints(coldPlunge, [{ key: "placement", op: "includes", value: ["indoor", "outdoor"] }], []).ok).toBe(true);
  });
});

describe("the schema, the validator and the engine agree", () => {
  it("the schema offers both shapes", () => {
    const hard = (intentJsonSchema().properties as Record<string, unknown>).hard as Record<string, unknown>;
    const value = (((hard.items as Record<string, unknown>).properties as Record<string, unknown>).value as Record<string, unknown>)
      .anyOf as Record<string, unknown>[];
    expect(value.some((v) => v.type === "string")).toBe(true);
    expect(value.some((v) => v.type === "array" && (v.items as Record<string, unknown>).type === "string")).toBe(true);
  });

  it("the validator accepts both shapes", () => {
    expect(ModelHardConstraint.safeParse({ key: "function", op: "includes", value: "electrolytes" }).success).toBe(true);
    expect(ModelHardConstraint.safeParse({ key: "function", op: "includes", value: ["electrolytes"] }).success).toBe(true);
  });

  it("the sentence says alternatives when there are alternatives", () => {
    expect(describeConstraint(wellnessDrinks, { key: "function", op: "includes", value: "electrolytes" })).toBe("function includes Electrolytes");
    expect(describeConstraint(wellnessDrinks, { key: "function", op: "includes", value: ["electrolytes"] })).toBe("function includes Electrolytes");
    expect(describeConstraint(wellnessDrinks, { key: "function", op: "includes", value: ["electrolytes", "energy"] })).toBe(
      "function includes any of Electrolytes, Energy",
    );
  });
});

describe("the LMNT case, through the real route", () => {
  it("finds the electrolyte drink from the array shape that found nothing", async () => {
    const body = await ask(intentWith([{ key: "function", op: "includes", value: ["electrolytes"] }]));
    const applied = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(applied.matchingIds).toContain("lmnt-citrus-salt-30");
    expect(applied.matchingIds).not.toContain("celsius-sparkling-orange-12");
    expect(body.text).not.toMatch(/No products match/);
  });

  it("finds the same products from the scalar shape", async () => {
    const array = await ask(intentWith([{ key: "function", op: "includes", value: ["electrolytes"] }]));
    const scalar = await ask(intentWith([{ key: "function", op: "includes", value: "electrolytes" }]));
    const idsOf = (b: { proposals: { kind: string; matchingIds?: string[] }[] }) =>
      b.proposals.find((p) => p.kind === "apply_preferences")!.matchingIds;
    expect(idsOf(array)).toEqual(idsOf(scalar));
  });

  it("reproduces the whole live conversation's final constraints and gets one product", async () => {
    const body = await ask(
      intentWith([
        { key: "sugar_g", op: "eq", value: 0 },
        { key: "price_per_serving_minor", op: "lt", value: { amount: 2, currency: "USD" } },
        { key: "function", op: "includes", value: ["electrolytes"] },
      ]),
      "Zero sugar electrolytes under $2 a serving",
    );
    const applied = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(applied.matchingIds).toEqual(["lmnt-citrus-salt-30"]);
  });

  it("tells the shopper plainly when a shape cannot be searched for", async () => {
    const body = await ask(intentWith([{ key: "function", op: "includes", value: [] }]));
    expect(body.failure).toBe("unconvertible_constraint");
    expect(body.proposals).toEqual([]);
  });
});
