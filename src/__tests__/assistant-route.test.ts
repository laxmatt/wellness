import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// Drives the real route handler, not a copy of its logic. Everything the route
// reads from the environment is set here, and the provider is exercised through
// a stubbed fetch so the classification, the bound and the settlement are the
// ones that will run in production.

const config: MeterConfig = {
  monthlyCapUsd: 25,
  sessionTurnLimit: 20,
  clientHourlyLimit: 5,
  inputUsdPerMillion: 0.15,
  outputUsdPerMillion: 0.6,
  maxInputTokens: 6000,
  maxOutputTokens: 500,
  estimateSafetyFactor: 1.3,
};

let store: MemoryUsageStore;
let meter: UsageMeter;
const ENV = { ...process.env };

function ask(text: string, headers: Record<string, string> = { "x-forwarded-for": "203.0.113.7" }) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({
      sessionId: "s_livetestabc",
      categoryId: "red-light",
      messages: [{ role: "user", text }],
      hard: [],
      soft: [],
    }),
  });
}

function openAiReply(body: unknown, status = 200) {
  return vi.fn(async (...args: [string, RequestInit]) => {
    void args;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}

const INTENT = {
  choices: [{ message: { content: JSON.stringify({ reply: "Here are a few to look at.", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }) } }],
};

beforeEach(() => {
  store = new MemoryUsageStore();
  meter = new UsageMeter(store, config);
  resetMeterForTests(meter);
  process.env.OPENAI_API_KEY = "sk-test-key";
  delete process.env.ASSISTANT_CREDENTIAL_MODE;
  delete process.env.OPENAI_BASE_URL;
  process.env.ASSISTANT_ALLOW_UNSHARED_LEDGER = "1";
  process.env.ASSISTANT_TRUSTED_IP_HEADER = "x-forwarded-for";
  process.env.ASSISTANT_CLIENT_SALT = "a-long-enough-test-salt";
  delete process.env.ASSISTANT_ALLOW_UNIDENTIFIED_CLIENTS;
  delete process.env.VERCEL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMeterForTests(null);
  process.env = { ...ENV };
});

describe("the assistant route settles what it spends", () => {
  it("records a billed call with the provider's own token counts", async () => {
    vi.stubGlobal("fetch", openAiReply({ ...INTENT, usage: { prompt_tokens: 1200, completion_tokens: 90 } }));
    const res = await POST(ask("something for my knees under $700"));
    const body = await res.json();

    expect(body.mode).toBe("live");
    expect(store.records).toHaveLength(1);
    expect(store.records[0].outcome).toEqual({ kind: "billed", model: "gpt-4o-mini", inputTokens: 1200, outputTokens: 90 });
    const snap = await meter.snapshot("s_livetestabc");
    expect(snap.spentUsd).toBeCloseTo(meter.costOf(1200, 90), 8);
    expect(snap.reservedUsd).toBe(0);
    expect(snap.uncertainUsd).toBe(0);
  });

  it("holds the reservation when a readable reply reports no usage", async () => {
    vi.stubGlobal("fetch", openAiReply(INTENT));
    const res = await POST(ask("under $700"));
    const body = await res.json();

    // The shopper still gets their answer.
    expect(body.mode).toBe("live");
    expect(body.text).toBeTruthy();
    // The budget does not assume it was free.
    expect(store.records[0].outcome.kind).toBe("uncertain");
    const snap = await meter.snapshot("s_livetestabc");
    expect(snap.spentUsd).toBe(0);
    expect(snap.uncertainUsd).toBeCloseTo(meter.worstCaseUsd, 8);
    expect(await meter.listUncertain()).toHaveLength(1);
  });

  it("treats zero-token usage as unknown rather than free", async () => {
    vi.stubGlobal("fetch", openAiReply({ ...INTENT, usage: { prompt_tokens: 0, completion_tokens: 0 } }));
    await POST(ask("under $700"));
    expect(store.records[0].outcome.kind).toBe("uncertain");
  });

  it("settles a provider rejection at zero", async () => {
    vi.stubGlobal("fetch", openAiReply({ error: { message: "bad request", type: "invalid_request_error" } }, 400));
    const res = await POST(ask("under $700"));
    const body = await res.json();

    expect(body.mode).toBe("unavailable");
    expect(store.records[0].outcome.kind).toBe("not_billed");
    const snap = await meter.snapshot("s_livetestabc");
    expect(snap.spentUsd).toBe(0);
    expect(snap.uncertainUsd).toBe(0);
    expect(snap.reservedUsd).toBe(0);
  });

  it("holds a 4xx that did not come from the provider", async () => {
    // A gateway in front of the provider, with no OpenAI error body. We have no
    // evidence the request was refused before inference.
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>403 Forbidden</html>", { status: 403 })));
    await POST(ask("under $700"));
    expect(store.records[0].outcome.kind).toBe("uncertain");
  });

  it("holds a 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream", { status: 502 })));
    await POST(ask("under $700"));
    expect(store.records[0].outcome.kind).toBe("uncertain");
  });

  it("never leaks the provider's response body to the client", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Authorization: Bearer sk-live-secret", { status: 500 })));
    const res = await POST(ask("under $700"));
    expect(JSON.stringify(await res.json())).not.toMatch(/sk-live/);
  });

  it("stops at the monthly cap without calling the provider", async () => {
    resetMeterForTests(new UsageMeter(store, { ...config, monthlyCapUsd: 0 }));
    const fetchMock = openAiReply({ ...INTENT, usage: { prompt_tokens: 10, completion_tokens: 10 } });
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the bounded request, capped on both sides", async () => {
    const fetchMock = openAiReply({ ...INTENT, usage: { prompt_tokens: 10, completion_tokens: 10 } });
    vi.stubGlobal("fetch", fetchMock);
    await POST(ask("under $700"));
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const sent = JSON.parse(String(init.body));
    expect(sent.max_tokens).toBe(500);
    // The catalogue the model sees is a shortlist, never the whole database.
    const catalogue = sent.messages.find((m: { content: string }) => m.content.includes("CATALOGUE:")).content;
    expect(catalogue.split("\n").filter((l: string) => /^ {2}\S/.test(l)).length).toBeLessThanOrEqual(6);
  });
});

