import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { coldPlunge, wellnessDrinks } from "@/domain/categories";
import { moneyContractText } from "@/domain/money-contract";
import { scoreCase } from "@/domain/evaluation-scoring";
import type { CheckableReply } from "@/domain/livetest-expectations";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The contract the model is given, and what the site does with each answer.
//
// **These tests prove what the prompt says and what the pipeline does with a
// reply. They prove nothing about what a live model returns.** A stub that
// answers correctly is a stub, not evidence. The three failures below were
// found live at 03:31, and only a live run can say whether they recur.

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
let sent: { messages: { role: string; content: string }[] } | null = null;

function modelReturns(intent: unknown) {
  return vi.fn(async (_u: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(intent) } }],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

async function ask(intent: unknown, text: string, categoryId = "wellness-drinks") {
  sent = null;
  vi.stubGlobal("fetch", modelReturns(intent));
  const res = await POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify({ sessionId: `s_ec_${Date.now()}`, categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
    }),
  );
  return res.json();
}

const intentOf = (over: Record<string, unknown>) => ({ reply: "ok", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [], ...over });
const prompt = () => sent!.messages.map((m) => m.content).join("\n\n");
const applied = (body: { proposals: { kind: string; hard?: unknown[]; soft?: unknown[] }[] }) =>
  body.proposals.find((p) => p.kind === "apply_preferences");

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

describe("decimal amounts", () => {
  // At 03:31 "under $1.60 a serving" came back as `lt 16000`, and the reply
  // read "under $160". The contract's only worked examples were on `price` at
  // 700, and the key is named `price_per_serving_minor`, which says minor
  // units in a field the contract says is dollars.

  it("works an example on every money key, at that key's own size", () => {
    const text = moneyContractText(wellnessDrinks);
    expect(text).toContain('"key": "price_per_serving_minor", "op": "lt", "value": {"amount": 1.6');
    expect(text).toContain('means "under $1.60"');
    expect(text).toContain('"key": "price", "op": "lt", "value": {"amount": 700');
  });

  it("says a key named _minor does not change what is sent", () => {
    const text = moneyContractText(wellnessDrinks);
    expect(text).toMatch(/describes how this site stores the value internally/);
    expect(text).toMatch(/\$1\.60 is \{"amount": 1\.6\}, never \{"amount": 160\}/);
  });

  it("leaves a category with one money key showing only that key", () => {
    const text = moneyContractText(coldPlunge);
    expect(text).not.toContain("price_per_serving_minor");
    expect((text.match(/"op": "lt"/g) ?? []).length).toBe(1);
  });

  it("converts a decimal the model sends correctly, when it sends one", async () => {
    const body = await ask(
      intentOf({ hard: [{ key: "price_per_serving_minor", op: "lt", value: { amount: 1.6, currency: "USD" } }] }),
      "Something under $1.60 a serving.",
    );
    expect(applied(body)!.hard).toEqual([{ key: "price_per_serving_minor", op: "lt", value: 160 }]);
    expect(body.text).toContain("price per serving under $1.60");
  });

  it("scores the wrong magnitude as a failure rather than rounding it away", () => {
    // What came back at 03:31. Nothing here guesses what was meant.
    const reply = {
      text: "",
      medicalRedirect: false,
      matchingIds: [],
      proposals: [{ kind: "apply_preferences", hard: [{ key: "price_per_serving_minor", op: "lt", value: 16000 }], soft: [] }],
    } as CheckableReply;
    const v = scoreCase(reply, { requiredHard: [{ key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 159 }] });
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0]).toMatch(/does not fit/);
  });
});

