// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/assistant/route";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { MemoryUsageStore } from "@/providers/usage/MemoryUsageStore";
import { UsageMeter, type MeterConfig } from "@/providers/usage/UsageMeter";
import { resetMeterForTests } from "@/providers/usage";

// The whole clarification flow, end to end, with only the model replaced.
//
// The panel is the real one, the provider is the real one, and "/api/assistant"
// is served by the real route handler. The option chips are clicked rather than
// simulated, because clicking one calls `send(label)` and posts whatever
// constraints the provider is holding at that moment, which is the part of this
// flow that decides whether the shopper's earlier requirements survive.
//
// An earlier version of this file proved less than its names suggested. Its
// happy path used a model that repeated every constraint, so it showed the flow
// working when the model cooperates, not that the application preserves
// anything. Its other two tests recorded failures rather than fixing them: a
// request sent with no constraints, and a second reply that dropped what it did
// not mention. Both are now the application's job and both are asserted here
// against a model that answers only the question it was asked.
//
// What this still does NOT establish: that a live model asks for what it needs,
// or extracts everything in the sentence. Both are stubbed. The missing-value
// check is a limited safeguard against one failure, a supported value the
// shopper named going nowhere. It only fires for values this category publishes
// and only matches whole words, so a requirement phrased any other way still
// passes unnoticed, and "zero sugar" is one: it went missing in the live run of
// 02:12 and nothing here would have caught it.

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

const SENTENCE = "Zero sugar electrolytes under $2 a serving";
const usd = (amount: number) => ({ amount, currency: "USD" as const });

// Turn one, exactly as the live model answered at 2026-09-09T01:50.
const TURN_ONE = {
  reply: "Noted.",
  hard: [
    { key: "sugar_g", op: "eq", value: 0 },
    { key: "price_per_serving_minor", op: "lt", value: usd(2) },
  ],
  soft: [],
  unmapped: [],
  medicalIntent: false,
  suggestCompare: [],
};

// Turn two, following the instruction to repeat every constraint that applies.
const TURN_TWO_REPEATING = {
  ...TURN_ONE,
  reply: "Electrolytes it is.",
  hard: [...TURN_ONE.hard, { key: "function", op: "includes", value: "electrolytes" }],
};

// Turn two from a model that answers only the question it was asked.
const TURN_TWO_FORGETFUL = {
  ...TURN_ONE,
  reply: "Electrolytes it is.",
  hard: [{ key: "function", op: "includes", value: "electrolytes" }],
};

type Body = { messages: { role: string; text: string }[]; hard: unknown[]; soft: unknown[]; answering?: { key: string; via: string } };
let posted: Body[] = [];

// Routes the panel's own request into the real handler, and answers the
// route's outbound model call from a script.
function wireRoute(modelTurns: unknown[]) {
  let turn = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string; method?: string; headers?: Record<string, string> }) => {
      if (typeof url === "string" && url.startsWith("/api/assistant")) {
        posted.push(JSON.parse(init.body) as Body);
        return POST(
          new Request("http://localhost/api/assistant", {
            method: "POST",
            headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.66" },
            body: init.body,
          }),
        );
      }
      const intent = modelTurns[Math.min(turn++, modelTurns.length - 1)];
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(intent) } }],
          usage: { prompt_tokens: 900, completion_tokens: 60 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }),
  );
}

function OpenIt() {
  const a = useAssistant();
  useEffect(() => {
    a?.setOpen(true);
  }, [a]);
  return null;
}

function renderPanel() {
  render(
    <CompareProvider>
      <AssistantProvider categoryId="wellness-drinks">
        <OpenIt />
        <AssistantPanel />
      </AssistantProvider>
    </CompareProvider>,
  );
}