describe("the route refuses to spend without a trustworthy client address", () => {
  it("refuses when no trusted header is configured", async () => {
    delete process.env.ASSISTANT_TRUSTED_IP_HEADER;
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("unavailable");
    expect(body.notice).toMatch(/rate limiting/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the configured header is absent from the request", async () => {
    process.env.ASSISTANT_TRUSTED_IP_HEADER = "cf-connecting-ip";
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the salt is missing or too short", async () => {
    process.env.ASSISTANT_CLIENT_SALT = "short";
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("unavailable");
    expect(body.notice).toMatch(/SALT/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts two forged addresses as two clients, and stops both at the hourly limit", async () => {
    resetMeterForTests(new UsageMeter(store, { ...config, clientHourlyLimit: 2, sessionTurnLimit: 100 }));
    vi.stubGlobal("fetch", openAiReply({ ...INTENT, usage: { prompt_tokens: 10, completion_tokens: 10 } }));

    // Two requests from one address are allowed, the third is not.
    for (let i = 0; i < 2; i++) expect((await (await POST(ask("hi", { "x-forwarded-for": "198.51.100.5" }))).json()).mode).toBe("live");
    const blocked = await (await POST(ask("hi", { "x-forwarded-for": "198.51.100.5" }))).json();
    expect(blocked.mode).toBe("unavailable");
    expect(blocked.notice).toMatch(/connection/i);
  });
});

describe("the route never calls the provider when it must not", () => {
  it("answers a medical question without a model call", async () => {
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("will this cure my arthritis?"))).json();
    expect(body.medicalRedirect).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.records).toHaveLength(0);
  });

  it("refuses an unshared ledger rather than enforcing a private cap", async () => {
    delete process.env.ASSISTANT_ALLOW_UNSHARED_LEDGER;
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("unavailable");
    expect(body.notice).toMatch(/shared spend tracking/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("works with no key at all, and labels the reply a prototype", async () => {
    delete process.env.OPENAI_API_KEY;
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("prototype");
    expect(body.matchingIds.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.records).toHaveLength(0);
  });
});

describe("proxy-credential mode keeps every control in place", () => {
  // The credential lives outside this process. Nothing else about the route
  // changes: the ledger, the client limit and the bounds all still apply.
  function proxyMode() {
    delete process.env.OPENAI_API_KEY;
    process.env.ASSISTANT_CREDENTIAL_MODE = "proxy";
  }

  it("runs live with no key present, and sends no authorization header", async () => {
    proxyMode();
    const fetchMock = openAiReply({ ...INTENT, usage: { prompt_tokens: 800, completion_tokens: 60 } });
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("something for my knees under $700"))).json();

    expect(body.mode).toBe("live");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("still reserves and settles against the ledger", async () => {
    proxyMode();
    vi.stubGlobal("fetch", openAiReply({ ...INTENT, usage: { prompt_tokens: 800, completion_tokens: 60 } }));
    await POST(ask("under $700"));
    expect(store.records[0].outcome).toEqual({ kind: "billed", model: "gpt-4o-mini", inputTokens: 800, outputTokens: 60 });
    expect((await meter.snapshot("s_livetestabc")).spentUsd).toBeCloseTo(meter.costOf(800, 60), 8);
  });

  it("still holds an uncertain charge when usage is missing", async () => {
    proxyMode();
    vi.stubGlobal("fetch", openAiReply(INTENT));
    await POST(ask("under $700"));
    expect(store.records[0].outcome.kind).toBe("uncertain");
    expect((await meter.snapshot("s_livetestabc")).uncertainUsd).toBeCloseTo(meter.worstCaseUsd, 8);
  });

  it("still stops at the monthly cap without calling out", async () => {
    proxyMode();
    resetMeterForTests(new UsageMeter(store, { ...config, monthlyCapUsd: 0 }));
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    expect((await (await POST(ask("under $700"))).json()).mode).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses without a trustworthy client address", async () => {
    proxyMode();
    delete process.env.ASSISTANT_TRUSTED_IP_HEADER;
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    expect((await (await POST(ask("under $700"))).json()).mode).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still refuses without a private salt", async () => {
    proxyMode();
    delete process.env.ASSISTANT_CLIENT_SALT;
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    expect((await (await POST(ask("under $700"))).json()).mode).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still enforces the per-connection hourly limit", async () => {
    proxyMode();
    resetMeterForTests(new UsageMeter(store, { ...config, clientHourlyLimit: 1, sessionTurnLimit: 100 }));
    vi.stubGlobal("fetch", openAiReply({ ...INTENT, usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    expect((await (await POST(ask("hi"))).json()).mode).toBe("live");
    const blocked = await (await POST(ask("hi"))).json();
    expect(blocked.mode).toBe("unavailable");
    expect(blocked.notice).toMatch(/connection/i);
  });

  it("still answers a medical question without calling out", async () => {
    proxyMode();
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("will this cure my arthritis?"))).json();
    expect(body.medicalRedirect).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when proxy mode is pointed away from OpenAI", async () => {
    proxyMode();
    process.env.OPENAI_BASE_URL = "https://evil.example/v1";
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("unavailable");
    expect(body.notice).toMatch(/api\.openai\.com/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store.records).toHaveLength(0);
  });

  it("refuses when a key is set as well, rather than choosing", async () => {
    process.env.ASSISTANT_CREDENTIAL_MODE = "proxy";
    process.env.OPENAI_API_KEY = "sk-test-key";
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    const body = await (await POST(ask("under $700"))).json();
    expect(body.mode).toBe("unavailable");
    expect(body.notice).toMatch(/Remove one/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unrecognised mode disables the assistant instead of guessing", async () => {
    process.env.ASSISTANT_CREDENTIAL_MODE = "definitely-not-a-mode";
    const fetchMock = openAiReply(INTENT);
    vi.stubGlobal("fetch", fetchMock);
    expect((await (await POST(ask("under $700"))).json()).mode).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