describe("a superlative is a preference, not a budget", () => {
  // At 03:31 "the cheapest one that still has a chiller" came back with
  // `price lte 549000`, to the cent the cheapest chiller tub's price, which
  // was printed in the catalogue block the model was given.

  it("tells the model which words are requirements and which are preferences", async () => {
    await ask(intentOf({}), "hello", "cold-plunge");
    expect(prompt()).toMatch(/A requirement is "hard"\. A preference is "soft"\./);
    expect(prompt()).toMatch(/"Cheapest", "smallest", "best", "prefer", "ideally" and every comparative or superlative are preferences/);
  });

  it("forbids taking a number out of the catalogue and making it a limit", async () => {
    await ask(intentOf({}), "hello", "cold-plunge");
    expect(prompt()).toMatch(/never take a number out of the CATALOGUE block and turn it into one/i);
  });

  it("no longer shows the model any product price to take", async () => {
    await ask(intentOf({}), "hello", "cold-plunge");
    const text = prompt();
    const catalogue = text.slice(text.indexOf("CATALOGUE:"));
    expect(catalogue).not.toMatch(/\$\d/);
    // The prices are real and every one of them is verified in this category,
    // so their absence is a decision, not a gap in the data.
    expect(catalogue).toContain("edge-tub-elite");
  });

  it("scores an invented budget as invented, even beside a correct constraint", () => {
    const reply = {
      text: "",
      medicalRedirect: false,
      matchingIds: ["edge-tub-elite"],
      proposals: [
        {
          kind: "apply_preferences",
          hard: [
            { key: "chiller_included", op: "eq", value: true },
            { key: "price", op: "lte", value: 549000 },
          ],
          soft: [],
        },
      ],
    } as CheckableReply;
    const v = scoreCase(reply, {
      requiredHard: [{ key: "chiller_included", ops: ["eq"], value: true }],
      requiredSoft: [{ key: "price", directions: ["prefer_low"] }],
      forbiddenHard: [{ key: "price", because: "the shopper asked for the cheapest, not for a price limit" }],
    });
    expect(v.invented).toEqual(["price"]);
    expect(v.wrongForm).toEqual(['price came back as a constraint; a preference was required']);
    expect(v.problems.some((p) => /invented hard price/.test(p))).toBe(true);
  });

  it("accepts the preference form the sentence actually asks for", () => {
    const reply = {
      text: "",
      medicalRedirect: false,
      matchingIds: ["edge-tub-elite", "plunge-original", "renu-cold-stoic-2"],
      proposals: [
        {
          kind: "apply_preferences",
          hard: [{ key: "chiller_included", op: "eq", value: true }],
          soft: [{ key: "price", direction: "prefer_low", weight: 0.5 }],
        },
      ],
    } as CheckableReply;
    const v = scoreCase(reply, {
      requiredHard: [{ key: "chiller_included", ops: ["eq"], value: true }],
      requiredSoft: [{ key: "price", directions: ["prefer_low"] }],
      forbiddenHard: [{ key: "price", because: "the shopper asked for the cheapest, not for a price limit" }],
    });
    expect(v.problems).toEqual([]);
  });
});

describe("several requirements in one sentence", () => {
  it("tells the model that dropping any of them narrows the search wrongly", async () => {
    await ask(intentOf({}), "hello");
    expect(prompt()).toMatch(/One sentence often states several things at once/);
    expect(prompt()).toMatch(/dropping two narrows their search to something they did not ask for/);
  });

  it("carries all three of the drinks sentence's requirements when they arrive", async () => {
    const body = await ask(
      intentOf({
        hard: [
          { key: "sugar_g", op: "eq", value: 0 },
          { key: "price_per_serving_minor", op: "lt", value: { amount: 2, currency: "USD" } },
          { key: "function", op: "includes", value: "electrolytes" },
        ],
      }),
      "Zero sugar electrolytes under $2 a serving",
    );
    expect(applied(body)!.hard).toEqual([
      { key: "sugar_g", op: "eq", value: 0 },
      { key: "price_per_serving_minor", op: "lt", value: 200 },
      { key: "function", op: "includes", value: "electrolytes" },
    ]);
    expect(body.matchingIds).toEqual(["lmnt-citrus-salt-30"]);
  });

  it("names each missing requirement separately when they do not", () => {
    // Two of the three repetitions at 03:31 looked exactly like this.
    const reply = {
      text: "",
      medicalRedirect: false,
      matchingIds: [],
      proposals: [{ kind: "apply_preferences", hard: [{ key: "price_per_serving_minor", op: "lt", value: 200 }], soft: [] }],
    } as CheckableReply;
    const v = scoreCase(reply, {
      requiredHard: [
        { key: "sugar_g", ops: ["eq", "lte"], atMost: 1 },
        { key: "price_per_serving_minor", ops: ["lt", "lte"], admitsAtMost: 199 },
        { key: "function", ops: ["includes"], value: "electrolytes" },
      ],
    });
    expect(v.missingHard).toEqual(["sugar_g", "function"]);
    expect(v.problems).toEqual(["missing hard sugar_g", "missing hard function"]);
  });
});

describe("the model is no longer asked to write the shopper's words", () => {
  it("says so, and keeps the reply field as a truncation canary only", async () => {
    await ask(intentOf({}), "hello");
    expect(prompt()).toMatch(/your "reply" field is not displayed to anyone/i);
    expect(prompt()).toMatch(/One short line naming what you extracted/);
  });

  it("still discards a reply with an empty one, which is what truncation looks like", async () => {
    const body = await ask(intentOf({ reply: "" }), "hello");
    expect(body.failure).toBe("unreadable_reply");
  });
});
