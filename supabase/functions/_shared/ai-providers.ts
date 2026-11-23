export type AiProviderKind =
  | "openai"
  | "gemini"
  | "anthropic"
  | "azure_openai"
  | "openai_compatible";

export type AiProviderConfig = {
  id: string;
  name: string;
  provider: AiProviderKind;
  model: string;
  api_base_url: string | null;
  api_version: string | null;
  input_cost_per_million?: number | string | null;
  output_cost_per_million?: number | string | null;
};

export type AiChatMessage = { role: "user" | "assistant"; content: string };

export type AiProviderResult = {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
};

type JsonRecord = Record<string, unknown>;

export type AiProviderErrorDetails = {
  httpStatus: number | null;
  errorCode: string | null;
  errorType: string | null;
  retryable: boolean;
  retryAfter: string | null;
};

export class AiProviderError extends Error {
  readonly details: AiProviderErrorDetails;

  constructor(message: string, details: AiProviderErrorDetails) {
    super(message);
    this.name = "AiProviderError";
    this.details = details;
  }
}

function sanitizedErrorMessage(value: unknown, apiKey: string): string {
  if (typeof value !== "string") return "";
  let message = value.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  if (apiKey.length >= 8) message = message.replaceAll(apiKey, "[credencial ocultada]");
  message = message
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/gi, "[credencial ocultada]")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[credencial ocultada]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [oculto]");
  return message.slice(0, 500);
}

function retryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function providerErrorFromResponse(
  provider: AiProviderConfig,
  response: Response,
  rawBody: string,
  apiKey: string,
): AiProviderError {
  let payload: JsonRecord = {};
  try {
    payload = record(JSON.parse(rawBody));
  } catch {
    // Some gateways return plain-text or HTML error bodies.
  }
  const error = record(payload.error);
  const metadata = record(error.metadata);
  const message = sanitizedErrorMessage(
    error.message ?? payload.message ?? payload.error_description ?? rawBody,
    apiKey,
  );
  const errorCodeValue = error.code ?? metadata.provider_code ?? payload.code;
  const errorTypeValue = metadata.error_type ?? error.type ?? payload.error_type;
  const errorCode = errorCodeValue === undefined ? null : String(errorCodeValue).slice(0, 120);
  const errorType = errorTypeValue === undefined ? null : String(errorTypeValue).slice(0, 120);
  const retryable = retryableHttpStatus(response.status) ||
    errorType === "rate_limit_exceeded" ||
    errorType === "provider_overloaded" ||
    errorType === "provider_unavailable";
  const description = message || "A API não informou detalhes adicionais.";
  return new AiProviderError(
    provider.name + " respondeu HTTP " + response.status + ": " + description,
    {
      httpStatus: response.status,
      errorCode,
      errorType,
      retryable,
      retryAfter: response.headers.get("Retry-After"),
    },
  );
}

export function getAiProviderCompatibilityIssue(provider: AiProviderConfig): string | null {
  if (provider.provider !== "openai_compatible" || !provider.api_base_url) return null;
  try {
    const hostname = new URL(provider.api_base_url).hostname.toLowerCase();
    if (
      (hostname === "openrouter.ai" || hostname === "www.openrouter.ai") &&
      /^perplexity\/pplx-decider(?:-|:|$)/i.test(provider.model)
    ) {
      return (
        "Este modelo Perplexity Decider não é compatível com chat: no OpenRouter ele utiliza " +
        "a Decisions API (/api/alpha/decisions), enquanto o Primus precisa de Chat Completions. " +
        "Cadastre um modelo de conversa compatível com /api/v1/chat/completions."
      );
    }
  } catch {
    return null;
  }
  return null;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function openAiResponseText(payload: JsonRecord): string {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return "";
  return payload.output
    .flatMap((item) => {
      const content = record(item).content;
      return Array.isArray(content) ? content : [];
    })
    .filter((item) => record(item).type === "output_text" && typeof record(item).text === "string")
    .map((item) => String(record(item).text))
    .join("\n")
    .trim();
}

function chatCompletionText(payload: JsonRecord): string {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = record(record(choices[0]).message);
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((item) => typeof record(item).text === "string")
      .map((item) => String(record(item).text))
      .join("\n")
      .trim();
  }
  return "";
}

function geminiText(payload: JsonRecord): string {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const parts = record(record(candidates[0]).content).parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => typeof record(part).text === "string")
    .map((part) => String(record(part).text))
    .join("\n")
    .trim();
}

function anthropicText(payload: JsonRecord): string {
  if (!Array.isArray(payload.content)) return "";
  return payload.content
    .filter((part) => record(part).type === "text" && typeof record(part).text === "string")
    .map((part) => String(record(part).text))
    .join("\n")
    .trim();
}

function compatibleEndpoint(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(base)) return base;
  if (/\/v1$/i.test(base)) return base + "/chat/completions";
  return base + "/v1/chat/completions";
}

