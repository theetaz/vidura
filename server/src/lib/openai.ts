// Sinhala translation via OpenAI structured outputs, streamed for live progress.
//
// The whole English transcript (with timestamps, for context and pacing) goes in
// one request; a strict json_schema returns one clean Sinhala line per index.
// The response is streamed so we can count completed lines and report granular
// progress. LLMs occasionally drop indices on long lists, so any missing lines
// are re-requested (with the full transcript still supplied as context) until
// every index is covered or a small round cap is hit.

import { env } from "../env.ts";
import type {
  NormalizedTranscriptSegment,
  VideoMetadata,
} from "./youtube.ts";
import type { TranslationResult } from "./translation.ts";

const OPENAI_TIMEOUT_MS = 240_000;
const MAX_ROUNDS = 4;

type ProviderConfig = {
  url: string;
  apiKey: string;
  model: string;
  jsonSchema: boolean;
  openrouter: boolean;
};

// Resolves the translation endpoint from TRANSLATION_PROVIDER. Both providers
// speak the OpenAI chat-completions API, so the streaming logic is shared.
function resolveProvider(): ProviderConfig | null {
  if (env.translationProvider === "openai") {
    if (!env.openaiApiKey) return null;
    return {
      url: "https://api.openai.com/v1/chat/completions",
      apiKey: env.openaiApiKey,
      model: env.openaiModel,
      jsonSchema: true,
      openrouter: false,
    };
  }
  // "deepseek" (or anything else) → DeepSeek via OpenRouter.
  if (!env.openRouterApiKey) return null;
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    apiKey: env.openRouterApiKey,
    model: env.openRouterModel,
    jsonSchema: false, // OpenRouter/DeepSeek: json_object is the safe mode.
    openrouter: true,
  };
}

export function singleShotTranslationEnabled(): boolean {
  return resolveProvider() !== null;
}

export function translationModelName(): string {
  return resolveProvider()?.model ?? "unknown";
}

function timestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const body = `${mm}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${body}` : body;
}

// Default localization "guidance". Users can replace this via their translation
// settings; the FORMAT_RULES below are always appended so output stays parseable.
function defaultGuidance(targetLanguage: string): string {
  return [
    `You are an expert subtitle localizer translating educational YouTube videos into natural, fluent, spoken ${targetLanguage}.`,
    `Write idiomatic ${targetLanguage} that a native speaker would actually say while explaining the same idea — NOT a literal word-for-word translation.`,
    "A sentence often spans several consecutive lines; let the translation flow naturally across those indices instead of forcing each line to be a standalone sentence.",
    "Preserve meaning and context across the whole video; keep terminology consistent throughout.",
    "Avoid calques and awkward word order. Keep widely-used technical terms or proper nouns in their common form when that is what a native speaker would naturally use.",
    "Keep each line concise enough to read as an on-screen subtitle.",
  ].join("\n");
}

const FORMAT_RULES = [
  "You are given the ENTIRE English transcript of one video as an ordered list of lines, each with an index and a timestamp, plus `translateIndices` — the indices to translate right now. Read the whole transcript first for context, then translate the requested lines.",
  "- Return EXACTLY one object for every index in `translateIndices` — never skip, merge, drop, split, or reorder indices. The number of objects MUST equal the number of requested indices.",
  '- Output format: a single JSON object shaped EXACTLY like {"translations":[{"index":0,"text":"..."},{"index":1,"text":"..."}]} — an array under the "translations" key, one object per requested index with an integer "index" and the translated "text". Do not use any other shape (no index-keyed maps).',
].join("\n");

function systemPrompt(targetLanguage: string, guidanceOverride?: string): string {
  const guidance = guidanceOverride?.trim() || defaultGuidance(targetLanguage);
  return `${guidance}\n\n${FORMAT_RULES}`;
}

// Accepts the expected {translations:[{index,text}]} shape, a bare array, or an
// index-keyed map {"0":"…"} (which some models emit in json_object mode).
function extractTranslations(parsed: any): TranslationResult[] {
  const out: TranslationResult[] = [];
  const push = (index: unknown, text: unknown) => {
    const i = Number(index);
    const t = String(text ?? "").trim();
    if (Number.isInteger(i) && i >= 0 && t) out.push({ index: i, text: t });
  };

  const arr = Array.isArray(parsed?.translations)
    ? parsed.translations
    : Array.isArray(parsed)
    ? parsed
    : null;

  if (arr) {
    for (const item of arr) push(item?.index, item?.text);
  } else if (parsed && typeof parsed === "object") {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") push(key, value);
    }
  }
  return out;
}

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          index: { type: "integer" },
          text: { type: "string" },
        },
        required: ["index", "text"],
      },
    },
  },
  required: ["translations"],
};

