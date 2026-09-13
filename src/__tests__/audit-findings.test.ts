import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import type { Condition } from "@/domain/category";
import { evaluateCondition, matchesAll } from "@/domain/conditions";
import { engineSummary } from "@/domain/match-claims";
import { PreferenceSet } from "@/domain/personalization";
import { applyPreferences } from "@/domain/personalization/match";
import type { ProductView } from "@/domain/view";
import { getCatalog } from "@/providers";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, monthKey, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// One test per audit finding, written to fail against the code as it was.

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
let store: MemoryUsageStore;

function modelSays(intent: Record<string, unknown>, finishReason = "stop") {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(intent) } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

function modelSaysRaw(content: string, finishReason = "stop") {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: finishReason, message: { content } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

function ask(text: string, over: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
    body: JSON.stringify({ sessionId: "s_auditcheck", categoryId: "red-light", messages: [{ role: "user", text }], hard: [], soft: [], ...over }),
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

async function redLight(): Promise<{ cat: NonNullable<ReturnType<typeof categoryById>>; views: ProductView[] }> {
  const cat = categoryById("red-light")!;
  return { cat, views: await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] }) };
}

describe("directional preferences compare values, not existence", () => {
  it("ranks the cheapest first for prefer_low on price", async () => {
    const { cat, views } = await redLight();
    const prefs = PreferenceSet.parse({ hard: [], soft: [{ key: "price", direction: "prefer_low", weight: 1 }], unmapped: [], medicalIntent: false });
    const result = applyPreferences(views, cat, prefs);

    const priced = views.filter((v) => !v.price.isDemo);
    const cheapest = [...priced].sort((a, b) => a.price.money!.amountMinor - b.price.money!.amountMinor)[0];
    const dearest = [...priced].sort((a, b) => b.price.money!.amountMinor - a.price.money!.amountMinor)[0];

    expect(result.explanations[cheapest.id].softScore).toBeGreaterThan(result.explanations[dearest.id].softScore);
  });

  it("ranks the dearest first for prefer_high on the same key", async () => {
    const { cat, views } = await redLight();
    const prefs = PreferenceSet.parse({ hard: [], soft: [{ key: "price", direction: "prefer_high", weight: 1 }], unmapped: [], medicalIntent: false });
    const result = applyPreferences(views, cat, prefs);

    const priced = views.filter((v) => !v.price.isDemo);
    const cheapest = [...priced].sort((a, b) => a.price.money!.amountMinor - b.price.money!.amountMinor)[0];
    const dearest = [...priced].sort((a, b) => b.price.money!.amountMinor - a.price.money!.amountMinor)[0];

    expect(result.explanations[dearest.id].softScore).toBeGreaterThan(result.explanations[cheapest.id].softScore);
  });

  it("gives opposite directions opposite scores, which existence-scoring could not", async () => {
    const { cat, views } = await redLight();
    const low = applyPreferences(views, cat, PreferenceSet.parse({ soft: [{ key: "price", direction: "prefer_low", weight: 1 }] }));
    const high = applyPreferences(views, cat, PreferenceSet.parse({ soft: [{ key: "price", direction: "prefer_high", weight: 1 }] }));
    const differs = views.some((v) => low.explanations[v.id].softScore !== high.explanations[v.id].softScore);
    expect(differs).toBe(true);
  });

  it("does not credit a product whose value is unknown", async () => {
    const { cat, views } = await redLight();
    const withUnknown = views.find((v) => v.attributes.irradiance_mw_cm2 === undefined);
    if (!withUnknown) return; // nothing to assert in this catalogue
    const result = applyPreferences(views, cat, PreferenceSet.parse({ soft: [{ key: "irradiance_mw_cm2", direction: "prefer_high", weight: 1 }] }));
    expect(result.explanations[withUnknown.id].softScore).toBe(0);
  });
});

describe("unknown values do not satisfy negative constraints", () => {
  it("neq is false when the attribute is not recorded", async () => {
    const cat = categoryById("wellness-drinks")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const unknownCaffeine = views.filter((v) => v.attributes.caffeine_mg === undefined);
    const c: Condition = { key: "caffeine_mg", op: "neq", value: 0 };
    for (const v of unknownCaffeine) {
      expect(evaluateCondition(v, cat, c)).toBe(false);
    }
  });

  it("still distinguishes a recorded value that genuinely differs", async () => {
    const cat = categoryById("wellness-drinks")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const withCaffeine = views.find((v) => typeof v.attributes.caffeine_mg === "number" && v.attributes.caffeine_mg !== 0);
    if (!withCaffeine) return;
    expect(evaluateCondition(withCaffeine, cat, { key: "caffeine_mg", op: "neq", value: 0 })).toBe(true);
  });
});

