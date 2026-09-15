import type { ModelHardConstraint, ModelSoftPreference } from "@/domain/assistant";
import type { CategoryDefinition } from "@/domain/category";
import { MONEY_CURRENCY, isMoneyKey } from "@/domain/money-contract";
import type { HardConstraint, SoftPreference } from "@/domain/personalization";
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

  constructor(private readonly categoryForExtraction: CategoryDefinition) {}

  /**
   * The extractor's constraints, in the shape the route accepts.
   *
   * The extractor speaks the engine's units: it reads "under $700" and returns
   * 70000, in cents, because that is what the engine compares. The route accepts
   * only the model's contract, where money crosses as {amount, currency} in
   * whole dollars, and refuses a bare number rather than guessing its unit. Both
   * are right and they are not the same contract, and nothing converted between
   * them: every budget this stand-in read was rejected on arrival and the
   * shopper was told "I could not read that reliably". A budget is the single
   * most common thing anyone types into it.
   *
   * So the conversion happens here, once, on the boundary it belongs to.
   */
  private toModelMoney<T extends HardConstraint | SoftPreference>(c: T): T | (Omit<T, "value"> & { value: { amount: number; currency: typeof MONEY_CURRENCY } }) {
    if (!isMoneyKey(this.categoryForExtraction, c.key)) return c;
    if (typeof c.value !== "number") return c;
    // Minor units to whole units. `dollarsToCents` reverses this through the
    // decimal string, so 199 cents goes out as 1.99 and comes back as 199.
    return { ...c, value: { amount: c.value / 100, currency: MONEY_CURRENCY } };
  }

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
        hard: prefs.hard.map((c) => this.toModelMoney(c)) as ModelHardConstraint[],
        soft: prefs.soft.map((c) => this.toModelMoney(c)) as ModelSoftPreference[],
        unmapped: prefs.unmapped,
        question,
        medicalIntent: prefs.medicalIntent,
        suggestCompare: [],
      },
      // Costs nothing and is never metered, so zero here is a fact.
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "scripted",
      status: "ok" as const,
    };
  }
}
