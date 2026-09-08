import type { CategoryDefinition } from "@/domain/category";
import { PreferenceSet } from "@/domain/personalization";

// The AI never sees the full catalog and never ranks. Two narrow jobs:
// 1. Turn free text into a PreferenceSet constrained to the category's keys.
// 2. Answer factual questions over a small server-selected fact sheet for
//    products the user is already comparing.

export type ExtractInput = {
  text: string;
  category: Pick<CategoryDefinition, "id" | "attributeDefinitions" | "filters" | "matcherVocabulary">;
};

export type ProductFactSheet = {
  productId: string;
  name: string;
  brand: string;
  facts: { label: string; value: string; verification: string }[];
};

export type FactualQuestionInput = {
  question: string;
  facts: ProductFactSheet[];
};

export type FactualAnswer = {
  answer: string;
  citedProductIds: string[];
  declined: boolean;
  declineReason?: "medical" | "outside_facts" | "other";
};

export interface AIProvider {
  readonly name: string;
  extractPreferences(input: ExtractInput): Promise<PreferenceSet>;
  answerFactualQuestion(input: FactualQuestionInput): Promise<FactualAnswer>;
}

export const MEDICAL_TERMS = [
  "treat", "treats", "treatment", "cure", "cures", "heal", "heals", "diagnose", "diagnosis",
  "arthritis", "cancer", "depression", "anxiety", "diabetes", "thyroid", "eczema", "psoriasis",
  "inflammation", "pain relief", "chronic pain", "injury", "disease", "disorder", "condition",
  "prescription", "doctor said", "symptoms", "fibromyalgia", "neuropathy", "migraine",
];

export function detectMedicalIntent(text: string): boolean {
  const t = text.toLowerCase();
  return MEDICAL_TERMS.some((term) => t.includes(term));
}

// Prototype extractor: budget parsing, vocabulary lookup, zero/none patterns.
// Enough to build and test the matcher UI without a network call.
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  async extractPreferences(input: ExtractInput): Promise<PreferenceSet> {
    const text = input.text.toLowerCase();
    const hard: PreferenceSet["hard"] = [];
    const soft: PreferenceSet["soft"] = [];
    const unmapped: string[] = [];

    const budget = text.match(/(?:under|below|less than|max|at most|budget of|no more than|<)\s*\$?\s*([\d,]+(?:\.\d+)?)\s*(k)?/);
    if (budget) {
      let n = Number(budget[1].replace(/,/g, ""));
      if (budget[2]) n *= 1000;
      const perServing = /per serving|a serving|each serving/.test(text);
      const key = perServing && input.category.attributeDefinitions.some((a) => a.key === "price_per_serving_minor")
        ? "price_per_serving_minor"
        : "price";
      hard.push({ key, op: "lte", value: Math.round(n * 100) });
    }

    for (const [key, byValue] of Object.entries(input.category.matcherVocabulary)) {
      for (const [value, phrases] of Object.entries(byValue)) {
        if (phrases.some((p) => text.includes(p))) {
          const def = input.category.attributeDefinitions.find((a) => a.key === key);
          const typed = def?.type === "boolean" ? value === "true" : value;
          if (def?.type === "list") soft.push({ key, direction: "prefer_high", value: [value as string], weight: 0.8 });
          else soft.push({ key, direction: "prefer_high", value: typed, weight: 0.8 });
        }
      }
    }

    if (/(no|zero|without|free of)\s+(added\s+)?sugar|sugar[- ]free/.test(text) && has(input, "sugar_g")) {
      hard.push({ key: "sugar_g", op: "eq", value: 0 });
    }
    if (/(no|zero|without|free of)\s+caffeine|caffeine[- ]free|decaf/.test(text) && has(input, "caffeine_mg")) {
      hard.push({ key: "caffeine_mg", op: "eq", value: 0 });
    }
    if (/\b(quiet|silent|noise|loud)\b/.test(text)) unmapped.push("noise level");
    if (/\b(taste|tastes|flavor|flavour)\b/.test(text) && !has(input, "flavor")) unmapped.push("taste");

    return PreferenceSet.parse({ hard, soft, unmapped, medicalIntent: detectMedicalIntent(input.text) });
  }

  async answerFactualQuestion(input: FactualQuestionInput): Promise<FactualAnswer> {
    if (detectMedicalIntent(input.question)) {
      return {
        answer:
          "I can compare these products by their listed specifications, price and setup, but I can't determine which will treat a medical condition.",
        citedProductIds: [],
        declined: true,
        declineReason: "medical",
      };
    }
    const lines = input.facts.map((f) => `${f.brand} ${f.name}: ${f.facts.map((x) => `${x.label} ${x.value}`).join(", ")}`);
    return { answer: lines.join("\n"), citedProductIds: input.facts.map((f) => f.productId), declined: false };
  }
}

function has(input: ExtractInput, key: string): boolean {
  return input.category.attributeDefinitions.some((a) => a.key === key);
}
