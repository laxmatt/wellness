// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantLauncher } from "@/components/assistant/AssistantLauncher";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { AssistantProvider } from "@/components/assistant/AssistantProvider";
import { CompareProvider } from "@/components/compare/CompareProvider";
import { categories, categoryById } from "@/domain/categories";
import { attributeDef } from "@/domain/category";
import { introExamplesFor, introFor, type AssistantEntry } from "@/domain/assistant-intro";
import { categoryTerms } from "@/domain/subject-scope";

/**
 * Which shop the assistant thinks it is in.
 *
 * The panel carried one hardcoded list of examples for every page: "A full-body
 * panel under $700", "Something I can set up without an electrician", "Zero
 * sugar, no caffeine". A shopper on the wellness drinks page pressed "Not sure
 * which wellness drinks suits you?" and was offered two of those about red
 * light panels. Nothing underneath was wrong, which is what made it worth
 * fixing: the first thing the invitation showed was evidence it had not noticed
 * where it was.
 */

afterEach(cleanup);
// The panel holds a compare control, and the log scrolls itself on open.
beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
});

const SLUGS = ["wellness-drinks", "cold-plunge", "red-light"] as const;

describe("the examples belong to the category that offers them", () => {
  it("rests every example on a filter or attribute that category actually has", () => {
    for (const slug of SLUGS) {
      const cat = categoryById(slug)!;
      const filterKeys = new Set(cat.filters.map((f) => f.key));
      for (const example of introExamplesFor(cat.id)!) {
        for (const key of example.keys) {
          const known = key === "price" || filterKeys.has(key) || attributeDef(cat, key) !== undefined;
          expect(known, `${slug}: "${example.text}" rests on ${key}`).toBe(true);
        }
      }
    }
  });

  it("offers no example that names a different section of this site", () => {
    for (const slug of SLUGS) {
      const cat = categoryById(slug)!;
      const others = categories.filter((c) => c.id !== cat.id).flatMap((c) => categoryTerms(c));
      for (const example of introExamplesFor(cat.id)!) {
        const text = example.text.toLowerCase();
        for (const term of others) {
          expect(text.includes(term.toLowerCase()), `${slug}: "${example.text}" names "${term}"`).toBe(false);
        }
      }
    }
  });

  it("gives each category its own examples, shared with no other", () => {
    const seen = new Map<string, string>();
    for (const slug of SLUGS) {
      for (const example of introExamplesFor(categoryById(slug)!.id)!) {
        expect(seen.has(example.text), `"${example.text}" is offered by ${seen.get(example.text)} as well`).toBe(false);
        seen.set(example.text, slug);
      }
    }
  });

  it("names the category in the lead, and falls back to broad copy for an id this site does not have", () => {
    for (const slug of SLUGS) {
      const cat = categoryById(slug)!;
      expect(introFor({ kind: "category", categoryId: cat.id }, categories).lead).toContain(cat.navLabel.toLowerCase());
    }
    // A bad id gets the broad copy, never another category's.
    const unknown = introFor({ kind: "category", categoryId: "kettlebells" }, categories);
    expect(unknown.lead).toContain("This site compares");
    expect(unknown.examples).toEqual(introFor({ kind: "general" }, categories).examples);
  });

  it("keeps the general entry broad, naming every section from the catalogue", () => {
    const general = introFor({ kind: "general" }, categories);
    for (const cat of categories) expect(general.lead).toContain(cat.navLabel.toLowerCase());
    // Each broad example names exactly one section, which is what makes it
    // answerable with no category in front of the shopper.
    for (const example of general.examples) {
      const named = categories.filter((c) => categoryTerms(c).some((t) => example.text.toLowerCase().includes(t.toLowerCase())));
      expect(named.length, `"${example.text}" names ${named.length} sections`).toBe(1);
    }
  });
});

