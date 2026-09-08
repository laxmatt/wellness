import type { ConversationProvider, ConverseInput } from "@/providers/ai/OpenAIProvider";

// Holds a request to the size the reservation was taken for.
//
// This is an estimate, not a guarantee. The provider counts tokens with its own
// tokenizer; this counts characters and divides. Trimming here keeps a request
// close to the reserved size. It cannot promise the provider will agree.
export function boundInput(provider: ConversationProvider, input: ConverseInput, maxInputTokens: number): ConverseInput | null {
  let trimmed = input;
  while (provider.estimatePromptTokens(trimmed) > maxInputTokens && trimmed.messages.length > 1) {
    trimmed = { ...trimmed, messages: trimmed.messages.slice(1) };
  }
  return provider.estimatePromptTokens(trimmed) > maxInputTokens ? null : trimmed;
}
