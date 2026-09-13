import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { FIXED_LIMITATION } from "@/domain/reply-composer";
import { detectMedicalIntent } from "@/providers/ai/AIProvider";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// Which of the two gates decides a medical refusal.
//
// The run of 21:37 declined "which one is healthiest?" as a clinical question.
// The site's own detector says it is not one, and there is a test for that. The
// model had set medicalIntent itself and the route took its word. The site's
// detector is the authority now, and it runs before any model call, so
// treatment and diagnosis requests are unaffected.

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

function ask(text: string, categoryId = "wellness-drinks") {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.91" },
    body: JSON.stringify({ sessionId: "s_medauth", categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
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

describe("a shopping question the model calls medical", () => {
  // Exactly what happened in the run: the model flagged it, the site did not.
  const FLAGGED = { reply: "I cannot say which is healthiest.", hard: [], soft: [], unmapped: [], medicalIntent: true, suggestCompare: [] };

  it("gets the fixed shopping clarification, not the clinician line", async () => {
    expect(detectMedicalIntent("Which one is healthiest?")).toBe(false);

    vi.stubGlobal("fetch", modelSays(FLAGGED));
    const body = await (await POST(ask("Which one is healthiest?"))).json();

    expect(body.medicalRedirect).toBe(false);
    expect(body.text).toBe(FIXED_LIMITATION);
    expect(body.text).not.toMatch(/clinician/i);
  });

  it("gets the same answer whichever way the model flags it", async () => {
    vi.stubGlobal("fetch", modelSays(FLAGGED));
    const flagged = await (await POST(ask("Which one is healthiest?"))).json();

    vi.stubGlobal("fetch", modelSays({ ...FLAGGED, medicalIntent: false }));
    const unflagged = await (await POST(ask("Which one is healthiest?"))).json();

    expect(flagged.text).toBe(unflagged.text);
    expect(flagged.medicalRedirect).toBe(unflagged.medicalRedirect);
  });

  it("applies nothing the model extracted when it raised the flag", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "x",
        hard: [{ key: "sugar_g", op: "lte", value: 0 }],
        soft: [],
        unmapped: [],
        medicalIntent: true,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("Which one is healthiest?"))).json();

    // A sentence one of them found troubling never becomes a filter.
    expect(body.proposals).toEqual([]);
    expect(body.question).toBeUndefined();
  });
});

describe("treatment and diagnosis are refused exactly as before", () => {
  it.each([
    ["will this heal my tendonitis?", "red-light"],
    ["can this treat my arthritis?", "red-light"],
    ["is this used to cure eczema?", "red-light"],
    ["I was diagnosed with a thyroid problem, will this help?", "red-light"],
    ["anything for chronic pain?", "cold-plunge"],
  ])("declines %s with the clinician line", async (text, categoryId) => {
    expect(detectMedicalIntent(text)).toBe(true);

    // The model is never called, so it cannot influence this either way.
    const spy = modelSays({ reply: "x", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] });
    vi.stubGlobal("fetch", spy);
    const body = await (await POST(ask(text, categoryId))).json();

    expect(body.medicalRedirect).toBe(true);
    expect(body.text).toMatch(/that is a question for a clinician/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("still refuses even when the model would have said it was fine", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "Sure, here is what helps.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("will this treat my arthritis?", "red-light"))).json();
    expect(body.medicalRedirect).toBe(true);
  });
});

describe("ordinary shopping is unaffected", () => {
  it("applies a budget the model extracted when neither gate fired", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "x",
        hard: [{ key: "price_per_serving_minor", op: "lte", value: usd(2) }],
        soft: [],
        unmapped: [],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under $2 a serving"))).json();
    expect(body.medicalRedirect).toBe(false);
    expect(body.proposals.length).toBeGreaterThan(0);
  });
});
