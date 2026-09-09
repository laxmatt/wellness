import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// What the model is told, read from the request the route actually sends.
//
// This proves the instructions, not the extraction. Whether a live model then
// reads "under $2" as `lt` is a question only a paid run answers, and nothing
// here should be read as evidence that it does.
//
// The run of 2026-09-09T01:35 returned `price_per_serving_minor lte 200` for a
// sentence that admits at most 199. The model was following instructions. Two
// parts of the prompt taught it that:
//
//   - MONEY gave "under $700" as an `lte` example, twice, and never showed
//     `lt` at all.
//   - FILTERS described price as "integer cents, use op lte", contradicting
//     the MONEY block on the unit as well as the operator.
//
// The same run dropped "electrolytes", which is a value of the `function` list
// key. FILTERS named the key and never its values, while enum keys carried
// theirs.

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

function captureRequest() {
  return vi.fn(async (_url: string, init: { body: string }) => {
    sent = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ reply: "ok", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }) },
          },
        ],
        usage: { prompt_tokens: 900, completion_tokens: 20 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

async function promptFor(categoryId: string): Promise<string> {
  sent = null;
  vi.stubGlobal("fetch", captureRequest());
  await POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.44" },
      body: JSON.stringify({ sessionId: `s_prompt_${categoryId}`, categoryId, messages: [{ role: "user", text: "hello" }], hard: [], soft: [] }),
    }),
  );
  expect(sent).not.toBeNull();
  return sent!.messages.map((m) => m.content).join("\n\n");
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

describe("the budget operator", () => {
  it("shows lt and lte as different requests, with the same amount", async () => {
    const prompt = await promptFor("wellness-drinks");
    expect(prompt).toMatch(/"op": "lt".*means "under \$700", which excludes \$700 exactly/);
    expect(prompt).toMatch(/"op": "lte".*means "\$700 or less", which includes \$700 exactly/);
  });

  it("says which words select which operator", async () => {
    const prompt = await promptFor("wellness-drinks");
    expect(prompt).toMatch(/"Under", "below" and "less than" are lt/);
    expect(prompt).toMatch(/"Up to", "at most", "no more than" and "or less" are lte/);
  });

  it("never gives lte as the way to say under", async () => {
    // The instruction that produced the failure, in the exact shape it had.
    for (const id of ["red-light", "cold-plunge", "wellness-drinks"]) {
      const prompt = await promptFor(id);
      expect(prompt).not.toMatch(/"op": "lte"[^\n]*means "under/);
    }
  });

  it("no longer tells the model to send cents, or to always use lte", async () => {
    for (const id of ["red-light", "cold-plunge", "wellness-drinks"]) {
      const prompt = await promptFor(id);
      expect(prompt).not.toContain("integer cents, use op lte");
      expect(prompt).not.toMatch(/price \(integer cents/);
    }
  });
});

describe("list filters carry their values", () => {
  it("names the values a list key can take, as enum keys already did", async () => {
    const prompt = await promptFor("wellness-drinks");
    const filters = prompt.split("\n").find((l) => l.startsWith("FILTERS:"))!;
    expect(filters).toMatch(/function \(list; use op "includes" with the value as a string, or an array of strings for alternatives; values include [^)]*electrolytes/);
  });

  it("takes them from the catalogue, not from a hard-coded list", async () => {
    // cold-plunge's `placement` is a list too, and carries its own values.
    const prompt = await promptFor("cold-plunge");
    const filters = prompt.split("\n").find((l) => l.startsWith("FILTERS:"))!;
    expect(filters).toMatch(/placement \(list; use op "includes"[^)]*; values include \w/);
    expect(filters).not.toMatch(/placement \([^)]*electrolytes/);
  });

  it("still describes a list key with no stated values", async () => {
    const prompt = await promptFor("red-light");
    expect(prompt).toMatch(/FILTERS:.*\(list; use op "includes"/);
  });
});

describe("the instruction to extract everything in the sentence", () => {
  it("is present, and names no particular sentence", async () => {
    const prompt = await promptFor("wellness-drinks");
    expect(prompt).toMatch(/One sentence often states several constraints at once/);
    expect(prompt).toMatch(/Extract every one of them, not only the budget/);
    // If this ever fails, someone taught the prompt the test suite's sentences.
    expect(prompt.toLowerCase()).not.toContain("zero sugar electrolytes");
  });
});

describe("what this file does not establish", () => {
  it("checks the instructions only: no live model answered any of these", async () => {
    const prompt = await promptFor("wellness-drinks");
    expect(prompt).toContain("MONEY:");
    // A stub returned a fixed empty intent. Nothing here is evidence that a
    // real model reads "under $2" as lt, or finds sugar_g, or finds function.
    // Only a paid run answers that, and paid testing is paused.
  });
});