async function ask(text: string) {
  const input = await screen.findByPlaceholderText(/what matters to you/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.submit(input.closest("form")!);
}

beforeEach(() => {
  posted = [];
  vi.stubGlobal("scrollTo", vi.fn());
  Element.prototype.scrollTo = vi.fn();
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
  cleanup();
  vi.unstubAllGlobals();
  resetMeterForTests(null);
  process.env = { ...ENV };
});

describe("the shopper asks, the site asks back, the shopper answers", () => {
  it("carries all three requirements to the end and excludes the energy drink", async () => {
    wireRoute([TURN_ONE, TURN_TWO_REPEATING]);
    renderPanel();

    // 1. The request.
    await ask(SENTENCE);

    // 2. The site asks for what it did not get, and says so.
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    expect(screen.getByText(/I have not filtered by function\./)).toBeTruthy();
    // The two it did get are in the proposal it is offering.
    await waitFor(() => expect(screen.getByText(/Narrow to zero total sugar, price per serving under \$2/)).toBeTruthy());

    // The shopper applies what has been understood so far.
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // 3. The shopper answers by pressing the option the site offered.
    fireEvent.click(screen.getByRole("button", { name: "Electrolytes" }));

    // The answer went out as a message, with the earlier constraints held.
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].messages.at(-1)).toEqual({ role: "user", text: "Electrolytes" });
    expect(posted[1].hard).toEqual([
      { key: "sugar_g", op: "eq", value: 0 },
      { key: "price_per_serving_minor", op: "lt", value: 200 },
    ]);

    // 4. All three requirements, and the energy-only drink is gone.
    await waitFor(() => expect(screen.getByText(/Narrow to zero total sugar, price per serving under \$2, function includes Electrolytes/)).toBeTruthy());

    const res = await POST(
      new Request("http://localhost/api/assistant", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.66" },
        body: JSON.stringify({ sessionId: "s_flow_check", categoryId: "wellness-drinks", messages: [{ role: "user", text: "Electrolytes" }], hard: [], soft: [] }),
      }),
    );
    const body = await res.json();
    const applied = body.proposals.find((p: { kind: string }) => p.kind === "apply_preferences");
    expect(applied.hard).toEqual([
      { key: "sugar_g", op: "eq", value: 0 },
      { key: "price_per_serving_minor", op: "lt", value: 200 },
      { key: "function", op: "includes", value: "electrolytes" },
    ]);
    // Celsius is zero sugar and $1.34 a serving. It is an energy drink, and it
    // was in the results until the third requirement arrived.
    expect(applied.matchingIds).toContain("lmnt-citrus-salt-30");
    expect(applied.matchingIds).not.toContain("celsius-sparkling-orange-12");
  });

  it("stops asking once the answer is in", async () => {
    wireRoute([TURN_ONE, TURN_TWO_REPEATING]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Electrolytes" }));
    await waitFor(() => expect(posted).toHaveLength(2));
    // The first reply stays in the transcript. It is the newest one that must
    // not still be asking.
    await waitFor(() => {
      const said = screen.getAllByText(/products in this category match/);
      expect(said.at(-1)!.textContent).not.toContain("I have not filtered by");
    });
    // The transcript keeps the first turn's question card, as it keeps every
    // reply. What matters is that the second reply does not ask again.
    expect(screen.getAllByText("Which function suits you?")).toHaveLength(1);
  });
});

