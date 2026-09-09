import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { coldPlunge, redLight, wellnessDrinks } from "@/domain/categories";
import { PreferenceSet } from "@/domain/personalization";
import { applyPreferences } from "@/domain/personalization/match";
import { toEngineConstraints } from "@/domain/model-constraints";
import { matchesAll } from "@/domain/conditions";
import { describeConstraint } from "@/domain/personalization/describe";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";
import { viewsFor } from "./fixtures";

// Three defects found by reading the source and proved against the real route
// before anything was changed.

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

async function ask(intent: unknown, text: string, categoryId: string) {
  vi.stubGlobal("fetch", modelReturns(intent));
  const res = await POST(
    new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.31" },
      body: JSON.stringify({ sessionId: `s_rr_${Date.now()}`, categoryId, messages: [{ role: "user", text }], hard: [], soft: [] }),
    }),
  );
  return res.json();
}

const intentOf = (over: Record<string, unknown>) => ({ reply: "ok", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [], ...over });

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

describe("every matching product is ranked, not just the first four", () => {
  // The route ordered by bestMatchId plus three alternativeIds and gave
  // everything else the same sort key, so from the fifth product on the order
  // was whatever the catalogue happened to be in. "Whichever red light panel
  // is least expensive" showed eight products with a preference score of 0
  // above one scoring 24.3, four rows down.

  it("the engine reports a full order, not four ids", () => {
    const r = applyPreferences(viewsFor("red-light"), redLight, PreferenceSet.parse({ soft: [{ key: "price", direction: "prefer_low", weight: 1 }] }));
    expect(r.rankedIds).toHaveLength(8);
    expect(r.rankedIds.slice(0, 4)).toEqual([r.bestMatchId, ...r.alternativeIds]);
  });

  it("the route's product order is the engine's, all the way down", async () => {
    const body = await ask(intentOf({ soft: [{ key: "price", direction: "prefer_low", weight: 1 }] }), "Whichever red light panel is least expensive.", "red-light");
    const r = applyPreferences(viewsFor("red-light"), redLight, PreferenceSet.parse({ soft: [{ key: "price", direction: "prefer_low", weight: 1 }] }));
    expect(body.matchingIds).toEqual(r.rankedIds);
  });

  it("the tail is ordered by the preference, which is what failed", async () => {
    const body = await ask(intentOf({ soft: [{ key: "price", direction: "prefer_low", weight: 1 }] }), "Whichever red light panel is least expensive.", "red-light");
    const r = applyPreferences(viewsFor("red-light"), redLight, PreferenceSet.parse({ soft: [{ key: "price", direction: "prefer_low", weight: 1 }] }));
    const scores = (body.matchingIds as string[]).map((id) => r.explanations[id].softScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // The pair that was inverted: a product scoring 0 sat above one scoring 24.3.
    const zero = body.matchingIds.indexOf("joovv-solo-3");
    const better = body.matchingIds.indexOf("mito-mitopro-1500-plus");
    expect(better).toBeLessThan(zero);
  });
});

describe("a relaxation offers to set aside what the product misses", () => {
  // Relaxation.keptKey is the constraint a route HONOURS. The route rendered
  // "Set aside {keptLabel}" and removed keptKey, so pressing the offer that
  // protected the budget removed the budget and kept the chiller requirement
  // the product did not meet.
  const hard = [
    { key: "chiller_included", op: "eq" as const, value: true },
    { key: "price", op: "lte" as const, value: 500000 },
  ];

  it("the engine names what each route's product fails", () => {
    const r = applyPreferences(viewsFor("cold-plunge"), coldPlunge, PreferenceSet.parse({ hard }));
    const byKept = Object.fromEntries(r.relaxations.map((x) => [x.keptKey, x]));
    expect(byKept.price.droppedKeys).toEqual(["chiller_included"]);
    expect(byKept.chiller_included.droppedKeys).toEqual(["price"]);
  });

  it("keeps the promise it makes: setting the offer aside admits something", async () => {
    // The test that matters. The old offer named the constraint each route
    // KEPT, so "set aside the budget and show the closest option" removed the
    // budget and left the chiller requirement, which that route's product does
    // not meet. Label and key agreed with each other and both disagreed with
    // the product the route had chosen.
    const body = await ask(
      intentOf({ hard: [{ key: "chiller_included", op: "eq", value: true }, { key: "price", op: "lte", value: usd(5000) }] }),
      "A tub with a chiller, up to $5,000.",
      "cold-plunge",
    );
    expect(body.matchingIds).toEqual([]);
    const relax = body.proposals.filter((p: { kind: string }) => p.kind === "relax_constraint");
    expect(relax.length).toBeGreaterThan(0);

    const views = viewsFor("cold-plunge");
    const r = applyPreferences(views, coldPlunge, PreferenceSet.parse({ hard }));

    for (const route of r.relaxations) {
      const product = views.find((v) => v.id === route.productId)!;
      // Dropping what the route says to drop admits the product it chose.
      const afterDropping = hard.filter((c) => !route.droppedKeys.includes(c.key));
      expect(matchesAll(product, coldPlunge, afterDropping)).toBe(true);
      // Dropping the constraint the route KEEPS does not: that was the offer
      // the panel used to make, and the product it promised never qualified.
      const afterDroppingTheKeptOne = hard.filter((c) => c.key !== route.keptKey);
      expect(matchesAll(product, coldPlunge, afterDroppingTheKeptOne)).toBe(false);
    }

    for (const p of relax as { key: string; summary: string }[]) {
      const constraint = hard.find((c) => c.key === p.key)!;
      expect(p.summary).toContain(describeConstraint(coldPlunge, constraint));
    }
  });

  it("offers both constraints, since either is a way out of no match", async () => {
    const body = await ask(
      intentOf({ hard: [{ key: "chiller_included", op: "eq", value: true }, { key: "price", op: "lte", value: usd(5000) }] }),
      "A tub with a chiller, up to $5,000.",
      "cold-plunge",
    );
    const keys = body.proposals.filter((p: { kind: string }) => p.kind === "relax_constraint").map((p: { key: string }) => p.key);
    expect(keys.sort()).toEqual(["chiller_included", "price"]);
  });
});

describe("a direction has to mean something on the key it points at", () => {
  // "The smallest cold plunge you have" came back as tub_type prefer_low
  // "inflatable" at 05:37. Barrel, tub and inflatable carry no ranks, so
  // nothing is lower than anything, and the site printed "Ranking for lower
  // tub_type" while scoring an equality match instead.

  it("refuses a direction on an unordered enum", () => {
    const r = toEngineConstraints(coldPlunge, [], [{ key: "tub_type", direction: "prefer_low", value: "inflatable", weight: 0.5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/unordered set of options/);
  });

  it("refuses a direction on a list", () => {
    const r = toEngineConstraints(coldPlunge, [], [{ key: "placement", direction: "prefer_high", weight: 0.5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/a list of values/);
  });

  it("keeps a direction on a ranked enum", () => {
    expect(toEngineConstraints(coldPlunge, [], [{ key: "plumbing", direction: "prefer_low", weight: 0.5 }]).ok).toBe(true);
    expect(toEngineConstraints(redLight, [], [{ key: "coverage", direction: "prefer_high", weight: 0.5 }]).ok).toBe(true);
  });

  it("keeps a direction on price and on a number", () => {
    expect(toEngineConstraints(coldPlunge, [], [{ key: "price", direction: "prefer_low", weight: 1 }]).ok).toBe(true);
    expect(toEngineConstraints(redLight, [], [{ key: "footprint", direction: "prefer_low", weight: 1 }]).ok).toBe(true);
  });

  it("accepts prefer_value naming a real option", () => {
    expect(toEngineConstraints(coldPlunge, [], [{ key: "tub_type", direction: "prefer_value", value: "inflatable", weight: 0.5 }]).ok).toBe(true);
  });

  it("refuses prefer_value naming an option the category does not have", () => {
    const r = toEngineConstraints(coldPlunge, [], [{ key: "tub_type", direction: "prefer_value", value: "hot_tub", weight: 0.5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/has no option "hot_tub"/);
  });

  it("refuses prefer_value with nothing to prefer", () => {
    const r = toEngineConstraints(coldPlunge, [], [{ key: "tub_type", direction: "prefer_value", weight: 0.5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/no value to prefer/);
  });

  it("fails the reply visibly rather than ranking by something meaningless", async () => {
    const body = await ask(
      intentOf({ soft: [{ key: "tub_type", direction: "prefer_low", value: "inflatable", weight: 0.5 }] }),
      "The smallest cold plunge you have.",
      "cold-plunge",
    );
    expect(body.failure).toBe("unconvertible_constraint");
    expect(body.proposals).toEqual([]);
    expect(body.text).not.toMatch(/Ranking for lower tub_type/);
  });
});

describe("what the shopper reads never names a column", () => {
  it("uses the category's label for a preference, not the raw key", async () => {
    const body = await ask(intentOf({ soft: [{ key: "price_per_serving_minor", direction: "prefer_low", weight: 0.5 }] }), "ideally cheap", "wellness-drinks");
    expect(body.text).not.toContain("price_per_serving_minor");
    expect(body.text).toMatch(/Ranking for lower price per serving/i);
  });

  it("does the same for an enum key with no short label", async () => {
    const body = await ask(intentOf({ soft: [{ key: "plumbing", direction: "prefer_low", weight: 0.5 }] }), "simple setup", "cold-plunge");
    expect(body.text).not.toContain("plumbing,");
    expect(body.text).toMatch(/Ranking for lower power and plumbing/i);
  });
});

describe("a preference's target has to be a thing the key can hold", () => {
  // The directional branch returned as soon as an ordinal basis existed, so a
  // target on that branch was never looked at, and prefer_value with an empty
  // list passed vacuously: nothing in it was unknown, and nothing in it was
  // anything to prefer either.

  it("refuses a string target on a number", () => {
    const r = toEngineConstraints(redLight, [], [{ key: "footprint", direction: "prefer_low", value: "small", weight: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/has no option "small"/);
  });

  it("refuses a string target on price", () => {
    const r = toEngineConstraints(coldPlunge, [], [{ key: "price", direction: "prefer_low", value: "cheap", weight: 1 }]);
    expect(r.ok).toBe(false);
  });

  it("refuses an unknown option on a ranked enum, whichever direction", () => {
    const r = toEngineConstraints(redLight, [], [{ key: "coverage", direction: "prefer_high", value: "enormous", weight: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/has no option "enormous"/);
  });

  it("refuses an empty list to rank towards", () => {
    const r = toEngineConstraints(coldPlunge, [], [{ key: "tub_type", direction: "prefer_value", value: [], weight: 0.5 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/empty list to rank towards/);
  });

  it("keeps a rank target on a ranked enum", () => {
    expect(toEngineConstraints(redLight, [], [{ key: "coverage", direction: "prefer_high", value: "full_body", weight: 1 }]).ok).toBe(true);
  });

  it("keeps a money target on a money key, judged by the money converter", () => {
    const ok = toEngineConstraints(coldPlunge, [], [{ key: "price", direction: "prefer_low", value: { amount: 500, currency: "USD" }, weight: 1 }]);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.soft[0].value).toBe(50000);
    // And a bare number for money is still the money converter's refusal, in
    // its own words, not a shape complaint from here.
    const bad = toEngineConstraints(coldPlunge, [], [{ key: "price", direction: "prefer_low", value: 500, weight: 1 }]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems[0].reason).toMatch(/must be sent as/);
  });

  it("keeps a numeric target on a number, and a name on a list", () => {
    // `footprint` is a ranked enum, so its target is an option value, not a
    // rank number: the engine looks the value up among the options.
    expect(toEngineConstraints(wellnessDrinks, [], [{ key: "caffeine_mg", direction: "prefer_low", value: 0, weight: 1 }]).ok).toBe(true);
    expect(toEngineConstraints(coldPlunge, [], [{ key: "placement", direction: "prefer_value", value: "outdoor", weight: 1 }]).ok).toBe(true);
  });

  it("refuses a rank number where the enum wants one of its option values", () => {
    const r = toEngineConstraints(redLight, [], [{ key: "footprint", direction: "prefer_low", value: 1, weight: 1 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0].reason).toMatch(/has no option 1/);
  });

  it("keeps a directional preference with no target at all", () => {
    expect(toEngineConstraints(coldPlunge, [], [{ key: "price", direction: "prefer_low", weight: 1 }]).ok).toBe(true);
  });
});

describe("the no-match sentence does not promise a way out that is not there", () => {
  // Every pair of these is empty, so no single removal admits anything: no
  // chiller tub costs under $50 or runs without plumbing, and nothing at all
  // costs under $50.
  const three = [
    { key: "chiller_included", op: "eq" as const, value: true },
    { key: "price", op: "lte" as const, value: 5000 },
    { key: "plumbing", op: "eq" as const, value: "none" },
  ];

  it("says one would do, when one would", async () => {
    const body = await ask(
      intentOf({ hard: [{ key: "chiller_included", op: "eq", value: true }, { key: "price", op: "lte", value: usd(5000) }] }),
      "A tub with a chiller, up to $5,000.",
      "cold-plunge",
    );
    expect(body.matchSummary).toMatch(/so one of them would have to be relaxed/);
  });

  it("says more than one, when one will not", async () => {
    // No chiller tub is under $5,000 and none needs no plumbing, so dropping
    // any single constraint still leaves nothing.
    const views = viewsFor("cold-plunge");
    for (const dropped of three) {
      const rest = three.filter((c) => c !== dropped);
      expect(views.some((v) => matchesAll(v, coldPlunge, rest))).toBe(false);
    }

    const body = await ask(
      intentOf({
        hard: [
          { key: "chiller_included", op: "eq", value: true },
          { key: "price", op: "lte", value: usd(50) },
          { key: "plumbing", op: "eq", value: "none" },
        ],
      }),
      "A tub with a chiller under $50 that needs no plumbing.",
      "cold-plunge",
    );
    expect(body.matchingIds).toEqual([]);
    expect(body.matchSummary).toMatch(/Setting aside any single one of them still leaves nothing/);
    expect(body.matchSummary).not.toMatch(/so one of them would have to be relaxed/);
    expect(body.text).toMatch(/Setting aside any single one of them still leaves nothing/);
  });
});
