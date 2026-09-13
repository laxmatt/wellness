import { describe, expect, it } from "vitest";
import { detectMedicalIntent } from "@/providers/ai/AIProvider";

// The detector runs in the route before any model call, so it decides on its
// own whether a shopper is refused. It used to match substrings, which refused
// "which one is healthiest?" because "heal" is inside "healthiest". These tests
// pin both directions: ordinary shopping language passes, and a request to
// treat, diagnose or cure something is still declined.

describe("medical intent, ordinary shopping language", () => {
  // The exact sentence the live test sends. It must reach the model.
  it("does not refuse a question about which product is healthiest", () => {
    expect(detectMedicalIntent("Which one is healthiest?")).toBe(false);
  });

  it.each([
    "Which is the healthier option?",
    "I want a healthy drink for the afternoon",
    "What are the health benefits of red light?",
    "Is this good for general health and wellness?",
    "Does the tub have a secure lid?",
    "Any curated bundles?",
    "We use it after a weekend retreat",
    "Does the garage need air conditioning for this?",
    "How does it perform in cold conditions?",
    "Is this a reconditioned unit?",
    "Does it come with a hair conditioner sample?",
    "What are the shipping conditions?",
  ])("does not refuse: %s", (text) => {
    expect(detectMedicalIntent(text)).toBe(false);
  });
});

describe("medical intent, requests the assistant must decline", () => {
  it.each([
    "Will this treat my arthritis?",
    "Which panel treats back pain best?",
    "Is red light an effective treatment for eczema?",
    "Can it cure my psoriasis?",
    "Will red light therapy heal my tendonitis?",
    "How long until my injury heals?",
    "Is this used for healing after surgery?",
    "I was diagnosed with a thyroid problem, will this help?",
    "Can this diagnose anything?",
    "My doctor said to try cold exposure",
    "Do I need a prescription for this?",
    "Which one helps with chronic pain?",
    "Anything for pain relief?",
    "Will this help my medical condition?",
    "Is it safe with my skin condition?",
    "Will this help my condition?",
    "Does it reduce inflammation?",
    "Does it help with depression or anxiety?",
    "What are the symptoms it addresses?",
    "Anything for neuropathy?",
    "Will this help my plantar fasciitis?",
    "Does it do anything for bursitis?",
  ])("declines: %s", (text) => {
    expect(detectMedicalIntent(text)).toBe(true);
  });

  it("is case insensitive", () => {
    expect(detectMedicalIntent("WILL THIS HEAL MY BACK")).toBe(true);
    expect(detectMedicalIntent("WHICH ONE IS HEALTHIEST")).toBe(false);
  });

  it("matches a term next to punctuation, not only surrounded by spaces", () => {
    expect(detectMedicalIntent("treat?")).toBe(true);
    expect(detectMedicalIntent("anti-inflammation panels")).toBe(true);
    expect(detectMedicalIntent("(arthritis)")).toBe(true);
  });
});
