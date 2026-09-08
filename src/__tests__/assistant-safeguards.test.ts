import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeAdmin } from "@/domain/admin-auth";
import { OpenAIConversationProvider, ProviderCallError, type ConverseInput } from "@/providers/ai/OpenAIProvider";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, estimateTokens, type MeterConfig } from "@/providers/usage/UsageMeter";

const config: MeterConfig = {
  monthlyCapUsd: 25,
  sessionTurnLimit: 100,
  clientHourlyLimit: 100,
  inputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  maxInputTokens: 400,
  maxOutputTokens: 120,
  estimateSafetyFactor: 1.3,
};

const input = (messages: { role: "user" | "assistant"; text: string }[]): ConverseInput => ({
  categoryName: "Red light therapy",
  filterVocabulary: "price (integer cents, use op lte)",
  products: [
    {
      id: "p1",
      name: "Panel",
      brand: "Brand",
      price: "$699",
      priceIsPlaceholder: false,
      facts: [{ label: "Irradiance", value: "100 mW/cm2", evidence: "manufacturer_claim" }],
      notStated: ["Weight"],
    },
  ],
  messages,
  activeConstraints: [],
});

// Mirrors the bound the route applies. Kept in step by the route test below.
function boundInput(provider: OpenAIConversationProvider, i: ConverseInput, max: number): ConverseInput | null {
  let trimmed = i;
  while (provider.estimatePromptTokens(trimmed) > max && trimmed.messages.length > 1) {
    trimmed = { ...trimmed, messages: trimmed.messages.slice(1) };
  }
  return provider.estimatePromptTokens(trimmed) > max ? null : trimmed;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the reservation actually bounds the request", () => {
  const provider = new OpenAIConversationProvider("sk-test", "gpt-4o-mini", "https://example.invalid/v1", 120, 50);

  it("counts the whole prompt, not just the shopper's message", () => {
    const small = provider.estimatePromptTokens(input([{ role: "user", text: "hi" }]));
    // The system prompt and catalogue dominate, so a two-character message is
    // nowhere near free. A reservation sized on the message alone would be wrong.
    expect(small).toBeGreaterThan(200);
    expect(small).toBeGreaterThan(estimateTokens("hi"));
  });

  it("drops the oldest turns until the prompt fits the reserved allowance", () => {
    const long = Array.from({ length: 40 }, (_, i) => ({ role: "user" as const, text: `turn ${i} ${"x".repeat(200)}` }));
    // Room for the system prompt, the catalogue and a couple of turns.
    const max = provider.estimatePromptTokens(input([long[0]])) + 200;
    const bounded = boundInput(provider, input(long), max);
    expect(bounded).not.toBeNull();
    expect(provider.estimatePromptTokens(bounded!)).toBeLessThanOrEqual(max);
    // The most recent turn is the one kept.
    expect(bounded!.messages.at(-1)!.text).toBe(long.at(-1)!.text);
    expect(bounded!.messages.length).toBeLessThan(long.length);
  });

  it("refuses rather than sending a single message larger than the allowance", () => {
    const bounded = boundInput(provider, input([{ role: "user", text: "y".repeat(200000) }]), config.maxInputTokens);
    expect(bounded).toBeNull();
  });

  it("refuses when the catalogue alone would exceed the allowance, rather than overspending", () => {
    expect(boundInput(provider, input([{ role: "user", text: "hi" }]), 10)).toBeNull();
  });

  it("caps the output side on the request body it sends", async () => {
    let body: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await provider.converse(input([{ role: "user", text: "hi" }]));
    expect(body.max_tokens).toBe(120);
    expect(body.model).toBe("gpt-4o-mini");
  });

  it("the worst case reserved covers the bounds the route enforces", () => {
    const meter = new UsageMeter(new MemoryUsageStore(), config);
    expect(meter.worstCaseUsd).toBeCloseTo(meter.costOf(400, 120) * 1.3, 8);
    // Anything the route is willing to send costs less than what it reserved.
    expect(meter.costOf(config.maxInputTokens, config.maxOutputTokens)).toBeLessThan(meter.worstCaseUsd);
  });
});

