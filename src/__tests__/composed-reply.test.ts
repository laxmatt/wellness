import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import { matchesAll } from "@/domain/conditions";
import { engineSummary } from "@/domain/match-claims";
import { FIXED_LIMITATION, composeReply, looksLikeQuestion } from "@/domain/reply-composer";
import { getCatalog } from "@/providers";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The model interprets preferences. Everything a shopper reads as fact is
// written by this site. These tests send the exact sentences the live run
// produced and assert that none of them reach the screen.

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
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.71" },
    body: JSON.stringify({ sessionId: "s_composed", categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
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

// Every one of these is a sentence the model actually produced in the run of
// 2026-09-08T20:57, or the failure mode it demonstrated.
const REAL_MODEL_PROSE: [string, string][] = [
  [
    "a wellness explanation",
    "660nm is in the red light range, which is often associated with surface-level skin benefits, while 850nm penetrates deeper into tissues and may be associated with different therapeutic effects.",
  ],
  ["a placeholder price quoted as fact", "The Hooga HG300 is a compact device with a targeted coverage area, priced at $139."],
  ["an unattributed figure", "It has an irradiance of 73 mW/cm² and comes with a stand for easy use."],
  ["internal markers leaked", "Renu Therapy Cold Stoic 2.0: 36 °F [manufacturer_claim]"],
  ["a contradiction of the engine", "There are no products listed under $500 in the catalogue."],
];

describe.each(REAL_MODEL_PROSE)("%s never reaches the shopper", (_name, prose) => {
  it("is not in the reply text", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: prose, hard: [{ key: "price", op: "lte", value: usd(500) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("under 500"))).json();
    expect(body.text).not.toContain(prose);
    // Nor any fragment of it: the whole string is dropped, not filtered.
    expect(body.text).not.toMatch(/139|73 mW|manufacturer_claim|therapeutic|penetrates/i);
  });
});

describe("what the shopper reads instead", () => {
  it("states the constraint this site applied, and the engine's count", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const count = views.filter((v) => matchesAll(v, cat, [{ key: "price", op: "lte", value: 50000 }])).length;

    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "anything at all", hard: [{ key: "price", op: "lte", value: usd(500) }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("under 500"))).json();

    expect(body.text).toContain(engineSummary(count, views.length));
    expect(body.text).toMatch(/I have read that as/i);
    expect(body.matchSummary).toBe(engineSummary(count, views.length));
  });

  it("gives the fixed limitation for a question this site cannot answer", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({ reply: "850nm penetrates deeper into tissue.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
    );
    const body = await (await POST(ask("what's the difference between 660nm and 850nm?"))).json();
    expect(body.text).toBe(FIXED_LIMITATION);
    expect(body.text).toMatch(/this site does not publish claims about that/i);
  });

  it("invites a preference when nothing was understood and nothing was asked", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "Hello there.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("hi"))).json();
    expect(body.text).toMatch(/Tell me what matters to you/i);
  });

  it("keeps the medical redirect, which is decided before any model call", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "x", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("will this heal my tendonitis?"))).json();
    expect(body.medicalRedirect).toBe(true);
    expect(body.text).toMatch(/that is a question for a clinician/i);
  });

  it("says what it cannot compare, from the model's unmapped list", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays({
        reply: "x",
        hard: [{ key: "price", op: "lte", value: usd(500) }],
        soft: [],
        unmapped: ["how it tastes"],
        medicalIntent: false,
        suggestCompare: [],
      }),
    );
    const body = await (await POST(ask("under 500 and tasty"))).json();
    expect(body.text).toMatch(/does not compare how it tastes/i);
  });
});

describe("product facts on the cards come from the catalogue", () => {
  it("carries a value and who says so, and never a placeholder price", async () => {
    vi.stubGlobal("fetch", modelSays({ reply: "x", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }));
    const body = await (await POST(ask("show me something"))).json();

    expect(body.products.length).toBeGreaterThan(0);
    for (const p of body.products) {
      for (const f of p.facts) {
        expect(f.attribution).toMatch(/verified by this site|reported by the maker|source not recorded/);
      }
    }
  });
});

describe("the templates themselves", () => {
  const cat = categoryById("red-light")!;

  it("tells a question from a statement", () => {
    expect(looksLikeQuestion("what's the difference between 660nm and 850nm?")).toBe(true);
    expect(looksLikeQuestion("How cold do these get")).toBe(true);
    expect(looksLikeQuestion("under 500")).toBe(false);
    expect(looksLikeQuestion("something small for my face")).toBe(false);
  });

  it("never mentions a figure that did not come from the engine or the constraint", () => {
    const text = composeReply({
      cat,
      hard: [{ key: "price", op: "lte", value: 50000 }],
      soft: [],
      unmapped: [],
      matchCount: 1,
      totalProducts: 8,
      changed: true,
      clearing: false,
      lastUserText: "under 500",
    });
    const numbers = [...text.matchAll(/\d+/g)].map((m) => m[0]);
    for (const n of numbers) expect(["500", "1", "8"]).toContain(n);
  });

  it("describes clearing without pretending a constraint remains", () => {
    const text = composeReply({
      cat,
      hard: [],
      soft: [],
      unmapped: [],
      matchCount: 8,
      totalProducts: 8,
      changed: true,
      clearing: true,
      lastUserText: "show me everything",
    });
    expect(text).toMatch(/Clearing every filter/i);
    expect(text).toContain(engineSummary(8, 8));
  });
});
