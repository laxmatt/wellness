import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import { matchesAll } from "@/domain/conditions";
import { admittedMaximum, checkReply, valueFits, type CheckableReply, type ExpectedCase } from "@/domain/livetest-expectations";
import { getCatalog } from "@/providers";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The live test's own assertions, run against real route responses without
// spending anything.
//
// This exists because the previous revision compared the route's converted
// constraints against the dollar object the model sends. Every correct answer
// would have been scored a failure and only a paid run would have shown it.

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

function raw(content: string) {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 60 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

async function askRoute(text: string, categoryId = "red-light"): Promise<CheckableReply> {
  const res = await POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.61" },
      body: JSON.stringify({ sessionId: "s_checkerprobe", categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
    }),
  );
  return (await res.json()) as CheckableReply;
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

describe("money is asserted where the script actually reads it", () => {
  it("passes a correct $700 answer, whose proposal carries 70000", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "ok", hard: [{ key: "price", op: "lte", value: usd(700) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const reply = await askRoute("a full-body panel under $700");
    const proposal = reply.proposals.find((p) => p.kind === "apply_preferences");
    expect(proposal?.hard?.[0].value).toBe(70000);

    const expectCase: ExpectedCase = { hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 70000 }] };
    expect(checkReply(reply, expectCase)).toEqual([]);
  });

  it.each([
    ["under 500", 500, 50000],
    ["up to $5,000", 5000, 500000],
  ])("passes %s", async (_name, dollars, minorUnits) => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "ok", hard: [{ key: "price", op: "lte", value: usd(dollars) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const reply = await askRoute("budget question");
    expect(checkReply(reply, { hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: minorUnits }] })).toEqual([]);
  });

  it("passes $2 a serving, whose proposal carries 200", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "ok",
        hard: [{ key: "price_per_serving_minor", op: "lte", value: usd(2) }],
        soft: [],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const reply = await askRoute("under $2 a serving", "wellness-drinks");
    expect(checkReply(reply, { hard: [{ key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 200 }] })).toEqual([]);
  });

  it("fails a budget that converted to the wrong amount", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "ok", hard: [{ key: "price", op: "lte", value: usd(7) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const reply = await askRoute("a panel under $700");
    const problems = checkReply(reply, { hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 70000 }] });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/lte 700 does not fit a constraint admitting at most 70000/);
  });

  it("fails an inverted operator even when the amount is right", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "ok", hard: [{ key: "price", op: "gte", value: usd(700) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const reply = await askRoute("a panel under $700");
    const problems = checkReply(reply, { hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 70000 }] });
    expect(problems[0]).toMatch(/used op gte/);
  });

  it("fails when the model sent a bare number, because the route refuses it", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "ok", hard: [{ key: "price", op: "lte", value: 700 }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const reply = await askRoute("a panel under $700");
    const problems = checkReply(reply, { hard: [{ key: "price", ops: ["lt", "lte"], admitsAtMost: 70000 }] });
    expect(problems).toEqual(["the reply could not be used (unconvertible_constraint); nothing was extracted"]);
  });
});

