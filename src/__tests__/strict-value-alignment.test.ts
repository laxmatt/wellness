import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { ModelHardConstraint, ModelSoftPreference } from "@/domain/assistant";
import { coldPlunge } from "@/domain/categories";
import { toEngineConstraints } from "@/domain/model-constraints";
import { OpenAIConversationProvider, intentJsonSchema } from "@/providers/ai/OpenAIProvider";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// Strict structured outputs cannot omit a property. Every field must be
// present, so "no value here" arrives as `value: null`, and the validator
// accepts an absent value rather than a null one. These tests run the real
// provider parsing path and the real route, because the mismatch they cover is
// only visible once a reply has been through both.

type Node = Record<string, unknown>;

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

const INPUT = {
  categoryName: "Cold plunge",
  filterVocabulary: "price, chiller_included",
  moneyContract: "MONEY: price is money.",
  products: [],
  catalogueSize: 12,
  messages: [{ role: "user" as const, text: "something cheap" }],
  activeConstraints: [],
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

// Exactly what strict mode emits: every property present, absence as null.
const strictReply = (over: Record<string, unknown> = {}) => ({
  reply: "Noted.",
  hard: [],
  soft: [],
  unmapped: [],
  medicalIntent: false,
  suggestCompare: [],
  ...over,
});

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

describe("a preference with no target value, through the provider", () => {
  it("is accepted, with the null read as an absent value", async () => {
    vi.stubGlobal(
      "fetch",
      modelReturns(strictReply({ soft: [{ key: "price", direction: "prefer_low", value: null, weight: 0.5 }] })),
    );

    const result = await new OpenAIConversationProvider("sk-test-key").converse(INPUT);

    expect(result.status).toBe("ok");
    expect(result.intent.soft).toHaveLength(1);
    expect(result.intent.soft[0]).toMatchObject({ key: "price", direction: "prefer_low", weight: 0.5 });
    // Absent, not null: the engine's SoftPreference has no null value.
    expect(result.intent.soft[0].value).toBeUndefined();
    expect("value" in result.intent.soft[0]).toBe(false);
  });

  it("survives conversion and reaches the engine as a preference", () => {
    const cat = coldPlunge;
    const converted = toEngineConstraints(cat, [], [{ key: "price", direction: "prefer_low", weight: 0.5 }]);
    expect(converted.ok).toBe(true);
    if (converted.ok) expect(converted.soft[0]).toMatchObject({ key: "price", direction: "prefer_low" });
  });

  it("was rejected before the null was translated", async () => {
    // The defect this exists to catch: switch the schema on, and every
    // preference without a target value is discarded whole.
    expect(ModelSoftPreference.safeParse({ key: "price", direction: "prefer_low", value: null, weight: 0.5 }).success).toBe(false);
  });
});

describe("a constraint that needs a value is still refused", () => {
  const ask = (text: string) =>
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
      body: JSON.stringify({ sessionId: "s_strictval", categoryId: "cold-plunge", messages: [{ role: "user", text }], hard: [], soft: [] }),
    });

  it("fails the whole reply when a price arrives with no amount", async () => {
    vi.stubGlobal("fetch", modelReturns(strictReply({ reply: "Under budget.", hard: [{ key: "price", op: "lte", value: null }] })));

    const body = await (await POST(ask("something under my budget"))).json();

    expect(body.failure).toBe("unconvertible_constraint");
    expect(body.proposals).toEqual([]);
    expect(body.notice).toMatch(/budget/i);
  });

  it("fails the whole reply for a non-money comparison with no value", async () => {
    // A comparison with no target matches nothing for every product, so it
    // must not be searched for silently.
    vi.stubGlobal("fetch", modelReturns(strictReply({ reply: "Cold.", hard: [{ key: "min_temp_f", op: "lte", value: null }] })));

    const body = await (await POST(ask("as cold as it goes"))).json();

    expect(body.failure).toBe("unconvertible_constraint");
    expect(body.proposals).toEqual([]);
    // The old notice called every conversion failure a budget.
    expect(body.notice).not.toMatch(/budget/i);
  });

  it("still admits exists and missing, which assert nothing about a value", () => {
    const cat = coldPlunge;
    const converted = toEngineConstraints(cat, [{ key: "chiller_included", op: "exists" }, { key: "price", op: "missing" }], []);
    expect(converted.ok).toBe(true);
  });

  it("applies a price that does carry an amount", async () => {
    vi.stubGlobal(
      "fetch",
      modelReturns(strictReply({ reply: "Under $5,000.", hard: [{ key: "price", op: "lte", value: { amount: 5000, currency: "USD" } }] })),
    );

    const body = await (await POST(ask("up to $5,000"))).json();

    expect(body.failure).toBeUndefined();
    const applied = body.proposals.find((p: Node) => p.kind === "apply_preferences") as Node | undefined;
    expect((applied?.hard as Node[])[0]).toMatchObject({ key: "price", op: "lte", value: 500000 });
  });
});

describe("the schema offers only the shapes the validator accepts", () => {
  const branches = (where: "hard" | "soft"): Node[] => {
    const field = (intentJsonSchema().properties as Node)[where] as Node;
    return (((field.items as Node).properties as Node).value as Node).anyOf as Node[];
  };

  const sample = (branch: Node): unknown => {
    if (branch.type === "null") return null;
    if (branch.type === "number") return 4;
    if (branch.type === "string") return "steel";
    if (branch.type === "boolean") return true;
    if (branch.type === "object") return { amount: 5000, currency: "USD" };
    const items = branch.items as Node;
    return items.type === "number" ? [1, 2] : ["a", "b"];
  };

  it("offers the hard branches ModelHardConstraint accepts, null aside", () => {
    for (const branch of branches("hard")) {
      const value = sample(branch);
      if (value === null) continue; // translated to an absence before validation
      expect(ModelHardConstraint.safeParse({ key: "price", op: "eq", value }).success).toBe(true);
    }
  });

  it("offers the soft branches ModelSoftPreference accepts, null aside", () => {
    for (const branch of branches("soft")) {
      const value = sample(branch);
      if (value === null) continue;
      expect(ModelSoftPreference.safeParse({ key: "price", direction: "prefer_low", weight: 0.5, value }).success).toBe(true);
    }
  });

  it("does not offer a soft numeric array, which the validator refuses", () => {
    const numericArray = (b: Node) => b.type === "array" && (b.items as Node).type === "number";
    expect(branches("soft").some(numericArray)).toBe(false);
    // Hard constraints do take one, so the two lists are not interchangeable.
    expect(branches("hard").some(numericArray)).toBe(true);
    expect(ModelSoftPreference.safeParse({ key: "price", direction: "prefer_low", weight: 0.5, value: [1, 2] }).success).toBe(false);
  });
});
