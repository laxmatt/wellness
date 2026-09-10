import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { wellnessDrinks } from "@/domain/categories";
import { matchesAll } from "@/domain/conditions";
import { buildFilterGroups } from "@/domain/filters";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";
import { viewsFor } from "./fixtures";

// A number nobody stated is not a fact, and must not answer a question about
// the fact.
//
// AG1 carried caffeine_mg 0 while its own note said the brand reports trace
// caffeine from green tea extract with no amount on the label. Cure and Liquid
// I.V. carried 0 with the note "No caffeine listed", which records that a
// source is silent, not that the answer is zero. All three qualified a search
// for zero caffeine as though the figure had been stated.
//
// The values are gone, not replaced: nothing here guesses what they are.

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
const drinks = () => viewsFor("wellness-drinks");
const byId = (id: string) => drinks().find((v) => v.id === id)!;

function modelReturns(intent: unknown) {
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

async function ask(intent: unknown, text: string) {
  vi.stubGlobal("fetch", modelReturns(intent));
  const res = await POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.44" },
      body: JSON.stringify({ sessionId: `s_ct_${Date.now()}`, categoryId: "wellness-drinks", messages: [{ role: "user", text }], hard: [], soft: [] }),
    }),
  );
  return res.json();
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

describe("the catalogue records what the source states, and nothing else", () => {
  it("holds no caffeine figure where the source states none", () => {
    for (const id of ["ag1-pouch-30", "cure-hydration-lemonade-14", "liquid-iv-hydration-multiplier-16"]) {
      expect(byId(id).attributes.caffeine_mg).toBeUndefined();
    }
  });

  it("keeps the note that says why, on every one of them", () => {
    for (const id of ["ag1-pouch-30", "cure-hydration-lemonade-14", "liquid-iv-hydration-multiplier-16"]) {
      const p = byId(id).provenance["attributes.caffeine_mg"];
      expect(p.verification).toBe("not_stated");
      expect(p.source.note).toBeTruthy();
    }
    expect(byId("ag1-pouch-30").provenance["attributes.caffeine_mg"].source.note).toMatch(/trace caffeine from green tea/i);
    expect(byId("cure-hydration-lemonade-14").provenance["attributes.caffeine_mg"].source.note).toMatch(/does not state that there is none/i);
  });

  it("keeps the figures that were stated", () => {
    // LMNT states zero. CELSIUS states 200. Neither is touched.
    expect(byId("lmnt-citrus-salt-30").attributes.caffeine_mg).toBe(0);
    expect(byId("celsius-sparkling-orange-12").attributes.caffeine_mg).toBe(200);
    expect(byId("lmnt-citrus-salt-30").provenance["attributes.caffeine_mg"].verification).toBe("manufacturer_reported");
  });

  it("did not invent a replacement number anywhere", () => {
    for (const id of ["ag1-pouch-30", "cure-hydration-lemonade-14", "liquid-iv-hydration-multiplier-16"]) {
      expect(Object.keys(byId(id).attributes)).not.toContain("caffeine_mg");
    }
  });
});

describe("a search for zero caffeine returns only what states zero", () => {
  const zero = [{ key: "caffeine_mg", op: "eq" as const, value: 0 }];

  it("matches LMNT alone", () => {
    expect(drinks().filter((v) => matchesAll(v, wellnessDrinks, zero)).map((v) => v.id)).toEqual(["lmnt-citrus-salt-30"]);
  });

  it("excludes the four whose sources say nothing", () => {
    const matched = drinks().filter((v) => matchesAll(v, wellnessDrinks, zero)).map((v) => v.id);
    for (const id of ["ag1-pouch-30", "cure-hydration-lemonade-14", "liquid-iv-hydration-multiplier-16", "olipop-root-beer-12"]) {
      expect(matched).not.toContain(id);
    }
  });

  it("through the real route, with the reply the shopper reads", async () => {
    const body = await ask(
      { reply: "ok", hard: [{ key: "caffeine_mg", op: "eq", value: 0 }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] },
      "No caffeine, I drink it at night.",
    );
    expect(body.matchingIds).toEqual(["lmnt-citrus-salt-30"]);
    expect(body.text).toContain("zero caffeine");
    expect(body.matchSummary).toMatch(/1 of the 6 products in this category matches/);
  });

  it("and an upper-bound search behaves the same way, since there is no figure to compare", () => {
    const underTen = [{ key: "caffeine_mg", op: "lte" as const, value: 10 }];
    expect(drinks().filter((v) => matchesAll(v, wellnessDrinks, underTen)).map((v) => v.id)).toEqual(["lmnt-citrus-salt-30"]);
  });
});

describe("the site's own filter chips agree", () => {
  it("offers Caffeine free, and it selects only the product that states zero", () => {
    const groups = buildFilterGroups(drinks(), wellnessDrinks);
    const caffeine = groups.find((g) => g.key === "caffeine_mg");
    expect(caffeine).toBeTruthy();
    const free = caffeine!.options.find((o) => /caffeine free/i.test(o.label));
    expect(free?.matchIds).toEqual(["lmnt-citrus-salt-30"]);
  });
});

describe("what the model is shown", () => {
  it("lists the unstated figure as not stated, and shows no number for it", async () => {
    let sent: { messages: { content: string }[] } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        sent = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ reply: "x", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }) } }],
            usage: { prompt_tokens: 900, completion_tokens: 20 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    await POST(
      new Request("http://localhost/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.45" },
        body: JSON.stringify({ sessionId: "s_ct_prompt", categoryId: "wellness-drinks", messages: [{ role: "user", text: "hello" }], hard: [], soft: [] }),
      }),
    );
    const prompt = sent!.messages.map((m) => m.content).join("\n");
    const start = prompt.indexOf("ag1-pouch-30");
    const rest = prompt.slice(start);
    const ag1Block = rest.slice(0, rest.indexOf("\n  ", 1) === -1 ? rest.length : rest.indexOf("\n  ", rest.indexOf("not stated")));
    expect(ag1Block).not.toMatch(/Caffeine: /);
    expect(ag1Block).toMatch(/not stated:[^\n]*Caffeine/);
  });
});
