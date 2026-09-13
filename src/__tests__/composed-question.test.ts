import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import { FIXED_INVITATION, FIXED_LIMITATION, clarifyingQuestion, composeReply } from "@/domain/reply-composer";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The last two paths by which the model's own words could reach the screen: the
// question it wrote, with the options it invented, and the free text it put in
// `unmapped`. Both are now composed from the category's own definitions.

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
const usd = (amount: number) => ({ amount, currency: "USD" as const });

function modelSays(intent: Record<string, unknown>) {
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

function ask(text: string, categoryId = "red-light") {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.81" },
    body: JSON.stringify({ sessionId: "s_question", categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
  });
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

describe("the question shown is this site's, not the model's", () => {
  // A question carrying exactly the kind of claim the prose removal was for.
  const MODEL_QUESTION = {
    text: "Do you want 660nm for its skin benefits, or 850nm to reach deeper tissue?",
    options: ["660nm for collagen", "850nm for recovery", "both, for the full therapeutic range"],
  };

  it("does not display the model's question text or its options", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "x", hard: [], soft: [], unmapped: [], question: MODEL_QUESTION, medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("help me pick"))).json();

    expect(JSON.stringify(body)).not.toContain("skin benefits");
    expect(JSON.stringify(body)).not.toContain("collagen");
    expect(JSON.stringify(body)).not.toContain("therapeutic");
    expect(body.question?.text).not.toBe(MODEL_QUESTION.text);
  });

  it("asks the site's own question, with the category's own labels as options", async () => {
    const cat = categoryById("red-light")!;
    const presets = cat.filters.find((f) => f.key === "price")?.presets?.map((p) => p.label) ?? [];
    expect(presets.length).toBeGreaterThan(0);

    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "x", hard: [], soft: [], unmapped: [], question: MODEL_QUESTION, medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("help me pick"))).json();

    expect(body.question.text).toBe("What is your budget?");
    for (const o of body.question.options) expect(presets).toContain(o);
  });

  it("moves on to another filter once the budget is already set", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "x",
        hard: [{ key: "price", op: "lte", value: usd(500) }],
        soft: [],
        unmapped: [],
        question: MODEL_QUESTION,
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under 500, what else should I think about?"))).json();
    expect(body.question.text).not.toBe("What is your budget?");
    expect(body.question.options.length).toBeGreaterThan(0);
  });

  it("shows no question at all when the model did not ask one", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "x", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("show me something"))).json();
    expect(body.question).toBeUndefined();
  });

  it("builds only from category definitions", () => {
    for (const id of ["red-light", "cold-plunge", "wellness-drinks"]) {
      const cat = categoryById(id)!;
      const q = clarifyingQuestion(cat, []);
      expect(q).toBeTruthy();
      const labels = [
        ...(cat.filters.flatMap((f) => f.presets?.map((p) => p.label) ?? [])),
        ...cat.attributeDefinitions.flatMap((a) => a.enumOptions?.map((o) => o.label) ?? []),
        ...cat.filters.map((f) => f.label),
      ];
      for (const o of q!.options) expect(labels).toContain(o);
    }
  });
});

describe("unmapped phrases are counted, not quoted", () => {
  it("does not echo the model's free text", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "x",
        hard: [{ key: "price", op: "lte", value: usd(500) }],
        soft: [],
        unmapped: ["something that boosts collagen and helps recovery"],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under 500 and good for recovery"))).json();

    expect(body.text).not.toContain("collagen");
    expect(body.text).not.toContain("recovery");
    expect(body.text).toMatch(/One thing you mentioned is not something this site compares/);
  });

  it("counts more than one without quoting any", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "x",
        hard: [{ key: "price", op: "lte", value: usd(500) }],
        soft: [],
        unmapped: ["tastes nice", "looks good in my kitchen", "boosts energy"],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under 500 and nice"))).json();
    expect(body.text).toContain("3 things you mentioned");
    expect(body.text).not.toMatch(/tastes nice|kitchen|energy/);
  });
});

describe("the invitation is a question a shopper can answer", () => {
  it("ends the vague opener with a question mark, which the live test requires", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "x", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("I have no idea where to start"))).json();
    expect(body.text).toMatch(/\?/);
    expect(body.text).toContain(FIXED_INVITATION);
  });

  it("the fixed limitation also asks something, rather than ending in a wall", () => {
    expect(FIXED_LIMITATION).toMatch(/\?$/);
  });

  it("composes both without touching the model's words", () => {
    const cat = categoryById("red-light")!;
    const invited = composeReply({
      cat,
      hard: [],
      soft: [],
      unmapped: [],
      matchCount: 8,
      totalProducts: 8,
      changed: false,
      clearing: false,
      lastUserText: "I have no idea where to start",
    });
    expect(invited).toContain(FIXED_INVITATION);
    expect(invited).toMatch(/\?/);

    const limited = composeReply({
      cat,
      hard: [],
      soft: [],
      unmapped: [],
      matchCount: 8,
      totalProducts: 8,
      changed: false,
      clearing: false,
      lastUserText: "what is the difference between 660nm and 850nm?",
    });
    expect(limited).toBe(FIXED_LIMITATION);
  });
});