function mount(categoryId: string, entry: AssistantEntry) {
  return render(
    <CompareProvider>
      <AssistantProvider categoryId={categoryId}>
        <AssistantLauncher entry={entry} />
        <AssistantPanel />
      </AssistantProvider>
    </CompareProvider>,
  );
}

const launcher = () => screen.getByRole("button", { name: /Help me choose|Close assistant/ });
const intro = () => screen.queryByTestId("assistant-intro");
const shownExamples = () => [...(intro()?.querySelectorAll("li button") ?? [])].map((b) => b.textContent);

describe("pressing the launcher on each category", () => {
  for (const slug of SLUGS) {
    it(`${slug}: opens on that category's examples and nobody else's`, () => {
      const cat = categoryById(slug)!;
      mount(cat.id, { kind: "category", categoryId: cat.id });
      fireEvent.click(launcher());

      expect(shownExamples()).toEqual(introExamplesFor(cat.id)!.map((e) => e.text));
      expect(intro()!.getAttribute("data-entry")).toBe(cat.id);
      expect(within(intro()!).getByText(new RegExp(cat.navLabel, "i"))).toBeTruthy();

      // And none of the examples the other two pages offer.
      for (const other of SLUGS.filter((s) => s !== slug)) {
        for (const example of introExamplesFor(categoryById(other)!.id)!) {
          expect(shownExamples(), `${slug} offered ${other}'s example`).not.toContain(example.text);
        }
      }
    });
  }

  it("opens broad when the control that opened it is a general one", () => {
    mount("red-light", { kind: "general" });
    fireEvent.click(launcher());
    expect(intro()!.getAttribute("data-entry")).toBe("general");
    expect(shownExamples()).toEqual(introFor({ kind: "general" }, categories).examples.map((e) => e.text));
  });

  it("shows the panel's medical line whichever door was used", () => {
    for (const entry of [{ kind: "category", categoryId: "cold-plunge" }, { kind: "general" }] as AssistantEntry[]) {
      cleanup();
      mount("cold-plunge", entry);
      fireEvent.click(launcher());
      expect(within(intro()!).getByText(/does not give medical advice/)).toBeTruthy();
    }
  });
});

describe("reopening, and switching where it was opened from", () => {
  it("takes the entry of whichever control opened it, with no stale examples left over", () => {
    // Two launchers on one page, as a product page and its category invitation
    // would be, sharing one panel.
    render(
      <CompareProvider>
        <AssistantProvider categoryId="red-light">
          <AssistantLauncher entry={{ kind: "category", categoryId: "red-light" }} />
          <AssistantLauncher entry={{ kind: "general" }} />
          <AssistantPanel />
        </AssistantProvider>
      </CompareProvider>,
    );
    const buttons = () => screen.getAllByRole("button", { name: /Help me choose|Close assistant/ });

    fireEvent.click(buttons()[0]);
    expect(intro()!.getAttribute("data-entry")).toBe("red-light");

    // Close, then open from the other one. The old examples must not linger.
    fireEvent.click(buttons()[0]);
    fireEvent.click(buttons()[1]);
    expect(intro()!.getAttribute("data-entry")).toBe("general");
    for (const example of introExamplesFor("red-light")!) expect(shownExamples()).not.toContain(example.text);
  });

  it("does not reset what the shopper has already said", () => {
    mount("wellness-drinks", { kind: "category", categoryId: "wellness-drinks" });
    fireEvent.click(launcher());

    // A typed message, without sending it anywhere: the input keeps it and the
    // panel is closed and reopened from the same control.
    const input = screen.getByLabelText(/Tell the assistant what matters to you/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "under $2 a serving" } });
    expect(input.value).toBe("under $2 a serving");

    fireEvent.click(launcher());
    fireEvent.click(launcher());
    expect((screen.getByLabelText(/Tell the assistant what matters to you/i) as HTMLInputElement).value).toBe("under $2 a serving");
    expect(intro()!.getAttribute("data-entry")).toBe("wellness-drinks");
  });
});
