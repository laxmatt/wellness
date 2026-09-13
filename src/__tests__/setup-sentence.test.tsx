// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { AssistantProvider, useAssistant } from "@/components/assistant/AssistantProvider";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { coldPlunge } from "@/domain/categories";
import { describeConstraint } from "@/domain/personalization/describe";
import { composeReply } from "@/domain/reply-composer";
import type { HardConstraint } from "@/domain/personalization";

// The sentence the run of 2026-09-09T01:35 put on the screen:
//
//   "I have read that as none. fill with a hose. power and plumbing. 3 of the 6
//    products in this category match."
//
// The case scored ok, because it checks which key was extracted. Nothing
// checked whether the shopper could read the answer.
//
// Cold plunge's plumbing option is labelled "None. Fill with a hose." for a
// filter chip, where it stands alone. Lowercased and glued to its attribute
// label it stopped being a sentence.

const NONE: HardConstraint = { key: "plumbing", op: "eq", value: "none" };

describe("the setup constraint, as a phrase", () => {
  it("no longer folds a sentence into a phrase", () => {
    const text = describeConstraint(coldPlunge, NONE);
    expect(text).not.toBe("none. fill with a hose. power and plumbing");
    expect(text.toLowerCase()).not.toContain("hose. power and plumbing");
  });

  it("keeps the label as its author wrote it", () => {
    expect(describeConstraint(coldPlunge, NONE)).toBe('Power and plumbing set to "None. Fill with a hose"');
  });

  it("leaves the short option labels folding as before", () => {
    // These read correctly already and must not change.
    expect(describeConstraint(coldPlunge, { key: "plumbing", op: "eq", value: "plug_in_120v" })).toBe("standard 120v outlet power and plumbing");
    expect(describeConstraint(coldPlunge, { key: "tub_type", op: "eq", value: "hard_shell" })).toMatch(/tub type$/);
  });
});

describe("the setup constraint, in the composed reply", () => {
  const reply = composeReply({
    cat: coldPlunge,
    hard: [NONE],
    soft: [],
    unmapped: [],
    matchCount: 3,
    totalProducts: 6,
    changed: true,
    clearing: false,
    lastUserText: "I don't want to deal with an electrician",
  });

  it("is the sentence a person can read", () => {
    expect(reply).toBe('I have read that as Power and plumbing set to "None. Fill with a hose". 3 of the 6 products in this category match.');
  });

  it("is not the sentence that shipped", () => {
    expect(reply).not.toContain("none. fill with a hose. power and plumbing");
  });

  it("still carries the engine's count", () => {
    expect(reply).toContain("3 of the 6 products in this category match.");
  });
});

// The API field is not what a shopper reads. A count was returned correctly by
// the route for a full commit while the panel never drew it, so this renders.
function OpenIt() {
  const a = useAssistant();
  useEffect(() => {
    a?.setOpen(true);
  }, [a]);
  return null;
}

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the setup constraint, on the screen", () => {
  it("is drawn as written, not as fragments", async () => {
    const text = composeReply({
      cat: coldPlunge,
      hard: [NONE],
      soft: [],
      unmapped: [],
      matchCount: 3,
      totalProducts: 6,
      changed: true,
      clearing: false,
      lastUserText: "I don't want to deal with an electrician",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            text,
            mode: "live",
            products: [],
            matchingIds: [],
            unconfirmedPrice: [],
            proposals: [],
            activeConstraints: [],
            medicalRedirect: false,
            matchSummary: "3 of the 6 products in this category match.",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    render(
      <CompareProvider>
        <AssistantProvider categoryId="cold-plunge">
          <OpenIt />
          <AssistantPanel />
        </AssistantProvider>
      </CompareProvider>,
    );

    const input = await screen.findByPlaceholderText(/what matters to you/i);
    fireEvent.change(input, { target: { value: "I don't want to deal with an electrician" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(screen.getByText(/Power and plumbing set to/)).toBeTruthy();
    });
    expect(screen.queryByText(/none\. fill with a hose\. power and plumbing/i)).toBeNull();
  });
});
