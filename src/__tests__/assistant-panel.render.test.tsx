// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantReply } from "@/domain/assistant";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { CompareProvider } from "@/components/compare/CompareProvider";

// Rendered against the real component tree, not the API shape. The engine's
// count was returned correctly by the route for a full commit while the panel
// never drew it, so asserting the field exists proves nothing about what a
// shopper sees.

function replyFixture(over: Partial<AssistantReply> = {}): AssistantReply {
  return {
    text: "Here is what I found.",
    mode: "live",
    products: [],
    matchingIds: [],
    unconfirmedPrice: [],
    proposals: [],
    activeConstraints: [],
    medicalRedirect: false,
    matchSummary: "3 of the 8 products in this category match.",
    ...over,
  };
}

function answerWith(reply: AssistantReply) {
  return vi.fn(async () => new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } }));
}

// The panel draws nothing until it is opened, which the launcher normally does.
// This opens it through the same provider API the launcher uses, so the panel
// and provider under test are the real ones.
function OpenIt() {
  const a = useAssistant();
  useEffect(() => {
    a?.setOpen(true);
  }, [a]);
  return null;
}

function renderPanel() {
  return render(
    <CompareProvider>
      <AssistantProvider categoryId="red-light">
        <OpenIt />
        <AssistantPanel />
      </AssistantProvider>
    </CompareProvider>,
  );
}

// Types into the real input and submits the real form.
async function ask(text = "under 500") {
  const input = await screen.findByPlaceholderText(/what matters to you/i);
  fireEvent.change(input, { target: { value: text } });
  const form = input.closest("form");
  if (!form) throw new Error("the assistant input is not in a form");
  fireEvent.submit(form);
}

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the engine's count is on the screen, not only in the payload", () => {
  it("renders the summary when products matched", async () => {
    vi.stubGlobal("fetch", answerWith(replyFixture()));
    renderPanel();
    await ask();

    const summary = await screen.findByTestId("match-summary");
    expect(summary.textContent).toContain("3 of the 8 products in this category match.");
  });

  it("renders it when nothing matched, where there are no cards to read it from", async () => {
    vi.stubGlobal(
      "fetch",
      answerWith(
        replyFixture({
          text: "Let me know if you want to widen that.",
          matchingIds: [],
          products: [],
          matchSummary: "No products match. This category has 8 products, and none of them meet every constraint, so one of them would have to be relaxed.",
        }),
      ),
    );
    renderPanel();
    await ask();

    const summary = await screen.findByTestId("match-summary");
    expect(summary.textContent).toContain("No products match");
    expect(summary.textContent).toContain("8 products");
    // No product cards to infer a count from, which is the point.
    expect(screen.queryByText(/Matching products, from the site/i)).toBeNull();
  });

  it("renders it when the assistant's answer could not be read", async () => {
    vi.stubGlobal(
      "fetch",
      answerWith(
        replyFixture({
          text: "I could not read that reliably. Could you say it another way?",
          failure: "unreadable_reply",
          matchSummary: "2 of the 8 products in this category match.",
          notice: "The assistant's answer could not be read, so nothing has been changed. Your filters are as you left them.",
        }),
      ),
    );
    renderPanel();
    await ask();

    const summary = await screen.findByTestId("match-summary");
    expect(summary.textContent).toContain("2 of the 8 products");
    // The failure notice is on screen too, so the shopper is not left guessing.
    expect(await screen.findByText(/nothing has been changed/i)).toBeTruthy();
  });

  it("attributes the count to the site rather than the assistant", async () => {
    vi.stubGlobal("fetch", answerWith(replyFixture()));
    renderPanel();
    await ask();

    const summary = await screen.findByTestId("match-summary");
    expect(summary.textContent).toMatch(/counted by this site, not by the assistant/i);
  });

  it("shows the site's count even when the assistant's prose contradicts it", async () => {
    vi.stubGlobal(
      "fetch",
      answerWith(
        replyFixture({
          // A contradiction the screen's patterns do not catch. The rendered
          // count is what keeps the shopper right.
          text: "Your budget rules out this entire category, I am afraid.",
          matchSummary: "1 of the 8 products in this category matches.",
        }),
      ),
    );
    renderPanel();
    await ask();

    expect(await screen.findByText(/Your budget rules out this entire category/i)).toBeTruthy();
    const summary = await screen.findByTestId("match-summary");
    expect(summary.textContent).toContain("1 of the 8 products");
  });

  it("draws nothing when there is no summary to draw", async () => {
    const noSummary = replyFixture();
    delete (noSummary as Partial<AssistantReply>).matchSummary;
    vi.stubGlobal("fetch", answerWith(noSummary as AssistantReply));
    renderPanel();
    await ask();

    await waitFor(() => expect(screen.getByText(/Here is what I found/i)).toBeTruthy());
    expect(screen.queryByTestId("match-summary")).toBeNull();
  });
});