describe("the other assertions, against real responses", () => {
  it("reports a missing constraint", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "ok", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const reply = await askRoute("under $700");
    expect(checkReply(reply, { hard: [{ key: "price", ops: ["lte"], admitsAtMost: 70000 }] })).toContain("missing hard price");
  });

  it("reports an invented constraint, and accepts a justified one", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "ok",
        hard: [],
        soft: [
          { key: "coverage", direction: "prefer_value", value: "targeted", weight: 0.5 },
          { key: "footprint", direction: "prefer_low", weight: 0.5 },
        ],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const reply = await askRoute("something small for my face");

    expect(checkReply(reply, { soft: [{ key: "coverage" }] })).toContain("invented constraint footprint");
    expect(checkReply(reply, { soft: [{ key: "coverage" }], alsoReasonable: ["footprint"] })).toEqual([]);
  });

  it("checks the engine's own count, not the model's opinion of it", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const under500 = views.filter((v) => matchesAll(v, cat, [{ key: "price", op: "lte", value: 50000 }])).length;
    expect(under500).toBeGreaterThan(0);

    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "ok", hard: [{ key: "price", op: "lte", value: usd(500) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const reply = await askRoute("under 500");
    expect(checkReply(reply, { hard: [{ key: "price", ops: ["lte"], admitsAtMost: 50000 }], engine: "someMatch" })).toEqual([]);
  });

  it("reports a medical question that was not declined, and one wrongly declined", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "ok", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const ordinary = await askRoute("what size is it?");
    expect(checkReply(ordinary, { medicalIntent: true })).toContain("medical question was not declined");

    const medical = await askRoute("will this heal my tendonitis?");
    expect(checkReply(medical, {})).toContain("declined a question that was not medical");
    expect(checkReply(medical, { medicalIntent: true })).toEqual([]);
  });

  it("reports an unreadable reply as its own failure", async () => {
    vi.stubGlobal("fetch", raw("not json at all"));
    const reply = await askRoute("under $700");
    expect(checkReply(reply, { hard: [{ key: "price", ops: ["lte"], admitsAtMost: 70000 }] })).toEqual([
      "the reply could not be used (unreadable_reply); nothing was extracted",
    ]);
  });
});

describe("budget equivalence is judged by operator and amount together", () => {
  it("treats lt 200 and lte 199 as the same request", () => {
    // Both admit every price up to $1.99 and nothing above it.
    expect(admittedMaximum("lt", 200)).toBe(199);
    expect(admittedMaximum("lte", 199)).toBe(199);
  });

  it("does not treat lt 199 as the same request", () => {
    expect(admittedMaximum("lt", 199)).toBe(198);
  });

  it("accepts either spelling of under $2 a serving, and refuses the others", () => {
    const want = { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 };
    expect(valueFits(200, want, "lt")).toBe(true);
    expect(valueFits(199, want, "lte")).toBe(true);
    // $2.00 exactly is not under $2.
    expect(valueFits(200, want, "lte")).toBe(false);
    // $1.99 excluded is not under $2 either.
    expect(valueFits(199, want, "lt")).toBe(false);
  });

  it("allows the inclusive reading only where the expectation says so", () => {
    const strict = { key: "price", ops: ["lt", "lte"], admitsAtMost: 199 };
    const lenient = { key: "price", ops: ["lt", "lte"], admitsAtMost: 70000, orAtMost: 69999 };
    expect(valueFits(200, strict, "lte")).toBe(false);
    expect(valueFits(70000, lenient, "lte")).toBe(true);
    expect(valueFits(70000, lenient, "lt")).toBe(true);
    expect(valueFits(69000, lenient, "lte")).toBe(false);
  });

  it("refuses an operator that is not an upper bound at all", () => {
    const want = { key: "price", ops: ["lt", "lte", "gte"], admitsAtMost: 70000 };
    expect(valueFits(70000, want, "gte")).toBe(false);
    expect(valueFits(70000, want, "eq")).toBe(false);
  });

  it("passes the live case that failed at 13d4873, without loosening the check", async () => {
    // The model sent lte $1.99, which the route converted to lte 199. That
    // admits exactly what "under $2 a serving" admits.
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "ok",
        hard: [{ key: "price_per_serving_minor", op: "lte", value: usd(1.99) }],
        soft: [{ key: "function", direction: "prefer_value", value: "electrolytes", weight: 0.5 }],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const reply = await askRoute("zero sugar electrolytes under $2 a serving", "wellness-drinks");
    expect(
      checkReply(reply, {
        hard: [{ key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 }],
        soft: [{ key: "function" }],
      }),
    ).toEqual([]);
  });

  it("still reports the missing soft preference as its own failure", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "ok",
        hard: [{ key: "price_per_serving_minor", op: "lte", value: usd(1.99) }],
        soft: [],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const reply = await askRoute("zero sugar electrolytes under $2 a serving", "wellness-drinks");
    const problems = checkReply(reply, {
      hard: [{ key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 }],
      soft: [{ key: "function" }],
    });
    // The budget is accepted and the missing preference stands alone.
    expect(problems).toEqual(["missing soft function"]);
  });
});
