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

  it("keeps the figure that was stated", () => {
    // CELSIUS states 200 on its own back label, read on 2026-09-11.
    expect(byId("celsius-sparkling-orange-12").attributes.caffeine_mg).toBe(200);
    expect(byId("celsius-sparkling-orange-12").provenance["attributes.caffeine_mg"].verification).toBe("manufacturer_reported");
  });

  // This asserted LMNT's zero for as long as the zero stood. It came from a
  // 2026-09-08 search summary, and three direct readings of the maker's own
  // pages then failed to find any caffeine statement for this flavour: the
  // product page on 2026-09-09, the FAQ and the ingredients page on 2026-09-11.
  // The only amount the maker states is 50 mg, for Lemonade Iced Tea.
  //
  // Withdrawing it does not say the product contains caffeine. It says this
  // catalogue does not know, which is what was true all along.
  it("withdrew a zero that three readings could not find", () => {
    const lmnt = byId("lmnt-citrus-salt-30");
    expect(lmnt.attributes.caffeine_mg).toBeUndefined();
    const p = lmnt.provenance["attributes.caffeine_mg"];
    expect(p.verification).toBe("not_stated");
    expect(p.source.note).toMatch(/Lemonade Iced Tea/);
    expect(p.source.note).toMatch(/does not say this product contains caffeine/i);
  });

  // Silence is still not a zero. This one is not silence: the maker's own page
  // about caffeine names the four flavours that carry it and states that the
  // rest do not, which is a statement about this flavour made in one sentence
  // about all of them.
  it("records a zero the maker stated by naming every exception to it", () => {
    const olipop = byId("olipop-root-beer-12");
    expect(olipop.attributes.caffeine_mg).toBe(0);
    const p = olipop.provenance["attributes.caffeine_mg"];
    expect(p.verification).toBe("manufacturer_reported");
    expect(p.source.method).toBe("direct");
    expect(p.source.url).toBe("https://drinkolipop.com/blogs/digest/does-olipop-have-caffeine");
    expect(p.source.note).toMatch(/rest of our flavors are caffeine-free/i);
    // The distinction has to survive in the note, because it is the whole
    // reason this record may hold a number and the others may not.
    expect(p.source.note).toMatch(/silence is still not a zero/i);
  });

  it("did not invent a replacement number anywhere", () => {
    for (const id of ["ag1-pouch-30", "cure-hydration-lemonade-14", "liquid-iv-hydration-multiplier-16"]) {
      expect(Object.keys(byId(id).attributes)).not.toContain("caffeine_mg");
    }
  });
});

// The answer is derived from the records, not written down beside them. These
// asserted "LMNT alone", which was true while LMNT was the only drink whose
// record stated a zero. OLIPOP's maker states, on its own page about caffeine,
// that four named flavours carry caffeine and the rest do not, so Classic Root
// Beer now states a zero too and the right answer has two products in it. A
// frozen answer would have called that regression.
describe("a search for zero caffeine returns only what states zero", () => {
  const zero = [{ key: "caffeine_mg", op: "eq" as const, value: 0 }];
  // Every drink whose own record carries a usable zero, in catalogue order.
  const statesZero = () => drinks().filter((v) => v.attributes.caffeine_mg === 0).map((v) => v.id);
  const statesNothing = () => drinks().filter((v) => v.attributes.caffeine_mg === undefined).map((v) => v.id);

  it("matches exactly the drinks whose own record states zero", () => {
    expect(statesZero().length, "at least one drink should state zero").toBeGreaterThan(0);
    expect(drinks().filter((v) => matchesAll(v, wellnessDrinks, zero)).map((v) => v.id)).toEqual(statesZero());
  });

  it("excludes every drink whose source says nothing", () => {
    const matched = drinks().filter((v) => matchesAll(v, wellnessDrinks, zero)).map((v) => v.id);
    expect(statesNothing().length, "some gaps should remain").toBeGreaterThan(0);
    for (const id of statesNothing()) expect(matched, id).not.toContain(id);
  });

  it("through the real route, with the reply the shopper reads", async () => {
    const body = await ask(
      { reply: "ok", hard: [{ key: "caffeine_mg", op: "eq", value: 0 }], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] },
      "No caffeine, I drink it at night.",
    );
    const expected = statesZero();
    expect([...body.matchingIds].sort()).toEqual([...expected].sort());
    expect(body.text).toContain("zero caffeine");
    expect(body.matchSummary).toMatch(new RegExp(`${expected.length} of the ${drinks().length} products in this category match`));
  });

  it("and an upper-bound search behaves the same way, since there is no figure to compare", () => {
    const underTen = [{ key: "caffeine_mg", op: "lte" as const, value: 10 }];
    expect(drinks().filter((v) => matchesAll(v, wellnessDrinks, underTen)).map((v) => v.id)).toEqual(statesZero());
  });
});

describe("the site's own filter chips agree", () => {
  it("offers Caffeine free, and it selects exactly the drinks that state zero", () => {
    const groups = buildFilterGroups(drinks(), wellnessDrinks);
    const caffeine = groups.find((g) => g.key === "caffeine_mg");
    expect(caffeine).toBeTruthy();
    const free = caffeine!.options.find((o) => /caffeine free/i.test(o.label));
    expect(free?.matchIds).toEqual(drinks().filter((v) => v.attributes.caffeine_mg === 0).map((v) => v.id));
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
