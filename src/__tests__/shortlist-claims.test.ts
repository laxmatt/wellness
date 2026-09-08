import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import type { Condition } from "@/domain/category";
import { matchesAll } from "@/domain/conditions";
import { getCatalog } from "@/providers";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The live run produced "There are no products listed under $500 in the
// catalogue" while the engine matched one. These tests pin both halves of that:
// the shortlist really can exclude a matching product, and what the route
// reports must come from the engine over every product regardless.

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

const UNDER_500: Condition[] = [{ key: "price", op: "lte", value: 50000 }];
const UNDER_500_MODEL = [{ key: "price", op: "lte", value: { amount: 500, currency: "USD" } }];
const ENV = { ...process.env };
let store: MemoryUsageStore;
let sent: string[] = [];

// Captures what the model was actually shown, and answers with the intent the
// live model produced for "under 500": the constraint extracted correctly.
function modelProposing(hard: unknown[]) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
    sent = body.messages.map((m) => m.content);
    return new Response(
      JSON.stringify({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({ reply: "Here is what fits.", hard, soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }),
            },
          },
        ],
        usage: { prompt_tokens: 900, completion_tokens: 60 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

function ask(text: string) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify({ sessionId: "s_shortlistabc", categoryId: "red-light", messages: [{ role: "user", text }], hard: [], soft: [] }),
  });
}

beforeEach(() => {
  store = new MemoryUsageStore();
  resetMeterForTests(new UsageMeter(store, config));
  process.env.OPENAI_API_KEY = "sk-test-key";
  delete process.env.ASSISTANT_CREDENTIAL_MODE;
  delete process.env.OPENAI_BASE_URL;
  process.env.ASSISTANT_ALLOW_UNSHARED_LEDGER = "1";
  process.env.ASSISTANT_TRUSTED_IP_HEADER = "x-forwarded-for";
  process.env.ASSISTANT_CLIENT_SALT = "a-long-enough-test-salt";
  sent = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMeterForTests(null);
  process.env = { ...ENV };
});

describe("the hazard the $500 answer came from", () => {
  it("the engine matches a product the opening shortlist does not contain", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const matching = views.filter((v) => matchesAll(v, cat, UNDER_500));

    // If this ever became empty the case would be untestable, and the reply
    // "nothing under $500" would merely be lucky rather than right.
    expect(matching.length).toBeGreaterThan(0);

    vi.stubGlobal("fetch", modelProposing([]));
    await POST(ask("hello"));
    const catalogue = sent.find((c) => c.includes("CATALOGUE:")) ?? "";

    // The shortlist is capped at six, so at least one matching product is
    // outside what the model can see. That is why it must not speak for the set.
    const unseen = matching.filter((m) => !catalogue.includes(m.id));
    expect(unseen.length).toBeGreaterThan(0);
  });
});

describe("what the model is told about the shortlist", () => {
  it("states the shortlist size against the real category size", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });

    vi.stubGlobal("fetch", modelProposing([]));
    await POST(ask("hello"));
    const catalogue = sent.find((c) => c.includes("CATALOGUE:")) ?? "";

    expect(catalogue).toContain(`of the ${views.length} products in this category`);
    expect(catalogue).toMatch(/Do not describe this list as the catalogue/);
  });

  it("labels an unattributed value as unattributed, not as a manufacturer claim", async () => {
    vi.stubGlobal("fetch", modelProposing([]));
    await POST(ask("hello"));
    const catalogue = sent.find((c) => c.includes("CATALOGUE:")) ?? "";

    // The red-light catalogue carries values whose provenance is recorded as
    // unknown. Presenting those as a maker's claim invents an attribution.
    expect(catalogue).toContain("[unattributed]");
    expect(catalogue).toContain("[manufacturer_claim]");
  });
});

describe("what the route reports comes from the engine, not the reply", () => {
  it("returns the engine's matching set for the proposed constraint", async () => {
    const cat = categoryById("red-light")!;
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const expected = views.filter((v) => matchesAll(v, cat, UNDER_500)).map((v) => v.id).sort();

    vi.stubGlobal("fetch", modelProposing(UNDER_500_MODEL));
    const res = await POST(ask("under 500"));
    const body = await res.json();

    const proposal = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(proposal).toBeTruthy();
    expect([...proposal.matchingIds].sort()).toEqual(expected);
    expect(proposal.matchCount).toBe(expected.length);
  });

  it("counts over every product, not over the six the model was shown", async () => {
    vi.stubGlobal("fetch", modelProposing(UNDER_500_MODEL));
    const res = await POST(ask("under 500"));
    const body = await res.json();

    const proposal = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    const catalogue = sent.find((c) => c.includes("CATALOGUE:")) ?? "";
    const shownMatching = proposal.matchingIds.filter((id: string) => catalogue.includes(id));

    // The engine found something the model never saw. The count must reflect
    // the engine, so the cards and the proposal cannot agree with a reply that
    // claims nothing exists.
    expect(proposal.matchCount).toBeGreaterThan(shownMatching.length);
  });
});
