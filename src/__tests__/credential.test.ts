import { describe, expect, it, vi } from "vitest";
import type { ClientEnv } from "@/domain/client-identity";
import { DEFAULT_BASE_URL, resolveCredential } from "@/domain/credential";
import { OpenAIConversationProvider, ProviderCallError, type ConverseInput } from "@/providers/ai/OpenAIProvider";

const input: ConverseInput = {
  categoryName: "Red light therapy",
  filterVocabulary: "price",
  products: [],
  messages: [{ role: "user", text: "hi" }],
  activeConstraints: [],
};

describe("choosing a credential", () => {
  it("defaults to api_key mode, so nothing changes for an existing install", () => {
    const c = resolveCredential({ OPENAI_API_KEY: "sk-abc" } as ClientEnv);
    expect(c).toEqual({ mode: "api_key", apiKey: "sk-abc", baseUrl: DEFAULT_BASE_URL });
  });

  it("reports no credential when no key is set, which runs the scripted stand-in", () => {
    expect(resolveCredential({})).toEqual({ mode: "none" });
  });

  it("keeps honouring a custom base URL in api_key mode", () => {
    // Useful for a local mock or a compatible endpoint. Only the key travels.
    const c = resolveCredential({ OPENAI_API_KEY: "sk-abc", OPENAI_BASE_URL: "https://mock.internal/v1" });
    expect(c).toEqual({ mode: "api_key", apiKey: "sk-abc", baseUrl: "https://mock.internal/v1" });
  });

  it("proxy mode needs no key and defaults to OpenAI's host", () => {
    expect(resolveCredential({ ASSISTANT_CREDENTIAL_MODE: "proxy" })).toEqual({ mode: "proxy", baseUrl: DEFAULT_BASE_URL });
  });

  it("proxy mode refuses any host but api.openai.com", () => {
    for (const url of ["https://evil.example/v1", "https://api.openai.com.evil.example/v1", "http://api.openai.com/v1", "not a url"]) {
      const c = resolveCredential({ ASSISTANT_CREDENTIAL_MODE: "proxy", OPENAI_BASE_URL: url });
      expect(c.mode).toBe("misconfigured");
    }
    expect(resolveCredential({ ASSISTANT_CREDENTIAL_MODE: "proxy", OPENAI_BASE_URL: "https://api.openai.com/v1" }).mode).toBe("proxy");
  });

  it("refuses proxy mode with a key also set, rather than picking one", () => {
    const c = resolveCredential({ ASSISTANT_CREDENTIAL_MODE: "proxy", OPENAI_API_KEY: "sk-abc" });
    expect(c.mode).toBe("misconfigured");
    if (c.mode === "misconfigured") expect(c.reason).toMatch(/Remove one/);
  });

  it("refuses an unrecognised mode instead of falling back", () => {
    const c = resolveCredential({ ASSISTANT_CREDENTIAL_MODE: "yolo", OPENAI_API_KEY: "sk-abc" });
    expect(c.mode).toBe("misconfigured");
  });

  it("is case and whitespace tolerant on the mode name", () => {
    expect(resolveCredential({ ASSISTANT_CREDENTIAL_MODE: " Proxy " }).mode).toBe("proxy");
  });
});

describe("what the provider puts on the wire", () => {
  async function headersFor(apiKey: string | null, baseUrl = DEFAULT_BASE_URL) {
    let sent: Record<string, string> = {};
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      sent = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await new OpenAIConversationProvider(apiKey, "gpt-4o-mini", baseUrl).converse(input);
    vi.unstubAllGlobals();
    return sent;
  }

  it("sends a bearer token in api_key mode", async () => {
    expect(await headersFor("sk-abc")).toMatchObject({ authorization: "Bearer sk-abc" });
  });

  it("sends no authorization header in proxy mode, leaving it to the proxy", async () => {
    const sent = await headersFor(null);
    expect(sent.authorization).toBeUndefined();
    expect(Object.keys(sent).map((k) => k.toLowerCase())).not.toContain("authorization");
    expect(sent["content-type"]).toBe("application/json");
  });

  it("refuses to send an unauthenticated request anywhere but OpenAI, and charges nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const p = new OpenAIConversationProvider(null, "gpt-4o-mini", "https://evil.example/v1");
    const e = await p.converse(input).catch((err) => err as ProviderCallError);
    expect(e).toBeInstanceOf(ProviderCallError);
    expect((e as ProviderCallError).billable).toBe("not_billed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still reports itself live in proxy mode, so the UI does not label it a prototype", () => {
    expect(new OpenAIConversationProvider(null).isLive).toBe(true);
  });
});