describe("malformed model output is rejected, never a successful empty answer", () => {
  it("does not turn unparseable JSON into a blank reply", async () => {
    vi.stubGlobal("fetch", modelSaysRaw('{"reply": "cut off here', "length"));
    const body = await (await POST(ask("under 500"))).json();
    expect(body.text).not.toBe("");
    expect(body.text).toMatch(/could not read that reliably/i);
  });

  it("does not accept an empty reply assembled from schema defaults", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "   " }));
    const body = await (await POST(ask("under 500"))).json();
    expect(body.text).toMatch(/could not read that reliably/i);
  });

  it("still charges for it, because the provider did the work", async () => {
    vi.stubGlobal("fetch", modelSaysRaw("not json at all", "length"));
    await POST(ask("under 500"));
    expect(store.records[0].outcome.kind).toBe("billed");
  });
});

describe("what the shopper reads about matches comes from the engine", () => {
  it("the site writes the count itself, from the engine", () => {
    expect(engineSummary(1, 8)).toContain("1 of the 8");
    expect(engineSummary(0, 8)).toMatch(/No products match/i);
    expect(engineSummary(8, 8)).toMatch(/All 8/);
  });

  it("the contradictory sentence from the live run cannot be shown at all now", async () => {
    const { cat, views } = await redLight();
    const under500: Condition[] = [{ key: "price", op: "lte", value: 50000 }];
    const under500Model = [{ key: "price", op: "lte", value: { amount: 500, currency: "USD" } }];
    const engineCount = views.filter((v) => matchesAll(v, cat, under500)).length;
    expect(engineCount).toBeGreaterThan(0);

    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "There are no products listed under $500 in the catalogue.",
        hard: under500Model,
        soft: [],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under 500"))).json();

    // The model's sentence is not displayed, so there is nothing to screen.
    expect(body.text).not.toMatch(/no products listed under/i);
    expect(body.matchSummary).toBe(engineSummary(engineCount, views.length));
    expect(body.matchingIds.length).toBe(engineCount);
  });
});

describe("clearing every constraint is a proposal like any other", () => {
  it("offers to clear when the shopper asks for all of them to go", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "Showing everything again.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const res = await POST(ask("actually forget the budget, show me everything", { hard: [{ key: "price", op: "lte", value: 50000 }] }));
    const body = await res.json();

    const proposal = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(proposal).toBeTruthy();
    expect(proposal.hard).toEqual([]);
    expect(proposal.summary).toMatch(/Clear every filter/i);
  });

  it("does not invent a clearing proposal when there was nothing to clear", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "What is your budget?", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("hello"))).json();
    expect(body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences")).toBeUndefined();
  });
});

describe("a reservation is recorded before the call, not only at settlement", () => {
  it("is listed as open while it is outstanding, and released on settlement", async () => {
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s_open", "client-1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(await store.listOpen(monthKey(), 0)).toHaveLength(1);
    await meter.settle(r.reservation, { kind: "billed", model: "m", inputTokens: 10, outputTokens: 10 });
    expect(await store.listOpen(monthKey(), 0)).toHaveLength(0);
  });

  it("closing an orphan holds the estimate rather than treating it as free", async () => {
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s_crash", "client-2");
    if (!r.ok) return;

    const before = await meter.snapshot("s_crash");
    expect(before.reservedUsd).toBeGreaterThan(0);

    const closed = await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0);
    expect(closed).toMatchObject({ ok: true, movedTo: "uncertain" });

    const after = await meter.snapshot("s_crash");
    expect(after.reservedUsd).toBe(0);
    // The money did not disappear: it moved from reserved to held.
    expect(after.uncertainUsd).toBeCloseTo(before.reservedUsd, 9);
    expect(await meter.closeOpen(r.reservation.id, { kind: "unknown" }, 0)).toMatchObject({ ok: false });
  });

  it("does not list a reservation that is younger than the age filter", async () => {
    const meter = new UsageMeter(store, config);
    const r = await meter.reserve("s_fresh", "client-3");
    if (!r.ok) return;
    expect(await store.listOpen(monthKey(), 10 * 60 * 1000)).toHaveLength(0);
  });
});
