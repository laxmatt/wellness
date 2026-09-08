import { z } from "zod";
import { ModelIntent } from "@/domain/assistant";
import { estimateTokens } from "@/providers/usage/UsageMeter";

// Called over plain fetch. No SDK dependency to pin, patch or audit.
// The key is read from the environment on the server only and never reaches a
// response body, a log line or the browser bundle.

export type GroundedFact = { label: string; value: string; evidence: "sourced" | "manufacturer_claim" };
export type GroundedProduct = {
  id: string;
  name: string;
  brand: string;
  price: string;
  priceIsPlaceholder: boolean;
  facts: GroundedFact[];
  notStated: string[];
};

export type ConverseInput = {
  categoryName: string;
  filterVocabulary: string;
  products: GroundedProduct[];
  messages: { role: "user" | "assistant"; text: string }[];
  activeConstraints: string[];
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type ConverseResult = {
  intent: ModelIntent;
  model: string;
  // Null when the provider answered but did not report usable token counts.
  // The caller must then treat the cost as unknown rather than as zero.
  usage: TokenUsage | null;
};

// Carries whether the provider could have charged for the attempt. Anything
// the provider rejected before inference is free; anything that was sent and
// then went dark is not known to be free and must not be treated as such.
export class ProviderCallError extends Error {
  constructor(
    message: string,
    readonly billable: "not_billed" | "uncertain",
  ) {
    super(message);
    this.name = "ProviderCallError";
  }
}

export interface ConversationProvider {
  readonly name: string;
  readonly isLive: boolean;
  // Estimated prompt size in tokens, so the caller can refuse to send a
  // request larger than it reserved budget for.
  estimatePromptTokens(input: ConverseInput): number;
  converse(input: ConverseInput): Promise<ConverseResult>;
}

const SYSTEM = `You help someone choose between products on a comparison site.

Your job is to understand what they need and turn it into structured filters. You do NOT decide which product is best: the site's own ranking engine does that and its result is shown alongside your reply. Never claim a product is best, top-rated or recommended by you.

Rules you must follow:
1. Only ever refer to products and figures given to you in the CATALOGUE block. Never introduce a product, brand, price or specification that is not there. If asked something the catalogue does not answer, say the information is not stated.
2. Distinguish evidence. A fact marked "manufacturer_claim" is what the maker says, not an independent measurement; say so when you rely on it. A field listed under "not stated" is unknown; never estimate it.
3. Ask about budget, intended use, space and preferences when they are still unknown, one question at a time, and offer a few concrete options.
4. If a constraint the shopper gave cannot be met, do NOT silently drop it. Say what does not fit and ask whether they want to relax it.
5. These are wellness products. Help with the shopping decision only. Never say or imply a product treats, cures, prevents, diagnoses or relieves any medical condition, and never give personalized medical advice. If asked, set medicalIntent true, say plainly that you cannot answer that, and offer to compare on specifications instead.
6. Be brief. Two or three sentences.

Reply with a single JSON object and nothing else:
{"reply": string, "hard": [{"key","op","value"}], "soft": [{"key","direction","value","weight"}], "unmapped": [string], "question": {"text","options":[string]} | null, "medicalIntent": boolean, "suggestCompare": [productId]}

"hard" and "soft" must use only the filter keys listed in FILTERS. Repeat every constraint that still applies, not just new ones. Use "unmapped" for anything the shopper cares about that the filters cannot express.`;

export class OpenAIConversationProvider implements ConversationProvider {
  readonly name = "openai";
  readonly isLive = true;

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    private readonly baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    private readonly maxOutputTokens = Number(process.env.ASSISTANT_MAX_OUTPUT_TOKENS ?? 500),
    private readonly timeoutMs = Number(process.env.ASSISTANT_TIMEOUT_MS ?? 20000),
  ) {}

  private buildMessages(input: ConverseInput) {
    const catalogue = input.products
      .map((p) => {
        const facts = p.facts.map((f) => `    ${f.label}: ${f.value} [${f.evidence}]`).join("\n");
        const missing = p.notStated.length > 0 ? `\n    not stated: ${p.notStated.join(", ")}` : "";
        const price = p.priceIsPlaceholder ? `${p.price} [placeholder price, do not rely on it]` : `${p.price} [sourced]`;
        return `  ${p.id} | ${p.brand} ${p.name} | price ${price}\n${facts}${missing}`;
      })
      .join("\n");

    const context = [
      `CATEGORY: ${input.categoryName}`,
      `FILTERS: ${input.filterVocabulary}`,
      input.activeConstraints.length > 0 ? `ALREADY AGREED: ${input.activeConstraints.join("; ")}` : "ALREADY AGREED: nothing yet",
      `CATALOGUE:\n${catalogue}`,
    ].join("\n\n");

    return [
      { role: "system" as const, content: SYSTEM },
      { role: "system" as const, content: context },
      ...input.messages.map((m) => ({ role: m.role, content: m.text })),
    ];
  }

  estimatePromptTokens(input: ConverseInput): number {
    return estimateTokens(this.buildMessages(input).map((m) => m.content).join("\n"));
  }

  async converse(input: ConverseInput): Promise<ConverseResult> {
    // One deadline for the whole exchange. Clearing it once headers arrive
    // would leave a stalled body to hang until the platform killed the
    // function, with the reservation still open and no outcome recorded.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.exchange(input, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async exchange(input: ConverseInput, signal: AbortSignal): Promise<ConverseResult> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        signal,
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          // Bounds the output side of the reservation. Without it the provider
          // would be free to generate far more than the budget assumed.
          max_tokens: this.maxOutputTokens,
          response_format: { type: "json_object" },
          messages: this.buildMessages(input),
        }),
      });
    } catch (e) {
      throw connectionError(e, "before");
    }

    if (!res.ok) {
      // Never surface the provider's body to the client: it can echo headers.
      throw await statusError(res);
    }

    let json: {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      json = await res.json();
    } catch (e) {
      // The provider answered 200, so inference ran and was charged. Whether
      // the body stalled, was truncated or was not JSON, we cannot read the
      // cost, and the timeout above still applies to this read.
      throw connectionError(e, "after");
    }

    const raw = json.choices?.[0]?.message?.content ?? "{}";

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      parsedJson = {};
    }
    const parsed = ModelIntent.safeParse(normalize(parsedJson));

    return {
      intent: parsed.success
        ? parsed.data
        : { reply: "I could not read that reliably. Could you say it another way?", hard: [], soft: [], unmapped: [], medicalIntent: false, suggestCompare: [] },
      // Missing or nonsensical usage is not zero usage. Reporting it as null
      // makes the caller hold the reservation instead of releasing it.
      usage: readUsage(json.usage),
      model: this.model,
    };
  }
}