export async function translateTranscriptOpenAI(input: {
  segments: NormalizedTranscriptSegment[];
  metadata: Pick<VideoMetadata, "title" | "channelTitle">;
  targetLanguage: string;
  // Optional per-user guidance overriding the built-in default.
  systemPromptOverride?: string;
  // Called as each translation line finishes streaming, for live progress.
  onProgress?: (completed: number, total: number) => void;
}): Promise<TranslationResult[]> {
  if (!resolveProvider()) throw new Error("No translation provider configured");
  const total = input.segments.length;
  if (total === 0) return [];

  const byIndex = new Map<number, string>();

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const missing = input.segments.filter((s) => !byIndex.has(s.index));
    if (missing.length === 0) break;

    const base = byIndex.size;
    const results = await streamTranslationCall({
      segments: input.segments,
      targetIndices: missing.map((s) => s.index),
      metadata: input.metadata,
      targetLanguage: input.targetLanguage,
      systemPromptOverride: input.systemPromptOverride,
      onLine: (count) =>
        input.onProgress?.(Math.min(base + count, total), total),
    });

    for (const r of results) {
      if (!byIndex.has(r.index)) byIndex.set(r.index, r.text);
    }
    input.onProgress?.(byIndex.size, total);

    // No progress this round — stop rather than loop forever.
    if (byIndex.size === base) break;
  }

  const out = input.segments
    .filter((s) => byIndex.has(s.index))
    .map((s) => ({ index: s.index, text: byIndex.get(s.index)! }));

  if (out.length === 0) {
    throw new Error("OpenAI translation returned no usable lines");
  }
  return out;
}

async function streamTranslationCall(input: {
  segments: NormalizedTranscriptSegment[];
  targetIndices: number[];
  metadata: Pick<VideoMetadata, "title" | "channelTitle">;
  targetLanguage: string;
  systemPromptOverride?: string;
  onLine: (count: number) => void;
}): Promise<TranslationResult[]> {
  const user = {
    videoTitle: input.metadata.title,
    channelTitle: input.metadata.channelTitle,
    targetLanguage: input.targetLanguage,
    instruction:
      "Translate every transcript line whose index is in translateIndices into natural spoken Sinhala. Return exactly one entry per requested index.",
    translateIndices: input.targetIndices,
    transcript: input.segments.map((s) => ({
      index: s.index,
      time: timestamp(s.startMs),
      text: s.text,
    })),
  };

  const provider = resolveProvider()!;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.apiKey}`,
  };
  if (provider.openrouter) {
    headers["HTTP-Referer"] = "https://vidura.nipuntheekshana.com";
    headers["X-Title"] = "Vidura";
  }

  const maxTokens = Math.min(120_000, input.targetIndices.length * 80 + 4000);
  const res = await fetch(provider.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      stream: true,
      messages: [
        {
          role: "system",
          content: systemPrompt(input.targetLanguage, input.systemPromptOverride),
        },
        { role: "user", content: JSON.stringify(user) },
      ],
      response_format: provider.jsonSchema
        ? {
          type: "json_schema",
          json_schema: {
            name: "sinhala_subtitles",
            strict: true,
            schema: RESPONSE_SCHEMA,
          },
        }
        : { type: "json_object" },
      // Generous headroom so the output never truncates. OpenAI uses
      // max_completion_tokens; OpenRouter accepts max_tokens.
      ...(provider.openrouter
        ? { max_tokens: maxTokens }
        : { max_completion_tokens: maxTokens }),
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `OpenAI translation failed with ${res.status}: ${detail.slice(0, 400)}`,
    );
  }

  const counter = objectCounter();
  let content = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuffer += decoder.decode(value, { stream: true });
      const lines = sseBuffer.split("\n");
      sseBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let delta: string | undefined;
        try {
          delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        } catch {
          continue;
        }
        if (typeof delta !== "string" || delta.length === 0) continue;
        content += delta;
        const before = counter.count;
        counter.feed(delta);
        if (counter.count !== before) input.onLine(counter.count);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const jsonText = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  let parsed: any;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("Translation response was not valid JSON");
  }

  return extractTranslations(parsed);
}

// Counts JSON array objects as they close in the streamed `{"translations":[…]}`
// response — a small state machine that ignores braces inside strings.
function objectCounter() {
  let depth = 0;
  let inStr = false;
  let esc = false;
  let count = 0;
  return {
    get count() {
      return count;
    },
    feed(chunk: string) {
      for (const ch of chunk) {
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') {
          inStr = true;
        } else if (ch === "{" || ch === "[") {
          depth += 1;
        } else if (ch === "}" || ch === "]") {
          depth -= 1;
          // Each translation object closes at array depth (root{ → [ → obj{).
          if (ch === "}" && depth === 2) count += 1;
        }
      }
    },
  };
}