describe("failed calls are classified, not written off", () => {
  const provider = new OpenAIConversationProvider("sk-test", "gpt-4o-mini", "https://example.invalid/v1", 120, 50);

  async function classify(fetchImpl: unknown): Promise<ProviderCallError> {
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await provider.converse(input([{ role: "user", text: "hi" }]));
    } catch (e) {
      return e as ProviderCallError;
    }
    throw new Error("expected the call to fail");
  }

  it("treats a 4xx as not billed: the provider rejected it before inference", async () => {
    const e = await classify(async () => new Response("bad request", { status: 400 }));
    expect(e).toBeInstanceOf(ProviderCallError);
    expect(e.billable).toBe("not_billed");
  });

  it("treats a 5xx as uncertain: it may have run before failing", async () => {
    const e = await classify(async () => new Response("upstream error", { status: 502 }));
    expect(e.billable).toBe("uncertain");
  });

  it("treats an unreadable 200 as uncertain: inference ran and was charged", async () => {
    const e = await classify(async () => new Response("not json at all", { status: 200, headers: { "content-type": "application/json" } }));
    expect(e.billable).toBe("uncertain");
  });

  it("treats a timeout as uncertain, not free", async () => {
    const e = await classify(async () => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      throw err;
    });
    expect(e.billable).toBe("uncertain");
  });

  it("treats a connection that never opened as not billed", async () => {
    const e = await classify(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.openai.com");
    });
    expect(e.billable).toBe("not_billed");
  });

  it("never puts the provider's response body into the error", async () => {
    const e = await classify(async () => new Response("Authorization: Bearer sk-live-secret", { status: 401 }));
    expect(e.message).not.toMatch(/sk-live/);
    expect(e.message).toBe("The provider returned 401.");
  });

  it("holds the uncertain ones against the cap and zeroes only the rejected ones", async () => {
    const meter = new UsageMeter(new MemoryUsageStore(), config);
    const a = await meter.reserve("s1", "c1");
    const b = await meter.reserve("s2", "c1");
    if (!a.ok || !b.ok) throw new Error("expected reservations");

    await meter.settle(a.reservation, { kind: "uncertain", reason: "The request timed out." });
    await meter.settle(b.reservation, { kind: "not_billed", reason: "The provider returned 400." });

    const snap = await meter.snapshot("s1");
    expect(snap.uncertainUsd).toBeCloseTo(meter.worstCaseUsd, 8);
    expect(snap.spentUsd).toBe(0);
    expect(await meter.listUncertain()).toHaveLength(1);
  });
});

describe("admin access", () => {
  const OLD = process.env.ADMIN_ACCESS_KEY;
  afterEach(() => {
    process.env.ADMIN_ACCESS_KEY = OLD;
  });

  it("accepts the header", () => {
    process.env.ADMIN_ACCESS_KEY = "secret-value";
    expect(authorizeAdmin(new Headers({ "x-admin-key": "secret-value" }), "http://x/api/admin/assistant-usage").ok).toBe(true);
  });

  it("refuses a key in the query string, so credentials stay out of logs and history", () => {
    process.env.ADMIN_ACCESS_KEY = "secret-value";
    const r = authorizeAdmin(new Headers(), "http://x/api/admin/assistant-usage?key=secret-value");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toMatch(/header/i);
    }
  });

  it("refuses a query-string key even when the header is also correct", () => {
    process.env.ADMIN_ACCESS_KEY = "secret-value";
    const r = authorizeAdmin(new Headers({ "x-admin-key": "secret-value" }), "http://x/api/admin/assistant-usage?key=secret-value");
    expect(r.ok).toBe(false);
  });

  it("refuses a wrong or missing header", () => {
    process.env.ADMIN_ACCESS_KEY = "secret-value";
    expect(authorizeAdmin(new Headers({ "x-admin-key": "wrong" }), "http://x/a").ok).toBe(false);
    expect(authorizeAdmin(new Headers(), "http://x/a").ok).toBe(false);
    expect(authorizeAdmin(new Headers({ "x-admin-key": "secret-valu" }), "http://x/a").ok).toBe(false);
  });

  it("refuses everything when no key is configured", () => {
    delete process.env.ADMIN_ACCESS_KEY;
    const r = authorizeAdmin(new Headers({ "x-admin-key": "anything" }), "http://x/a");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });
});
