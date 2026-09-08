import type { ClientEnv } from "./client-identity";

// How the assistant authenticates to the model provider. Two modes, chosen
// explicitly, because guessing between them is how a request ends up sent with
// the wrong credential or none at all.
//
// `api_key` is the default and unchanged: the key is read from the environment
// and sent as a bearer token by this application.
//
// `proxy` is for a Claude Code cloud environment on a Pro or Max plan, where the
// key is stored as an API credential and Anthropic's agent proxy attaches it
// after the request leaves the sandbox. The application never holds the key, so
// it sends no authorization header of its own.

export const OPENAI_HOST = "api.openai.com";
export const DEFAULT_BASE_URL = `https://${OPENAI_HOST}/v1`;

export type Credential =
  | { mode: "api_key"; apiKey: string; baseUrl: string }
  | { mode: "proxy"; baseUrl: string }
  // No credential configured. The scripted stand-in runs and is labelled.
  | { mode: "none" }
  | { mode: "misconfigured"; reason: string };

function hostOf(url: string): { host: string; https: boolean } | null {
  try {
    const u = new URL(url);
    return { host: u.hostname.toLowerCase(), https: u.protocol === "https:" };
  } catch {
    return null;
  }
}

export function resolveCredential(env: ClientEnv = process.env): Credential {
  const mode = env.ASSISTANT_CREDENTIAL_MODE?.trim().toLowerCase() || "api_key";
  const baseUrl = env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const apiKey = env.OPENAI_API_KEY?.trim();

  if (mode !== "api_key" && mode !== "proxy") {
    return { mode: "misconfigured", reason: `ASSISTANT_CREDENTIAL_MODE must be "api_key" or "proxy", not "${mode}".` };
  }

  if (mode === "proxy") {
    // Proxy mode is restricted to OpenAI's own host. The proxy attaches the
    // credential by hostname, so pointing this anywhere else would send an
    // unauthenticated request to a third party, or an authenticated one to a
    // host the operator did not intend.
    const parsed = hostOf(baseUrl);
    if (!parsed) return { mode: "misconfigured", reason: `OPENAI_BASE_URL is not a valid URL: "${baseUrl}".` };
    if (!parsed.https || parsed.host !== OPENAI_HOST) {
      return { mode: "misconfigured", reason: `Proxy credential mode only allows https://${OPENAI_HOST}. OPENAI_BASE_URL points at "${baseUrl}".` };
    }
    // Both configured is ambiguous, and ambiguity about which credential pays
    // for a request is not something to resolve by preference.
    if (apiKey) {
      return { mode: "misconfigured", reason: "Both OPENAI_API_KEY and ASSISTANT_CREDENTIAL_MODE=proxy are set. Remove one: in proxy mode the application must not hold a key." };
    }
    return { mode: "proxy", baseUrl };
  }

  if (!apiKey) return { mode: "none" };
  return { mode: "api_key", apiKey, baseUrl };
}
