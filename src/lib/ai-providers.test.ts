import { afterEach, describe, expect, it, vi } from "vitest";
import {
  invokeAiProvider,
  type AiProviderConfig,
} from "../../supabase/functions/_shared/ai-providers";

const messages = [{ role: "user" as const, content: "Olá" }];

function provider(
  kind: AiProviderConfig["provider"],
  overrides: Partial<AiProviderConfig> = {},
): AiProviderConfig {
  return {
    id: "provider-test",
    name: "Provedor de teste",
    provider: kind,
    model: "model-test",
    api_base_url: null,
    api_version: null,
    ...overrides,
  };
}

function mockFetch(payload: unknown, status = 200) {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    getRequest: () => ({ url: requestUrl, init: requestInit }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("adaptadores multiprovedor de IA", () => {
  it("chama OpenAI Responses e extrai texto e tokens", async () => {
    const mock = mockFetch({
      output: [{ content: [{ type: "output_text", text: "Resposta OpenAI" }] }],
      usage: { input_tokens: 12, output_tokens: 5 },
    });
    const result = await invokeAiProvider(
      provider("openai"),
      "sk-test-openai",
      messages,
      "Instruções",
    );
    const request = mock.getRequest();
    const body = JSON.parse(String(request.init?.body));

    expect(request.url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(request.init?.headers).get("authorization")).toBe("Bearer sk-test-openai");
    expect(body.store).toBe(false);
    expect(result).toEqual({ text: "Resposta OpenAI", inputTokens: 12, outputTokens: 5 });
    expect(mock.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("chama Gemini generateContent e normaliza usageMetadata", async () => {
    const mock = mockFetch({
      candidates: [{ content: { parts: [{ text: "Resposta Gemini" }] } }],
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7 },
    });
    const result = await invokeAiProvider(
      provider("gemini"),
      "gemini-test-key",
      messages,
      "Instruções",
    );
    const request = mock.getRequest();

    expect(request.url).toContain("/v1beta/models/model-test:generateContent");
    expect(new Headers(request.init?.headers).get("x-goog-api-key")).toBe("gemini-test-key");
    expect(result).toEqual({ text: "Resposta Gemini", inputTokens: 20, outputTokens: 7 });
  });

  it("chama Anthropic Messages com versão explícita", async () => {
    const mock = mockFetch({
      content: [{ type: "text", text: "Resposta Claude" }],
      usage: { input_tokens: 30, output_tokens: 9 },
    });
    const result = await invokeAiProvider(
      provider("anthropic"),
      "anthropic-test-key",
      messages,
      "Instruções",
    );
    const request = mock.getRequest();

    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(request.init?.headers).get("anthropic-version")).toBe("2023-06-01");
    expect(new Headers(request.init?.headers).get("x-api-key")).toBe("anthropic-test-key");
    expect(result).toEqual({ text: "Resposta Claude", inputTokens: 30, outputTokens: 9 });
  });

  it("monta endpoint Azure OpenAI com deployment e api-version", async () => {
    const mock = mockFetch({
      choices: [{ message: { content: "Resposta Azure" } }],
      usage: { prompt_tokens: 40, completion_tokens: 11 },
    });
    const result = await invokeAiProvider(
      provider("azure_openai", {
        model: "deployment-prod",
        api_base_url: "https://primus.openai.azure.com",
        api_version: "2024-10-21",
      }),
      "azure-test-key",
      messages,
      "Instruções",
    );
    const request = mock.getRequest();

    expect(request.url).toBe(
      "https://primus.openai.azure.com/openai/deployments/deployment-prod/chat/completions?api-version=2024-10-21",
    );
    expect(new Headers(request.init?.headers).get("api-key")).toBe("azure-test-key");
    expect(result).toEqual({ text: "Resposta Azure", inputTokens: 40, outputTokens: 11 });
  });

  it("usa endpoint Chat Completions para APIs compatíveis com OpenAI", async () => {
    const mock = mockFetch({
      choices: [{ message: { content: "Resposta compatível" } }],
      usage: { prompt_tokens: 50, completion_tokens: 13 },
    });
    const result = await invokeAiProvider(
      provider("openai_compatible", {
        api_base_url: "https://api.example-provider.com/v1",
      }),
      "compatible-test-key",
      messages,
      "Instruções",
    );
    const request = mock.getRequest();

    expect(request.url).toBe("https://api.example-provider.com/v1/chat/completions");
    expect(new Headers(request.init?.headers).get("authorization")).toBe(
      "Bearer compatible-test-key",
    );
    expect(result).toEqual({
      text: "Resposta compatível",
      inputTokens: 50,
      outputTokens: 13,
    });
  });

  it("retorna erro sanitizado quando o provedor responde fora de 2xx", async () => {
    mockFetch({ error: { message: "detalhe interno que não deve ser exibido" } }, 401);
    await expect(
      invokeAiProvider(provider("openai"), "sk-test-openai", messages, "Instruções"),
    ).rejects.toThrow("Provedor de teste respondeu HTTP 401.");
  });
});
