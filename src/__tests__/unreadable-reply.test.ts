import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// A reply nothing could be read from is a failure, and the shopper's filters
// are not part of the failure. The empty `hard` and `soft` of the placeholder
// intent mean "nothing was understood", and the route used to read them as
// "the shopper wants no constraints", which produced a proposal to clear every
// filter they had set.

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

function raw(content: string, finishReason = "stop") {
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

// A shopper who already narrowed things down before the bad reply arrived.
const WITH_FILTERS = {
  hard: [{ key: "price", op: "lte", value: 70000 }],
  soft: [{ key: "coverage", direction: "prefer_high", weight: 0.5 }],
};

function ask(text: string, over: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.31" },
    body: JSON.stringify({ sessionId: "s_unreadable1", categoryId: "red-light", messages: [{ role: "user", text }], hard: [], soft: [], ...over }),
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

const BROKEN: [string, string, string][] = [
  ["truncated json", '{"reply": "Here is what I fo', "length"],
  ["not json at all", "I think you should buy the Hooga.", "stop"],
  ["schema violation", JSON.stringify({ reply: "ok", hard: [{ key: "price", op: "less_than", value: 50000 }] }), "stop"],
  ["empty reply", JSON.stringify({ reply: "   " }), "stop"],
];

describe.each(BROKEN)("a %s reply, while the shopper has filters applied", (_name, content, finish) => {
  it("names the failure explicitly", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    const body = await (await POST(ask("what about something smaller", WITH_FILTERS))).json();
    expect(body.failure).toBe("unreadable_reply");
    expect(body.text).toMatch(/could not read that reliably/i);
  });

  it("proposes nothing at all", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    const body = await (await POST(ask("what about something smaller", WITH_FILTERS))).json();
    expect(body.proposals).toEqual([]);
  });

  it("never offers to clear the filters the shopper set", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    const body = await (await POST(ask("what about something smaller", WITH_FILTERS))).json();
    const clearing = body.proposals.find((p: { summary?: string }) => /clear every filter/i.test(p.summary ?? ""));
    expect(clearing).toBeUndefined();
  });

  it("keeps the shopper's constraints exactly as they were", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    const body = await (await POST(ask("what about something smaller", WITH_FILTERS))).json();
    expect(body.activeConstraints.map((c: { key: string }) => c.key)).toContain("price");
  });

  it("shows the products the existing filters select, not the whole catalogue", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    const filtered = await (await POST(ask("what about something smaller", WITH_FILTERS))).json();

    vi.stubGlobal("fetch", raw(content, finish));
    const unfiltered = await (await POST(ask("what about something smaller"))).json();

    expect(filtered.matchingIds.length).toBeLessThan(unfiltered.matchingIds.length);
  });

  it("still carries the authored summary, describing what is actually shown", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    const body = await (await POST(ask("what about something smaller", WITH_FILTERS))).json();
    expect(body.matchSummary).toBeTruthy();
    expect(body.matchSummary).toContain(String(body.matchingIds.length));
  });

  it("tells the shopper nothing was changed", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    const body = await (await POST(ask("what about something smaller", WITH_FILTERS))).json();
    expect(body.notice).toMatch(/nothing has been changed/i);
  });

  it("still records the call as billed, because the provider did the work", async () => {
    vi.stubGlobal("fetch", raw(content, finish));
    await POST(ask("what about something smaller", WITH_FILTERS));
    expect(store.records[0].outcome.kind).toBe("billed");
  });
});

describe("a readable reply is unaffected", () => {
  it("carries no failure marker and may still propose", async () => {
    vi.stubGlobal(
      "fetch",
      raw(
        JSON.stringify({
          reply: "Narrowing to under $500.",
          hard: [{ key: "price", op: "lte", value: 50000 }],
          soft: [],
          unmapped: [],
          medicalIntent: false,
          suggestCompare: [],
        }),
      ),
    );
    const body = await (await POST(ask("under 500"))).json();
    expect(body.failure).toBeUndefined();
    expect(body.proposals.length).toBeGreaterThan(0);
  });
});
