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
  const request = requestForProvider(provider, apiKey, messages, instructions, maxOutputTokens);
  const response = await fetch(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(provider.name + " respondeu HTTP " + response.status + ".");
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

  if (!text) throw new Error(provider.name + " não retornou conteúdo textual.");
  return { text, inputTokens, outputTokens };
}
