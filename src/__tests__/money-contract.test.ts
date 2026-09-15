import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import { matchesAll } from "@/domain/conditions";
import { toEngineConstraints } from "@/domain/model-constraints";
import { dollarsToCents, isMoneyKey, moneyContractText, moneyValueToMinorUnits } from "@/domain/money-contract";
import { getCatalog } from "@/providers";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The live run of 20:57 sent {"key":"price","op":"lte","value":700} for "under
// $700". The engine read $7.00, matched nothing, and the shopper was told their
// budget matched nothing when it matched something. Every figure below is one
// the run actually got wrong, or one that would break naive conversion.

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

describe("dollars to cents", () => {
  it.each([
    ["$700", 700, 70000],
    ["a bare 500", 500, 50000],
    ["$5,000", 5000, 500000],
    ["$2 per serving", 2, 200],
    ["$1.99", 1.99, 199],
    ["$0.99", 0.99, 99],
    ["$19.99", 19.99, 1999],
    ["$1.50", 1.5, 150],
    ["$0", 0, 0],
    ["$1234.56", 1234.56, 123456],
  ])("converts %s exactly", (_name, dollars, cents) => {
    expect(dollarsToCents(dollars)).toBe(cents);
  });

  it("does not lose a cent to floating point", () => {
    // 19.99 * 100 is 1998.9999999999998 in IEEE 754.
    expect(dollarsToCents(19.99)).toBe(1999);
    expect(dollarsToCents(2.675)).toBe(268);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
  });

  it("rounds a third decimal half away from zero", () => {
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(1.004)).toBe(100);
  });
});

describe("the boundary refuses to guess a unit", () => {
  it("accepts the contract's object form", () => {
    expect(moneyValueToMinorUnits(usd(700), "price")).toEqual({ ok: true, minorUnits: 70000 });
  });

  it("refuses a bare number, whatever its size", () => {
    for (const n of [5, 500, 700, 5000, 70000]) {
      const r = moneyValueToMinorUnits(n, "price");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/not guessed from the size of the number/i);
    }
  });

  it("refuses another currency rather than converting it", () => {
    expect(moneyValueToMinorUnits({ amount: 700, currency: "EUR" }, "price").ok).toBe(false);
  });

  it("knows which keys are money in each category", () => {
    const rl = categoryById("red-light")!;
    const wd = categoryById("wellness-drinks")!;
    expect(isMoneyKey(rl, "price")).toBe(true);
    expect(isMoneyKey(rl, "irradiance_mw_cm2")).toBe(false);
    expect(isMoneyKey(wd, "price_per_serving_minor")).toBe(true);
    expect(isMoneyKey(wd, "sugar_g")).toBe(false);
  });

  it("tells the model the same contract the converter enforces", () => {
    const text = moneyContractText(categoryById("wellness-drinks")!);
    expect(text).toContain("price_per_serving_minor");
    expect(text).toContain('"currency": "USD"');
    expect(text).toMatch(/never a bare number/i);
  });
});

describe("converting a whole payload", () => {
  const rl = categoryById("red-light")!;
  const wd = categoryById("wellness-drinks")!;

  it("converts money and leaves everything else alone", () => {
    const r = toEngineConstraints(
      rl,
      [
        { key: "price", op: "lte", value: usd(700) },
        { key: "coverage", op: "eq", value: "full_body" },
      ],
      [{ key: "footprint", direction: "prefer_low", weight: 0.5 }],
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hard).toEqual([
      { key: "price", op: "lte", value: 70000 },
      { key: "coverage", op: "eq", value: "full_body" },
    ]);
    expect(r.soft).toEqual([{ key: "footprint", direction: "prefer_low", weight: 0.5 }]);
  });

  it("converts a per-serving budget the same way", () => {
    const r = toEngineConstraints(wd, [{ key: "price_per_serving_minor", op: "lte", value: usd(2) }], []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hard[0].value).toBe(200);
  });

  it("converts money carried on a soft preference", () => {
    const r = toEngineConstraints(rl, [], [{ key: "price", direction: "prefer_low", weight: 0.5, value: usd(300) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.soft[0].value).toBe(30000);
  });

  it("fails the whole payload rather than dropping the budget", () => {
    const r = toEngineConstraints(
      rl,
      [
        { key: "price", op: "lte", value: 700 },
        { key: "coverage", op: "eq", value: "full_body" },
      ],
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).toMatchObject({ where: "hard", index: 0, key: "price" });
  });

  it("passes exists and missing through, which carry no amount", () => {
    const r = toEngineConstraints(rl, [{ key: "price", op: "exists" }], []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hard).toEqual([{ key: "price", op: "exists" }]);
  });
});

describe("end to end through the route", () => {
  let store: MemoryUsageStore;

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
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.41" },
      body: JSON.stringify({ sessionId: "s_moneycheck", categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
    });
  }

  beforeEach(() => {
    store = new MemoryUsageStore();
    resetMeterForTests(new UsageMeter(store, config));
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

  it("under $700 now matches what the shopper meant", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const expected = views.filter((v) => matchesAll(v, cat, [{ key: "price", op: "lte", value: 70000 }])).length;
    expect(expected).toBeGreaterThan(0);

    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "Here is what fits.", hard: [{ key: "price", op: "lte", value: usd(700) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("under $700"))).json();

    const proposal = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(proposal.hard[0].value).toBe(70000);
    expect(proposal.matchCount).toBe(expected);
    expect(body.matchSummary).toContain(`${expected} of the ${views.length}`);
  });

  it("a bare number fails visibly instead of searching for products under $7", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "Here is what fits.", hard: [{ key: "price", op: "lte", value: 700 }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("under $700"))).json();

    expect(body.failure).toBe("unconvertible_constraint");
    expect(body.proposals).toEqual([]);
    expect(body.notice).toMatch(/did not state a budget in a form this site can use/i);
    // Charged, because the provider did the work.
    expect(store.records[0].outcome.kind).toBe("billed");
  });

  it("$2 a serving reaches the engine as 200", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "Here is what fits.",
        hard: [{ key: "price_per_serving_minor", op: "lte", value: usd(2) }],
        soft: [],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under $2 a serving", "wellness-drinks"))).json();
    const proposal = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(proposal.hard[0].value).toBe(200);
  });

  it("a decimal budget survives the trip", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "Here is what fits.",
        hard: [{ key: "price_per_serving_minor", op: "lte", value: usd(1.99) }],
        soft: [],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under $1.99 a serving", "wellness-drinks"))).json();
    const proposal = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(proposal.hard[0].value).toBe(199);
  });
});
