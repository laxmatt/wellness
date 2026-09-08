import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { categoryById } from "@/domain/categories";
import { approvedFigures, limitationText, verifyReply } from "@/domain/reply-verification";
import type { GroundedProduct } from "@/providers/ai/OpenAIProvider";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// Each case here is a sentence the assistant actually produced in the run of
// 20:57, or the shape of one.

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

const shown: GroundedProduct[] = [
  {
    id: "hooga-pro1500",
    name: "PRO1500",
    brand: "Hooga",
    price: "$649",
    priceIsPlaceholder: false,
    facts: [
      { label: "Irradiance", value: "189 mW/cm2", evidence: "manufacturer_claim" },
      { label: "Wavelengths", value: "660 nm, 850 nm", evidence: "manufacturer_claim" },
    ],
    notStated: ["Coverage"],
  },
];

describe("figures a reply may state", () => {
  const approved = approvedFigures(shown, [1, 8]);

  it("accepts figures that are in the data it was shown", () => {
    expect(verifyReply("The maker reports 189 mW/cm2 at 660 nm and 850 nm.", approved).ok).toBe(true);
    expect(verifyReply("It is listed at $649.", approved).ok).toBe(true);
  });

  it("refuses a figure the data does not hold", () => {
    // $139 was a placeholder price the model quoted as fact.
    const v = verifyReply("The Hooga HG300 is priced at $139.", approved);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("unapproved_figure");
    expect(v.detail).toBe("139");
  });

  it("refuses an invented specification", () => {
    expect(verifyReply("It reaches 300 mW/cm2.", approved).ok).toBe(false);
  });

  it("allows small counts, which are how any list is described", () => {
    expect(verifyReply("There are 3 options worth a look.", approved).ok).toBe(true);
  });
});

describe("claims about what a product does to a body", () => {
  const approved = approvedFigures(shown, [1, 8]);

  it("refuses the wavelength explanation the run produced", () => {
    const actual =
      "660nm is in the red light range, which is often associated with surface-level skin benefits, while 850nm is in the near-infrared range, which penetrates deeper into tissues and may be associated with different therapeutic effects.";
    const v = verifyReply(actual, approved);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.reason).toBe("unsupported_claim");
  });

  it.each([
    "Red light helps with muscle recovery.",
    "It stimulates collagen production.",
    "This reduces inflammation.",
    "Cold exposure improves circulation.",
    "There are clinical benefits to this wavelength.",
  ])("refuses: %s", (text) => {
    expect(verifyReply(text, approved).ok).toBe(false);
  });

  it("leaves ordinary shopping language alone", () => {
    for (const text of [
      "Would you like to set a budget?",
      "The maker reports 189 mW/cm2.",
      "This one is a panel; the other is a handheld.",
      "I can compare these on price and coverage.",
    ]) {
      expect({ text, ok: verifyReply(text, approved).ok }).toEqual({ text, ok: true });
    }
  });

  it("says what the site can do instead of pretending to answer", () => {
    expect(limitationText("unsupported_claim")).toMatch(/does not publish claims about it/i);
    expect(limitationText("unapproved_figure")).toMatch(/only quote figures this site holds/i);
  });
});

describe("through the route", () => {
  function modelSays(reply: string) {
    return vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { content: JSON.stringify({ reply, hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }) } },
          ],
          usage: { prompt_tokens: 900, completion_tokens: 60 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }

  function ask(text: string) {
    return new Request("http://localhost/api/assistant", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.51" },
      body: JSON.stringify({ sessionId: "s_verifycheck", categoryId: "red-light", messages: [{ role: "user", text }], hard: [], soft: [] }),
    });
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

  it("replaces the wavelength explanation with a limitation", async () => {
    vi.stubGlobal(
      "fetch",
      modelSays("850nm penetrates deeper into tissues and is associated with different therapeutic effects."),
    );
    const body = await (await POST(ask("what's the difference between 660nm and 850nm?"))).json();

    expect(body.text).not.toMatch(/penetrates deeper/i);
    expect(body.text).toMatch(/what a product does to your body/i);
    expect(body.notice).toMatch(/claim this site does not publish/i);
  });

  it("still shows the site's own facts when the prose is withheld", async () => {
    vi.stubGlobal("fetch", modelSays("It stimulates collagen and improves recovery."));
    const body = await (await POST(ask("tell me about these"))).json();

    expect(body.text).toMatch(/only compare these products on the specifications/i);
    expect(body.matchSummary).toBeTruthy();
    expect(body.products.length).toBeGreaterThan(0);
    expect(body.products[0].facts.length).toBeGreaterThan(0);
    expect(body.products[0].facts[0].attribution).toMatch(/reported by the maker|verified by this site|source not recorded/);
  });

  it("lets a properly attributed, in-data reply through unchanged", async () => {
    const good = "The maker reports 189 mW/cm2 for the Hooga PRO1500. Would you like to set a budget?";
    vi.stubGlobal("fetch", modelSays(good));
    const body = await (await POST(ask("which is strongest?"))).json();
    expect(body.text).toBe(good);
    expect(body.notice).toBeUndefined();
  });
});

describe("placeholder prices never reach the model", () => {
  it("is withheld and listed as not stated", async () => {
    const cat = categoryById("red-light")!;
    const { getCatalog } = await import("@/providers");
    const views = await getCatalog().listProductViews({ categoryId: cat.id, status: ["published"] });
    const placeholder = views.find((v) => v.price.isDemo);
    expect(placeholder).toBeTruthy();

    let sentCatalogue = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
        sentCatalogue = body.messages.map((m) => m.content).join("\n");
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { content: JSON.stringify({ reply: "ok", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] }) },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    resetMeterForTests(new UsageMeter(new MemoryUsageStore(), config));
    process.env.OPENAI_API_KEY = "sk-test-key";
    process.env.ASSISTANT_ALLOW_UNSHARED_LEDGER = "1";
    process.env.ASSISTANT_TRUSTED_IP_HEADER = "x-forwarded-for";
    process.env.ASSISTANT_CLIENT_SALT = "a-long-enough-test-salt";

    await POST(
      new Request("http://localhost/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.52" },
        body: JSON.stringify({ sessionId: "s_placeholder", categoryId: "red-light", messages: [{ role: "user", text: "hello" }], hard: [], soft: [] }),
      }),
    );

    expect(sentCatalogue).toContain("price not stated");
    expect(sentCatalogue).not.toContain("placeholder price");
    resetMeterForTests(null);
    process.env = { ...ENV };
  });
});