function requestForProvider(
  provider: AiProviderConfig,
  apiKey: string,
  messages: AiChatMessage[],
  instructions: string,
  maxOutputTokens: number,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let url = "";
  let body: JsonRecord = {};

  switch (provider.provider) {
    case "openai":
      url = "https://api.openai.com/v1/responses";
      headers.Authorization = "Bearer " + apiKey;
      body = {
        model: provider.model,
        instructions,
        input: messages.map((message) => ({ role: message.role, content: message.content })),
        max_output_tokens: maxOutputTokens,
        store: false,
      };
      break;
    case "gemini":
      url =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(provider.model) +
        ":generateContent";
      headers["x-goog-api-key"] = apiKey;
      body = {
        systemInstruction: { parts: [{ text: instructions }] },
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: { maxOutputTokens },
      };
      break;
    case "anthropic":
      url = "https://api.anthropic.com/v1/messages";
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model: provider.model,
        system: instructions,
        messages: messages.map((message) => ({ role: message.role, content: message.content })),
        max_tokens: maxOutputTokens,
      };
      break;
    case "azure_openai": {
      if (!provider.api_base_url) throw new Error("Endpoint do Azure OpenAI não configurado.");
      const base = provider.api_base_url.replace(/\/+$/, "");
      const version = provider.api_version || "2024-10-21";
      url =
        base +
        "/openai/deployments/" +
        encodeURIComponent(provider.model) +
        "/chat/completions?api-version=" +
        encodeURIComponent(version);
      headers["api-key"] = apiKey;
      body = {
        messages: [
          { role: "system", content: instructions },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        max_tokens: maxOutputTokens,
      };
      break;
    }
    case "openai_compatible":
      if (!provider.api_base_url) throw new Error("URL base da API compatível não configurada.");
      url = compatibleEndpoint(provider.api_base_url);
      headers.Authorization = "Bearer " + apiKey;
      body = {
        model: provider.model,
        messages: [
          { role: "system", content: instructions },
          ...messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        max_tokens: maxOutputTokens,
        stream: false,
      };
      break;
  }

  return { url, headers, body };
}

export async function invokeAiProvider(
  provider: AiProviderConfig,
  apiKey: string,
  messages: AiChatMessage[],
  instructions: string,
  maxOutputTokens = 1_500,
  timeoutMs = 45_000,
): Promise<AiProviderResult> {
  const compatibilityIssue = getAiProviderCompatibilityIssue(provider);
  if (compatibilityIssue) {
    throw new AiProviderError(compatibilityIssue, {
      httpStatus: 400,
      errorCode: "unsupported_api",
      errorType: "unsupported_model_api",
      retryable: false,
      retryAfter: null,
    });
  }

  const request = requestForProvider(provider, apiKey, messages, instructions, maxOutputTokens);
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const errorName = cause instanceof Error ? cause.name : "NetworkError";
    const timedOut = errorName === "TimeoutError" || errorName === "AbortError";
    throw new AiProviderError(
      timedOut
        ? provider.name + " excedeu o tempo limite de resposta."
        : provider.name + " não pôde ser alcançado. Verifique a rede e tente novamente.",
      {
        httpStatus: null,
        errorCode: errorName.slice(0, 120),
        errorType: timedOut ? "timeout" : "network_error",
        retryable: true,
        retryAfter: null,
      },
    );
  }

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    throw providerErrorFromResponse(provider, response, rawBody.slice(0, 8_000), apiKey);
  }

  const payload = record(await response.json().catch(() => null));
  let text = "";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  switch (provider.provider) {
    case "openai": {
      text = openAiResponseText(payload);
      const usage = record(payload.usage);
      inputTokens = numberOrNull(usage.input_tokens);
      outputTokens = numberOrNull(usage.output_tokens);
      break;
    }
    case "gemini": {
      text = geminiText(payload);
      const usage = record(payload.usageMetadata);
      inputTokens = numberOrNull(usage.promptTokenCount);
      outputTokens = numberOrNull(usage.candidatesTokenCount);
      break;
    }
    case "anthropic": {
      text = anthropicText(payload);
      const usage = record(payload.usage);
      inputTokens = numberOrNull(usage.input_tokens);
      outputTokens = numberOrNull(usage.output_tokens);
      break;
    }
    case "azure_openai":
    case "openai_compatible": {
      text = chatCompletionText(payload);
      const usage = record(payload.usage);
      inputTokens = numberOrNull(usage.prompt_tokens);
      outputTokens = numberOrNull(usage.completion_tokens);
      break;
    }
  }

  if (!text) {
    throw new AiProviderError(
      provider.name +
        " respondeu HTTP 200, mas não retornou texto. O limite de saída pode ter sido consumido " +
        "por tokens de raciocínio; tente novamente ou aumente o limite do modelo.",
      {
        httpStatus: 502,
        errorCode: "empty_response",
        errorType: "empty_response",
        retryable: true,
        retryAfter: null,
      },
    );
  }
  return { text, inputTokens, outputTokens };
}
