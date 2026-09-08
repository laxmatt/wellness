import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { authorizeAdmin } from "@/domain/admin-auth";
import { resolveClientIdentity, resolveClientIp, resolveClientSalt, type ClientEnv } from "@/domain/client-identity";
import { boundInput } from "@/domain/request-bounds";
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
  catalogueSize: 8,
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

  it("keeps the deadline running while the response body is read", async () => {
    // A provider that answers with headers and then stops sending. Clearing the
    // timeout once headers arrive would leave this hanging until the platform
    // killed the function, with the reservation still open.
    const server = await stalling();
    try {
      const p = new OpenAIConversationProvider("sk-test", "gpt-4o-mini", `http://127.0.0.1:${server.port}/v1`, 120, 300);
      const started = Date.now();
      const e = await p.converse(input([{ role: "user", text: "hi" }])).catch((err) => err as ProviderCallError);
      expect(e).toBeInstanceOf(ProviderCallError);
      // Aborted at the deadline, not left to hang.
      expect(Date.now() - started).toBeLessThan(3000);
      // Headers arrived, so the request reached the provider. Not free.
      expect((e as ProviderCallError).billable).toBe("uncertain");
    } finally {
      await server.close();
    }
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

  it("reports usage as unknown rather than zero when the provider omits it", async () => {
    const reply = { choices: [{ message: { content: "{}" } }] };
    for (const usage of [undefined, {}, { prompt_tokens: 10 }, { prompt_tokens: "x", completion_tokens: 2 }, { prompt_tokens: 0, completion_tokens: 0 }]) {
      vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ...reply, usage }), { status: 200, headers: { "content-type": "application/json" } }));
      const res = await provider.converse(input([{ role: "user", text: "hi" }]));
      expect(res.usage).toBeNull();
    }
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ...reply, usage: { prompt_tokens: 5, completion_tokens: 3 } }), { status: 200, headers: { "content-type": "application/json" } }));
    expect((await provider.converse(input([{ role: "user", text: "hi" }]))).usage).toEqual({ inputTokens: 5, outputTokens: 3 });
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

  it("treats a provider 4xx as not billed, on the evidence of its error body", async () => {
    const e = await classify(async () =>
      new Response(JSON.stringify({ error: { message: "bad request", type: "invalid_request_error" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(e).toBeInstanceOf(ProviderCallError);
    expect(e.billable).toBe("not_billed");
  });

  it("holds a 4xx with no provider error body: an intermediary is not evidence", async () => {
    const e = await classify(async () => new Response("<html>403 Forbidden</html>", { status: 403 }));
    expect(e.billable).toBe("uncertain");
  });

  it("holds a 408, which means cut off rather than refused", async () => {
    const e = await classify(async () => new Response(JSON.stringify({ error: { message: "timeout" } }), { status: 408, headers: { "content-type": "application/json" } }));
    expect(e.billable).toBe("uncertain");
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
    expect(e.billable).toBe("uncertain");
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

describe("identifying the client", () => {
  const salt: ClientEnv = { ASSISTANT_CLIENT_SALT: "a-long-enough-test-salt" };

  it("reads only the header the operator named", () => {
    const headers = new Headers({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "1.1.1.1" });
    const r = resolveClientIp(headers, { ...salt, ASSISTANT_TRUSTED_IP_HEADER: "cf-connecting-ip" });
    expect(r.ok && r.ip).toBe("198.51.100.9");
  });

  it("ignores x-forwarded-for when nothing says it can be trusted", () => {
    // The important case. A caller sends this header themselves; a proxy that
    // appends leaves the leftmost value under their control.
    const r = resolveClientIp(new Headers({ "x-forwarded-for": "1.2.3.4" }), salt);
    expect(r.ok).toBe(false);
  });

  it("trusts x-forwarded-for on Vercel, which overwrites it", () => {
    const r = resolveClientIp(new Headers({ "x-forwarded-for": "203.0.113.4, 10.0.0.1" }), { ...salt, VERCEL: "1" });
    expect(r.ok && r.ip).toBe("203.0.113.4");
  });

  it("fails when the named header is missing rather than falling back", () => {
    const r = resolveClientIp(new Headers({ "x-real-ip": "203.0.113.4" }), { ...salt, ASSISTANT_TRUSTED_IP_HEADER: "cf-connecting-ip" });
    expect(r.ok).toBe(false);
  });

  it("requires a private salt of real length", () => {
    expect(resolveClientSalt({}).ok).toBe(false);
    expect(resolveClientSalt({ ASSISTANT_CLIENT_SALT: "wellness" }).ok).toBe(false);
    expect(resolveClientSalt(salt).ok).toBe(true);
  });

  it("stores a hash, not an address, and separates two addresses", () => {
    const env = { ...salt, ASSISTANT_TRUSTED_IP_HEADER: "x-real-ip" };
    const a = resolveClientIdentity(new Headers({ "x-real-ip": "198.51.100.1" }), env);
    const b = resolveClientIdentity(new Headers({ "x-real-ip": "198.51.100.2" }), env);
    expect(a.ok && b.ok && a.key).not.toBe(b.ok && b.key);
    expect(a.ok && a.key).not.toMatch(/198\.51/);
    expect(a.ok && a.key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("a different salt gives a different key for the same address", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.1" });
    const a = resolveClientIdentity(headers, { ASSISTANT_CLIENT_SALT: "salt-number-one-value", ASSISTANT_TRUSTED_IP_HEADER: "x-real-ip" });
    const b = resolveClientIdentity(headers, { ASSISTANT_CLIENT_SALT: "salt-number-two-value", ASSISTANT_TRUSTED_IP_HEADER: "x-real-ip" });
    expect(a.ok && a.key).not.toBe(b.ok && b.key);
  });

  it("only buckets everyone together when explicitly asked to, for a local run", () => {
    expect(resolveClientIdentity(new Headers(), salt).ok).toBe(false);
    const local = resolveClientIdentity(new Headers(), { ...salt, ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS: "1" });
    expect(local.ok && local.key).toBe("local-unidentified");
  });
});

// A server that answers with headers and a content-length it never satisfies.
async function stalling(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json", "content-length": "200" });
    res.write("{");
    // Never ends.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