describe("what answering the question does not do", () => {
  it("does not replace the earlier requirements when the model repeats them", async () => {
    wireRoute([TURN_ONE, TURN_TWO_REPEATING]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Electrolytes" }));
    await waitFor(() => expect(posted).toHaveLength(2));

    // Both survive into the second turn's proposal, alongside the new one.
    await waitFor(() => {
      const summary = screen.getAllByText(/Narrow to zero total sugar/).at(-1)!;
      expect(summary.textContent).toContain("price per serving under $2");
      expect(summary.textContent).toContain("function includes Electrolytes");
    });
  });

  it("carries the pending requirements when the shopper answers without applying", async () => {
    // The option chip sits above the Apply button, so this order is available
    // to a shopper, and it used to send a request with no constraints at all.
    // The reply that asked the question is what the question is about, so its
    // constraints go out even though nothing has been applied to the page.
    wireRoute([TURN_ONE, TURN_TWO_FORGETFUL]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Electrolytes" }));

    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].hard).toEqual([
      { key: "sugar_g", op: "eq", value: 0 },
      { key: "price_per_serving_minor", op: "lt", value: 200 },
    ]);
    expect(posted[1].answering).toEqual({ key: "function", via: "option" });

    // Nothing was applied to the page, and the answer still lands on all three.
    await waitFor(() => {
      const summary = screen.getAllByText(/Narrow to zero total sugar/).at(-1)!;
      expect(summary.textContent).toContain("price per serving under $2");
      expect(summary.textContent).toContain("function includes Electrolytes");
    });
  });

  it("keeps the earlier requirements when the model answers only the question", async () => {
    // The model returns the clarified function and nothing else. The site is
    // answering its own question, so it merges rather than replaces, and the
    // shopper keeps what they already had without the model repeating it.
    wireRoute([TURN_ONE, TURN_TWO_FORGETFUL]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    fireEvent.click(screen.getByRole("button", { name: "Electrolytes" }));
    await waitFor(() => expect(posted).toHaveLength(2));

    await waitFor(() => {
      const summary = screen.getAllByText(/Narrow to zero total sugar/).at(-1)!;
      expect(summary.textContent).toContain("price per serving under $2");
      expect(summary.textContent).toContain("function includes Electrolytes");
    });
  });

  it("treats a typed answer like the chip, and keeps what the model forgot", async () => {
    // The same flow, typed instead of pressed. The model answers only the
    // question it was asked, and the shopper keeps everything they had.
    wireRoute([TURN_ONE, TURN_TWO_FORGETFUL]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await ask("electrolytes");

    await waitFor(() => expect(posted).toHaveLength(2));
    // Exactly the option, typed rather than pressed. Same act, same handling.
    expect(posted[1].answering).toEqual({ key: "function", via: "option" });
    expect(posted[1].hard).toEqual([
      { key: "sugar_g", op: "eq", value: 0 },
      { key: "price_per_serving_minor", op: "lt", value: 200 },
    ]);

    await waitFor(() => {
      const summary = screen.getAllByText(/Narrow to zero total sugar/).at(-1)!;
      expect(summary.textContent).toContain("price per serving under $2");
      expect(summary.textContent).toContain("function includes Electrolytes");
    });
  });

  it("types the answer before applying anything, and still keeps it", async () => {
    wireRoute([TURN_ONE, TURN_TWO_FORGETFUL]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());

    await ask("electrolytes");

    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].hard).toEqual([
      { key: "sugar_g", op: "eq", value: 0 },
      { key: "price_per_serving_minor", op: "lt", value: 200 },
    ]);
    await waitFor(() => {
      const summary = screen.getAllByText(/Narrow to zero total sugar/).at(-1)!;
      expect(summary.textContent).toContain("function includes Electrolytes");
    });
  });

  it("asks instead of discarding when a typed answer might also be revoking", async () => {
    // "electrolytes, and forget the budget" is an answer and a revocation at
    // once, and from the route it looks exactly like a model that answered only
    // the question. Neither reading is chosen: the constraint is kept and the
    // shopper is asked, with one press to set it aside.
    wireRoute([TURN_ONE, TURN_TWO_FORGETFUL]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    await ask("electrolytes, and forget the budget");

    await waitFor(() => expect(posted).toHaveLength(2));
    await waitFor(() => expect(screen.getByText(/Did you want to drop them\?|Did you want to drop it\?/)).toBeTruthy());
    expect(screen.getByText(/Set aside price per serving under \$2/)).toBeTruthy();
    expect(screen.getByText(/Set aside zero total sugar/)).toBeTruthy();

    // Nothing was discarded on a guess.
    const summary = screen.getAllByText(/Narrow to zero total sugar/).at(-1)!;
    expect(summary.textContent).toContain("price per serving under $2");
  });

  it("says nothing about dropping when the answer was exact", async () => {
    // A clean answer gets a clean reply. The caution is for the ambiguous case,
    // not for every typed word.
    wireRoute([TURN_ONE, TURN_TWO_FORGETFUL]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await ask("electrolytes");
    await waitFor(() => expect(posted).toHaveLength(2));
    await waitFor(() => {
      const summary = screen.getAllByText(/Narrow to zero total sugar/).at(-1)!;
      expect(summary.textContent).toContain("function includes Electrolytes");
    });
    expect(screen.queryByText(/Did you want to drop/)).toBeNull();
    expect(screen.queryByText(/Set aside/)).toBeNull();
  });

  it("still lets an ordinary message drop a constraint", async () => {
    // Merging is only for an answer to the site's own question. A typed
    // message replaces, which is the whole mechanism behind relaxing.
    wireRoute([TURN_ONE, { ...TURN_ONE, reply: "Budget dropped.", hard: [{ key: "sugar_g", op: "eq", value: 0 }] }]);
    renderPanel();
    await ask(SENTENCE);
    await waitFor(() => expect(screen.getByText("Which function suits you?")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    // Names no option of the open question, so it is an instruction, not an
    // answer, and replacement is what drops the budget.
    await ask("forget the budget");
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1].answering).toBeUndefined();

    await waitFor(() => expect(screen.getByText(/Narrow to zero total sugar \(/)).toBeTruthy());
    expect(screen.queryByText(/price per serving under \$2 \(/)).toBeNull();
  });
});