function readUsage(u: { prompt_tokens?: number; completion_tokens?: number } | undefined): TokenUsage | null {
  if (!u) return null;
  const inputTokens = u.prompt_tokens;
  const outputTokens = u.completion_tokens;
  const usable = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (!usable(inputTokens) || !usable(outputTokens)) return null;
  // A 200 that reports no tokens at all did not happen. Treat it as unknown.
  if (inputTokens === 0 && outputTokens === 0) return null;
  return { inputTokens, outputTokens };
}

// A status code is only evidence of "not billed" when the provider itself
// rejected the request. An OpenAI error body carries an `error` object; a 4xx
// from an intermediary in front of it does not, and gives us no such evidence.
async function statusError(res: Response): Promise<ProviderCallError> {
  if (res.status < 400 || res.status >= 500) return new ProviderCallError(`The provider returned ${res.status}.`, "uncertain");
  let looksLikeProvider = false;
  try {
    const body = (await res.json()) as { error?: unknown };
    looksLikeProvider = typeof body?.error === "object" && body.error !== null;
  } catch {
    looksLikeProvider = false;
  }
  // 408 and 499 mean the request was cut off, not refused, so they stay uncertain.
  const refusedBeforeInference = looksLikeProvider && res.status !== 408 && res.status !== 499;
  return new ProviderCallError(`The provider returned ${res.status}.`, refusedBeforeInference ? "not_billed" : "uncertain");
}

// Only a failure that provably happened before the request was written settles
// at zero: a name that did not resolve, a connection that was refused. Anything
// after that, including an abort, may have been processed and charged.
function connectionError(e: unknown, phase: "before" | "after"): ProviderCallError {
  const message = e instanceof Error ? e.message : String(e);
  const aborted = e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError" || /abort/i.test(message));
  if (phase === "before") {
    const neverSent = /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|ERR_SSL|CERT_/i.test(message);
    if (neverSent && !aborted) return new ProviderCallError("The assistant could not be reached.", "not_billed");
  }
  return new ProviderCallError(aborted ? "The request timed out." : "The request could not be completed.", "uncertain");
}

// The model returns JSON but not necessarily our JSON. Coerce the shapes we
// tolerate, then let Zod reject the rest.
function normalize(v: unknown): unknown {
  if (typeof v !== "object" || v === null) return {};
  const o = { ...(v as Record<string, unknown>) };
  if (o.question === null) delete o.question;
  if (o.question && typeof o.question === "object") {
    const q = o.question as Record<string, unknown>;
    if (!Array.isArray(q.options)) q.options = [];
  }
  for (const k of ["hard", "soft", "unmapped", "suggestCompare"]) if (!Array.isArray(o[k])) o[k] = [];
  if (Array.isArray(o.soft)) {
    o.soft = (o.soft as Record<string, unknown>[]).map((s) => ({ weight: 0.5, direction: "prefer_high", ...s }));
  }
  if (typeof o.reply !== "string") o.reply = "";
  return o;
}

export const ScriptedIntent = z.object({ reply: z.string() });
