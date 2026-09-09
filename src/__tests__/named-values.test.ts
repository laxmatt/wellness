import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { coldPlunge, wellnessDrinks } from "@/domain/categories";
import { namedButUnconstrained, namedValues } from "@/domain/named-values";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";
import { PreferenceSet } from "@/domain/personalization";
import { applyPreferences } from "@/domain/personalization/match";
import { viewsFor } from "./fixtures";

// A value the shopper named, that the site publishes, and that nothing was
// extracted for.
//
// The run of 2026-09-09T01:50 asked for "zero sugar electrolytes under $2 a
// serving". Two requirements became constraints. "Electrolytes" is a value of
// the `function` filter, listed in the model's own instructions and shown on
// the site's filter chips, and it produced nothing at all: no constraint, no
// preference, no question. The reply named what had been applied and said
// nothing about what had not, so a shopper could not tell a third of their
// sentence had been dropped.
//
// Naming a value is not asking for it, so nothing here filters. It asks.

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

// Exactly what the model returned at 01:50: both money and nutrition read
// correctly, nothing about function.
const AS_RUN = {
  reply: "Noted.",
  hard: [
    { key: "sugar_g", op: "eq", value: 0 },
    { key: "price_per_serving_minor", op: "lt", value: { amount: 2, currency: "USD" } },
  ],
  soft: [],
  unmapped: [],
  medicalIntent: false,
  suggestCompare: [],
};

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

async function askWith(intent: unknown, text: string, categoryId = "wellness-drinks") {
  vi.stubGlobal("fetch", modelReturns(intent));
  const res = await POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.55" },
      body: JSON.stringify({ sessionId: `s_named_${Date.now()}`, categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
    }),
  );
  return res.json();
}

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

describe("the values the site publishes for its own filters", () => {
  it("come from the products, the same way the filter chips do", () => {
    const values = namedValues(wellnessDrinks, viewsFor("wellness-drinks"));
    expect(values.get("function")?.map((v) => v.value)).toContain("electrolytes");
    // A key whose values are not enumerable this way is simply absent.
    expect(values.has("sugar_g")).toBe(false);
  });

  it("carries each value with the label the site would show", () => {
    const values = namedValues(coldPlunge, viewsFor("cold-plunge"));
    const plumbing = values.get("plumbing");
    expect(plumbing?.some((v) => v.value === "none" && v.label === "None. Fill with a hose.")).toBe(true);
  });
});

describe("finding a named value nothing covers", () => {
  const views = viewsFor("wellness-drinks");

  it("finds the key the shopper named", () => {
    expect(namedButUnconstrained(wellnessDrinks, views, "Zero sugar electrolytes under $2 a serving", [], [])).toEqual(["function"]);
  });

  it("says nothing when a constraint already covers the key", () => {
    const hard = [{ key: "function", op: "includes" as const, value: "electrolytes" }];
    expect(namedButUnconstrained(wellnessDrinks, views, "Zero sugar electrolytes under $2 a serving", hard, [])).toEqual([]);
  });

  it("counts a soft preference as covering it too", () => {
    const soft = [{ key: "function", direction: "prefer_high" as const, value: "electrolytes", weight: 0.5 }];
    expect(namedButUnconstrained(wellnessDrinks, views, "electrolytes please", [], soft)).toEqual([]);
  });

  it("matches whole words only", () => {
    expect(namedButUnconstrained(wellnessDrinks, views, "something energising for the morning", [], [])).toEqual([]);
    expect(namedButUnconstrained(wellnessDrinks, views, "an energy drink", [], [])).toEqual(["function"]);
  });

  it("says nothing when no published value was named", () => {
    expect(namedButUnconstrained(wellnessDrinks, views, "something that tastes good", [], [])).toEqual([]);
  });

  it("works for any category, not this sentence", () => {
    const cold = viewsFor("cold-plunge");
    expect(namedButUnconstrained(coldPlunge, cold, "an inflatable one", [], [])).toContain("tub_type");
  });

  it("offers only the values the catalogue actually holds", () => {
    // Cold plunge held no real `placement` value at all until the Ice Barrel
    // 500's page was read on 2026-09-09: it states weatherproofing and UV
    // protection, so "outdoor" is a value somebody claimed. "indoor" still
    // exists only as prototype data on other tubs, and is still not offered.
    const cold = viewsFor("cold-plunge");
    const placement = namedValues(coldPlunge, cold).get("placement") ?? [];
    expect(placement.map((v) => v.value)).toEqual(["outdoor"]);
    const holders = cold.filter((v) => (v.attributes.placement as string[] | undefined)?.includes("outdoor"));
    expect(holders.map((v) => v.id)).toEqual(["ice-barrel-500"]);
  });

  it("offers nothing for a filter whose every value is placeholder data", () => {
    // The rule itself, on a key where it still bites: no tub states an indoor
    // rating, so nothing may suggest one.
    const cold = viewsFor("cold-plunge");
    const placement = namedValues(coldPlunge, cold).get("placement") ?? [];
    expect(placement.map((v) => v.value)).not.toContain("indoor");
  });
});

