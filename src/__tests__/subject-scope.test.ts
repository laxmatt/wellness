import { describe, expect, it } from "vitest";
import { categories, coldPlunge, redLight, wellnessDrinks } from "@/domain/categories";
import { ABSENT_SUBJECTS, resolveSubjectScope } from "@/domain/subject-scope";

const on = (cat: typeof redLight, text: string) => resolveSubjectScope(text, cat, categories);

describe("a message about another category", () => {
  // Matt's example, verbatim in shape: a shopper on the red-light page asking
  // about cold plunges.
  it("names the other category and nothing else", () => {
    expect(on(redLight, "what about cold plunges?")).toEqual({ kind: "other_category", categoryIds: ["cold-plunge"] });
    expect(on(redLight, "do you have ice baths")).toEqual({ kind: "other_category", categoryIds: ["cold-plunge"] });
    expect(on(coldPlunge, "show me red light panels")).toEqual({ kind: "other_category", categoryIds: ["red-light"] });
    expect(on(redLight, "electrolyte drinks under $2 a serving")).toEqual({ kind: "other_category", categoryIds: ["wellness-drinks"] });
  });

  it("stays put when the message is about the category in front of the shopper", () => {
    expect(on(redLight, "a full body red light panel under $700")).toEqual({ kind: "in_scope" });
    expect(on(coldPlunge, "a cold plunge with a chiller")).toEqual({ kind: "in_scope" });
    expect(on(wellnessDrinks, "zero sugar electrolytes")).toEqual({ kind: "in_scope" });
  });

  it("asks when the message names this category and another", () => {
    const both = on(redLight, "how does a red light panel compare to a cold plunge?");
    expect(both.kind).toBe("ambiguous");
    expect(both.kind === "ambiguous" && both.categoryIds).toEqual(["red-light", "cold-plunge"]);
  });

  it("asks when the message names two other categories", () => {
    const two = on(redLight, "cold plunge or wellness drinks?");
    expect(two.kind).toBe("ambiguous");
    expect(two.kind === "ambiguous" && two.categoryIds).toEqual(["cold-plunge", "wellness-drinks"]);
  });
});

describe("negation", () => {
  it("does not offer to move a shopper who ruled the other category out", () => {
    expect(on(redLight, "not a cold plunge, a panel")).toEqual({ kind: "in_scope" });
    expect(on(redLight, "I don't want a cold plunge")).toEqual({ kind: "in_scope" });
    expect(on(redLight, "anything but an ice bath")).toEqual({ kind: "in_scope" });
    expect(on(redLight, "a panel instead of a cold plunge")).toEqual({ kind: "in_scope" });
    expect(on(redLight, "I already have a cold plunge")).toEqual({ kind: "in_scope" });
    expect(on(redLight, "no vitamins please")).toEqual({ kind: "in_scope" });
  });

  it("moves a shopper who ruled THIS category out in favour of another", () => {
    expect(on(redLight, "not a red light panel, I want a cold plunge")).toEqual({ kind: "other_category", categoryIds: ["cold-plunge"] });
  });

  it("reaches back over words between the negator and the subject", () => {
    expect(on(redLight, "I do not want a big expensive cold plunge")).toEqual({ kind: "in_scope" });
  });
});

describe("subjects this site has no catalogue for", () => {
  it("names the listed subject", () => {
    expect(on(redLight, "do you have vitamins?")).toEqual({ kind: "absent_subject", labels: ["vitamins"] });
    expect(on(coldPlunge, "looking for a sauna")).toEqual({ kind: "absent_subject", labels: ["saunas"] });
    expect(on(redLight, "massage guns")).toEqual({ kind: "absent_subject", labels: ["massage guns"] });
  });

  // "vitimens" is two edits from "vitamins". A shopper who cannot spell it is
  // asking the same question.
  it("survives an ordinary misspelling", () => {
    expect(on(redLight, "do you sell vitimens")).toEqual({ kind: "absent_subject", labels: ["vitamins"] });
    expect(on(redLight, "any sauna's?")).toEqual({ kind: "absent_subject", labels: ["saunas"] });
  });

  // The drinks catalogue lists "vitamins" for its greens filter. A drinks
  // shopper keeps the behaviour that page already had.
  it("defers to a category that lists the word itself", () => {
    expect(on(wellnessDrinks, "something with vitamins")).toEqual({ kind: "in_scope" });
  });

  it("is a written list and nothing more", () => {
    // Guard against this test drifting into a claim of general recognition.
    expect(ABSENT_SUBJECTS.length).toBeLessThanOrEqual(6);
    expect(on(redLight, "do you have kettlebells?")).toEqual({ kind: "in_scope" });
    expect(on(redLight, "what about compression boots?")).toEqual({ kind: "in_scope" });
  });
});

describe("ordinary shopping language is left alone", () => {
  it.each([
    [redLight, "what is the biggest one you have?"],
    [redLight, "something for a small apartment"],
    [redLight, "under $700"],
    [coldPlunge, "can I put it in the garage?"],
    [coldPlunge, "which one is quietest"],
    [wellnessDrinks, "no caffeine and zero sugar"],
    [wellnessDrinks, "cans rather than powder"],
    [redLight, ""],
    [redLight, "hi"],
  ])("leaves %#", (cat, text) => {
    expect(on(cat as typeof redLight, text)).toEqual({ kind: "in_scope" });
  });

  it("does not read a short word as a near miss", () => {
    // "cans" must not reach "cold", "sauna" or any other five-letter term.
    expect(on(wellnessDrinks, "cans")).toEqual({ kind: "in_scope" });
    expect(on(redLight, "plug")).toEqual({ kind: "in_scope" });
  });
});
