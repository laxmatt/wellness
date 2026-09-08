import type { ConversationProvider, ConverseInput, ConverseResult } from "./OpenAIProvider";
import { MockAIProvider } from "./AIProvider";

// Stand-in used when no API key is configured. It is deterministic slot
// filling over the same extractor the filters use: it can read a budget and a
// few phrases, and nothing more. Every reply it produces is labelled in the UI
// as a scripted prototype so it is never mistaken for a working assistant.
export class ScriptedConversationProvider implements ConversationProvider {
  estimatePromptTokens(): number {
    return 0;
  }

  readonly name = "scripted";
  readonly isLive = false;
  private readonly extractor = new MockAIProvider();

  constructor(private readonly categoryForExtraction: Parameters<MockAIProvider["extractPreferences"]>[0]["category"]) {}

  async converse(input: ConverseInput): Promise<ConverseResult> {
    const last = [...input.messages].reverse().find((m) => m.role === "user")?.text ?? "";
    const prefs = await this.extractor.extractPreferences({ text: last, category: this.categoryForExtraction });

    const asked = new Set(input.activeConstraints.map((c) => c.split(" ")[0]));
    const known = new Set([...prefs.hard.map((h) => h.key), ...prefs.soft.map((s) => s.key), ...asked]);

    let reply: string;
    let question: ConverseResult["intent"]["question"];

    if (prefs.medicalIntent) {
      reply = "I can compare these products on their stated specifications, price and setup, but I cannot say which will treat a medical condition.";
    } else if (prefs.hard.length === 0 && prefs.soft.length === 0) {
      reply = "Tell me your budget and what you want it for, and I will narrow the list.";
      question = { text: "What is your budget?", options: ["Under $300", "Under $700", "Under $1,500", "No limit"] };
    } else if (!known.has("price")) {
      reply = "Noted. A budget would narrow this further.";
      question = { text: "What is your budget?", options: ["Under $300", "Under $700", "Under $1,500", "No limit"] };
    } else {
      // Deliberately names no product. The list beneath this reply comes from
      // the ranking engine; a stand-in naming its own picks could contradict it.
      reply =
        "Noted. The matching products are listed below, from the site's own ranking. Figures come from the makers unless marked otherwise, and anything we do not hold is shown as not stated.";
    }

    return {
      intent: {
        reply,
        hard: prefs.hard,
        soft: prefs.soft,
        unmapped: prefs.unmapped,
        question,
        medicalIntent: prefs.medicalIntent,
        suggestCompare: [],
      },
      // Costs nothing and is never metered, so zero here is a fact.
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "scripted",
    };
  }
}
