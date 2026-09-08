import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import type { Condition } from "@/domain/category";
import { matchesAll } from "@/domain/conditions";
import { engineSummary, screenModelClaims, statedCounts } from "@/domain/match-claims";
import { getCatalog } from "@/providers";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// Two separate claims, tested separately, because only one of them is a
// guarantee: the summary this code authors from the engine is always correct,
// and the screen over the model's prose is a backstop that catches what its
// patterns happen to cover.

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

const UNDER_500: Condition[] = [{ key: "price", op: "lte", value: 50000 }];
const ENV = { ...process.env };

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

function ask(text: string, over: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.21" },
    body: JSON.stringify({ sessionId: "s_summarycheck", categoryId: "red-light", messages: [{ role: "user", text }], hard: [], soft: [], ...over }),
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

describe("the authored summary, which is the guarantee", () => {
  it("is present on every reply and states the engine's count", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const expected = views.filter((v) => matchesAll(v, cat, UNDER_500)).length;

    vi.stubGlobal("fetch", modelSays({ reply: "Sure.", hard: UNDER_500, soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("under 500"))).json();

    expect(body.matchSummary).toBe(engineSummary(expected, views.length));
    expect(body.matchSummary).toContain(`${expected} of the ${views.length}`);
    expect(body.matchingIds).toHaveLength(expected);
  });

  it("is present even when the model was never reached", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "x" }));
    const body = await (await POST(ask("will this treat my arthritis?"))).json();
    expect(body.medicalRedirect).toBe(true);
    expect(body.matchSummary).toBeTruthy();
  });

  it("agrees with the cards it sits beside, whatever the model said", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });

    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "Seven products match that easily.", hard: UNDER_500, soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("under 500"))).json();
    expect(body.matchSummary).toBe(engineSummary(body.matchingIds.length, views.length));
  });
});

describe("the screen over the model's prose, which is a backstop", () => {
  it("reads a stated product count out of prose", () => {
    expect(statedCounts("Three products match that.")).toEqual([3]);
    expect(statedCounts("2 of the 8 products fit.")).toEqual([2]);
    expect(statedCounts("No products match.")).toEqual([0]);
  });

  it("does not mistake money or specifications for counts", () => {
    expect(statedCounts("Two panels are under $700 with 660nm and 850nm diodes.")).toEqual([2]);
    expect(statedCounts("It costs $649 and reaches 189 mW/cm2.")).toEqual([]);
  });

  it("replaces a wrong numeric count even when availability is right", () => {
    const r = screenModelClaims("Seven products match that.", 1, 8);
    expect(r.replaced).toBe(true);
    expect(r.reason).toBe("count");
    expect(r.text).toBe(engineSummary(1, 8));
  });

  it("accepts a correct count, and the category size mentioned alongside it", () => {
    expect(screenModelClaims("1 of the 8 products matches.", 1, 8).replaced).toBe(false);
    expect(screenModelClaims("There are 8 products here and 3 options fit.", 3, 8).replaced).toBe(false);
  });

  it("catches paraphrased contradictions, not only the sentence from the live run", () => {
    for (const text of [
      "There are no products listed under $500 in the catalogue.",
      "Unfortunately nothing here matches that budget.",
      "None of these fit under $500.",
      "I couldn't find any at that price.",
      "We don't have any options that cheap.",
      "Sorry, no options are available below that.",
      "Everything is above your budget.",
      "No matching products are listed.",
    ]) {
      const r = screenModelClaims(text, 1, 8);
      expect({ text, replaced: r.replaced }).toEqual({ text, replaced: true });
    }
  });

  it("catches the reverse paraphrases when the engine found nothing", () => {
    for (const text of [
      "Here are a few options that fit.",
      "These match what you asked for.",
      "I found several products that match.",
      "The following products qualify.",
    ]) {
      expect(screenModelClaims(text, 0, 8).replaced).toBe(true);
    }
  });

  it("leaves ordinary language alone", () => {
    for (const text of [
      "No caffeine in this one, and it is under $30.",
      "This one has no sugar at all.",
      "Would you like to set a budget?",
      "The maker reports 189 mW/cm2 at 6 inches.",
      "I can compare these on price and coverage.",
    ]) {
      expect({ text, replaced: screenModelClaims(text, 3, 8).replaced }).toEqual({ text, replaced: false });
    }
  });

  it("is documented as a backstop, and misses are survivable because the summary is not", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });

    // A contradiction phrased in a way no pattern anticipates. The screen misses
    // it, which is the honest limit of pattern matching. The authored summary
    // beside it is still right, which is why the miss is survivable.
    const sneaky = "Your budget rules out this entire category, I am afraid.";
    expect(screenModelClaims(sneaky, 1, 8).replaced).toBe(false);

    vi.stubGlobal("fetch", modelSays({ reply: sneaky, hard: UNDER_500, soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("under 500"))).json();
    expect(body.text).toBe(sneaky);
    expect(body.matchSummary).toBe(engineSummary(body.matchingIds.length, views.length));
    expect(body.matchingIds.length).toBeGreaterThan(0);
  });

  it("the route replaces the contradiction it can see, and says it did", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "There are no products listed under $500 in the catalogue.",
        hard: UNDER_500,
        soft: [],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under 500"))).json();
    expect(body.text).not.toMatch(/no products listed under/i);
    expect(body.notice).toMatch(/the count shown here is the site's/i);
  });
});
