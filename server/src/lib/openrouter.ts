import { env } from "../env.ts";

const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_JSON_TIMEOUT_MS = 55_000;
const OPENROUTER_STREAM_TIMEOUT_MS = 90_000;

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

// JSON completion with one retry. Persistent failures throw so the caller can
// fail the job/request instead of hanging.
export async function requestOpenRouterJson<T>(input: {
  model: string;
  system: string;
  user: Record<string, unknown>;
  temperature?: number;
}): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await requestOnce<T>(input);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("OpenRouter request failed");
}

async function requestOnce<T>(input: {
  model: string;
  system: string;
  user: Record<string, unknown>;
  temperature?: number;
}): Promise<T> {
  const response = await fetch(openRouterUrl, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: input.model,
      messages: [
        { role: "system", content: input.system },
        { role: "user", content: JSON.stringify(input.user) },
      ],
      temperature: input.temperature ?? 0.2,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(OPENROUTER_JSON_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with ${response.status}`);
  }

  const completion = await response.json() as any;
  const content = completion?.choices?.[0]?.message?.content;

  if (typeof content !== "string") {
    throw new Error("OpenRouter returned an invalid response");
  }

  const jsonText = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  return JSON.parse(jsonText) as T;
}

// A single non-streaming text completion (used for chat session titles).
export async function requestOpenRouterText(input: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
  const response = await fetch(openRouterUrl, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? OPENROUTER_JSON_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with ${response.status}`);
  }

  const completion = await response.json() as any;
  return String(completion?.choices?.[0]?.message?.content ?? "");
}

// Streams content deltas from a chat completion.
export async function* streamOpenRouter(input: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
}): AsyncGenerator<string> {
  const response = await fetch(openRouterUrl, {
    method: "POST",
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model: input.model,
      stream: true,
      temperature: input.temperature ?? 0.3,
      messages: input.messages,
    }),
    signal: AbortSignal.timeout(OPENROUTER_STREAM_TIMEOUT_MS),
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Chat model request failed with ${response.status} ${detail.slice(0, 200)}`,
    );
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            yield delta;
          }
        } catch {
          // Ignore keep-alive / malformed lines.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function openRouterHeaders() {
  return {
    "Authorization": `Bearer ${env.openRouterApiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://vidura.nipuntheekshana.com",
    "X-Title": "Vidura",
  };
}