describe("the reply for the sentence that lost a third of itself", () => {
  const TEXT = "Zero sugar electrolytes under $2 a serving";

  it("keeps both constraints the model got right", async () => {
    const body = await askWith(AS_RUN, TEXT);
    const applied = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(applied.hard).toEqual([
      { key: "sugar_g", op: "eq", value: 0 },
      { key: "price_per_serving_minor", op: "lt", value: 200 },
    ]);
  });

  it("says what it did not filter by", async () => {
    const body = await askWith(AS_RUN, TEXT);
    expect(body.text).toContain("I have not filtered by function.");
    expect(body.text).toContain("zero total sugar");
  });

  it("asks about it, in the site's own words and with the catalogue's values", async () => {
    const body = await askWith(AS_RUN, TEXT);
    expect(body.question.text).toBe("Which function suits you?");
    expect(body.question.options).toContain("Electrolytes");
  });

  it("invents no filter the shopper did not get", async () => {
    const body = await askWith(AS_RUN, TEXT);
    const applied = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    // Asking is the remedy. Applying a filter on the strength of a word in a
    // sentence is not: "no caffeine" names caffeine and asks for the opposite.
    expect(applied.hard.some((c: { key: string }) => c.key === "function")).toBe(false);
    expect(applied.soft).toEqual([]);
  });

  it("stays quiet once the constraint is there", async () => {
    const withFunction = {
      ...AS_RUN,
      hard: [...AS_RUN.hard, { key: "function", op: "includes", value: "electrolytes" }],
    };
    const body = await askWith(withFunction, TEXT);
    expect(body.text).not.toContain("I have not filtered by");
    expect(body.question).toBeUndefined();
    const applied = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(applied.hard).toContainEqual({ key: "function", op: "includes", value: "electrolytes" });
  });
});

describe("a preference on a list attribute is no longer inert", () => {
  const views = viewsFor("wellness-drinks");
  const score = (value: unknown) => {
    const r = applyPreferences(views, wellnessDrinks, PreferenceSet.parse({ soft: [{ key: "function", direction: "prefer_high", value, weight: 0.5 }] }));
    return Object.fromEntries(views.map((v) => [v.id, r.explanations[v.id].softScore]));
  };

  it("credits the products holding the named value", () => {
    const scored = score("electrolytes");
    // Scored 0 for every product before: ["electrolytes"] is not
    // "electrolytes", so the comparison could never be true.
    const idOf = (prefix: string) => views.find((v) => v.id.startsWith(prefix))!.id;
    expect(scored[idOf("lmnt")]).toBeGreaterThan(0);
    expect(scored[idOf("celsius")]).toBe(0);
  });

  it("scores the scalar and the array form the same, as it always should have", () => {
    expect(score("electrolytes")).toEqual(score(["electrolytes"]));
  });

  it("leaves enum and numeric preferences alone", () => {
    const cold = viewsFor("cold-plunge");
    const r = applyPreferences(cold, coldPlunge, PreferenceSet.parse({ soft: [{ key: "price", direction: "prefer_low", weight: 1 }] }));
    const scores = cold.map((v) => r.explanations[v.id].softScore);
    expect(Math.max(...scores)).toBeGreaterThan(Math.min(...scores));
  });
});
