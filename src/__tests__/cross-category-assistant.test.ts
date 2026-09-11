import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The real route handler, on both of its routes.
//
// "Scripted" and "live" are not two implementations of this behaviour. The
// route answers a cross-category message itself, above the provider, so neither
// the stand-in nor a model is asked. These tests prove that by running the same
// message through both configurations and asserting the same answer, and by
// asserting that the live configuration never called fetch.

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
const ENV = { ...process.env };

type Body = {
  text: string;
  mode: string;
  products: unknown[];
  unconfirmedPrice: unknown[];
  proposals: unknown[];
  links?: { href: string; label: string }[];
  activeConstraints: { key: string; label: string }[];
  matchSummary: string;
};

function ask(categoryId: string, text: string, hard: unknown[] = []) {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
    body: JSON.stringify({ sessionId: "s_crosscatxyz", categoryId, messages: [{ role: "user", text }], hard, soft: [] }),
  });
}

function goLive() {
  process.env.OPENAI_API_KEY = "sk-test-key";
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

// No key configured is what selects the scripted stand-in. There is no mode
// name for it: `resolveCredential` returns {mode:"none"} when api_key mode has
// no key, and anything else is a misconfiguration the route refuses to run.
function goScripted() {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ASSISTANT_CREDENTIAL_MODE;
}

beforeEach(() => {
  store = new MemoryUsageStore();
  resetMeterForTests(new UsageMeter(store, config));
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

describe("a red-light shopper asks about cold plunges", () => {
  const MESSAGE = "what about cold plunges?";

  it("answers with a link to the cold plunge page on the scripted route", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", MESSAGE))).json();
    expect(body.mode).toBe("prototype");
    expect(body.links).toEqual([{ href: "/cold-plunge", label: "Go to Cold Plunges" }]);
    expect(body.text).toContain("Cold Plunges");
  });

  it("answers identically on the live route, without calling the model", async () => {
    const fetchSpy = goLive();
    const body: Body = await (await POST(ask("red-light", MESSAGE))).json();
    expect(body.mode).toBe("live");
    expect(body.links).toEqual([{ href: "/cold-plunge", label: "Go to Cold Plunges" }]);
    // No call, so nothing to settle and nothing to pay for.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.records).toHaveLength(0);
  });

  it("proposes nothing and shows no red-light products beside it", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", MESSAGE))).json();
    expect(body.proposals).toEqual([]);
    expect(body.products).toEqual([]);
    expect(body.unconfirmedPrice).toEqual([]);
  });

  // The count goes with the cards. "All 8 products in this category match" is
  // true and answers a question nobody asked, and the panel renders it in bold
  // as the site's own figure directly under a sentence about another section.
  it("counts nothing, because it is not about the products on this page", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", MESSAGE))).json();
    expect(body.matchSummary).toBe("");
  });

  it("leaves the shopper's own filters exactly as they set them", async () => {
    goScripted();
    const held = [{ key: "price", op: "lte", value: 70000 }];
    const body: Body = await (await POST(ask("red-light", MESSAGE, held))).json();
    expect(body.activeConstraints.map((c) => c.key)).toEqual(["price"]);
    expect(body.text).toContain("not changed anything");
  });
});

describe("a subject this site has no catalogue for", () => {
  it("says so and links every section it does have", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "do you have vitamins?"))).json();
    expect(body.text).toContain("no vitamins catalogue");
    expect(body.links?.map((l) => l.href)).toEqual(["/red-light", "/cold-plunge", "/wellness-drinks"]);
    expect(body.proposals).toEqual([]);
    expect(body.products).toEqual([]);
    expect(body.matchSummary).toBe("");
  });

  it("still reports the filters the shopper is holding", async () => {
    goScripted();
    const held = [{ key: "price", op: "lte", value: 70000 }];
    const body: Body = await (await POST(ask("red-light", "do you have vitamins?", held))).json();
    expect(body.activeConstraints.map((c) => c.key)).toEqual(["price"]);
  });

  // Matt's spelling.
  it("answers the same question spelled wrong", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "vitimens"))).json();
    expect(body.text).toContain("no vitamins catalogue");
  });

  it("does not fire on the drinks page, which lists the word itself", async () => {
    goScripted();
    const body: Body = await (await POST(ask("wellness-drinks", "something with vitamins"))).json();
    expect(body.text).not.toContain("catalogue");
    expect(body.links).toBeUndefined();
  });
});

describe("messages that must not move anybody", () => {
  it("ignores a category the shopper ruled out", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "I don't want a cold plunge, show me panels"))).json();
    expect(body.text).not.toContain("separate section");
    // "panels" is not in this category's vocabulary, so nothing was read and the
    // reply is the invitation, which offers this site's sections. Cold plunges
    // is not among them: the sentence has already said so.
    expect(body.links?.map((l) => l.href)).toEqual(["/red-light", "/wellness-drinks"]);
  });

  it("asks which one when the message names two", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "red light or cold plunge?"))).json();
    expect(body.text).toContain("Tell me which one you mean");
    expect(body.links?.map((l) => l.href)).toEqual(["/red-light", "/cold-plunge"]);
    expect(body.proposals).toEqual([]);
  });

  it("leaves an ordinary in-category request alone", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "a full body panel under $700"))).json();
    expect(body.links).toBeUndefined();
    expect(body.text).toContain("$700");
  });
});

describe("a dead end always offers a way out", () => {
  const SECTIONS = ["/red-light", "/cold-plunge", "/wellness-drinks"];

  it("puts the section links under the fixed limitation", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "which is best for my skin tone?"))).json();
    expect(body.links?.map((l) => l.href)).toEqual(SECTIONS);
  });

  // A statement never reaches the fixed limitation: `looksLikeQuestion` sends
  // only questions there. "I want kettlebells" fell to the invitation, which
  // offered "What matters most to you here?" beside this category's own cards
  // and no way anywhere else.
  it("puts them under the invitation too, for a statement nothing was read from", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "I want kettlebells"))).json();
    expect(body.text).toContain("What matters most to you here?");
    expect(body.links?.map((l) => l.href)).toEqual(SECTIONS);
  });

  // The links say what this site holds. They do not say the request was
  // understood, and they do not say kettlebells are absent: nothing here knows
  // that, and only the four written entries in ABSENT_SUBJECTS may say it.
  it("claims nothing about what it could not read", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "I want kettlebells"))).json();
    expect(body.text).not.toMatch(/kettlebell/i);
    expect(body.text).not.toMatch(/catalogue/i);
    expect(body.text).not.toMatch(/separate section/i);
  });

  it("still counts and still shows the page's own products", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "I want kettlebells"))).json();
    // Nothing was applied, so the page is unchanged and the count describes it.
    expect(body.matchSummary).toContain("All 8 products");
    expect(body.products.length).toBeGreaterThan(0);
    expect(body.proposals).toEqual([]);
  });

  it("says nothing extra once a real preference is read", async () => {
    goScripted();
    const body: Body = await (await POST(ask("red-light", "a full body panel under $700"))).json();
    expect(body.links).toBeUndefined();
  });
});
