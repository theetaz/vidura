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

// A stream that is actively producing tokens must never be killed, no matter
// how long the full response takes — a fixed total-duration timeout used to
// abort long translations mid-flight whenever the provider had a slow spell,
// failing the whole job. Abort only when the stream goes QUIET (idle), with a
// generous overall cap purely as a hung-connection backstop.
const STREAM_IDLE_TIMEOUT_MS = 90_000;
const STREAM_MAX_MS = 20 * 60_000;
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
  // Lines already translated (e.g. stored by an earlier attempt of the same
  // job). Seeding them means only the missing indices are requested, so a
  // retried job RESUMES instead of re-translating the whole video.
  seed?: Map<number, string>;
  // Called as each translation line finishes streaming, for live progress.
  onProgress?: (completed: number, total: number) => void;
  // Called after each round with that round's NEW lines, so the caller can
  // persist partial progress — a crash or restart then loses at most a round.
  onRoundResults?: (results: TranslationResult[]) => Promise<void>;
}): Promise<TranslationResult[]> {
  if (!resolveProvider()) throw new Error("No translation provider configured");
  const total = input.segments.length;
  if (total === 0) return [];

  const byIndex = new Map<number, string>(input.seed ?? []);

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

    const fresh: TranslationResult[] = [];
    for (const r of results) {
      if (!byIndex.has(r.index)) {
        byIndex.set(r.index, r.text);
        fresh.push(r);
      }
    }
    input.onProgress?.(byIndex.size, total);
    if (fresh.length > 0) await input.onRoundResults?.(fresh);

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

  // Abort only on SILENCE: the idle timer resets on every received chunk, so
  // an actively-streaming response can run as long as it needs. The overall
  // cap is just a backstop against a connection that never closes.
  const controller = new AbortController();
  let idleTimer = setTimeout(
    () => controller.abort(),
    STREAM_IDLE_TIMEOUT_MS,
  );
  const overallTimer = setTimeout(() => controller.abort(), STREAM_MAX_MS);

  let content = "";
  try {
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
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `OpenAI translation failed with ${res.status}: ${detail.slice(0, 400)}`,
      );
    }

    const counter = objectCounter();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let sseBuffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => controller.abort(),
          STREAM_IDLE_TIMEOUT_MS,
        );
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
  } catch (error) {
    // A dropped/idle-aborted stream isn't a total loss: whatever complete
    // lines already arrived are salvaged below, and the caller's round loop
    // re-requests only the still-missing indices. Only give up when nothing
    // usable was received.
    const salvaged = salvageTranslations(content);
    if (salvaged.length > 0) return salvaged;
    throw error;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(overallTimer);
  }

  const results = salvageTranslations(content);
  if (results.length === 0) {
    throw new Error("Translation response was not valid JSON");
  }
  return results;
}

// Parses a complete OR truncated streamed response into translation lines.
// Tries a full parse first, then — for streams cut off mid-object — trims the
// text back to the last fully-closed entry and reconstructs valid JSON for
// each shape the models emit ({"translations":[…]}, bare array, index map).
function salvageTranslations(raw: string): TranslationResult[] {
  const text = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  if (!text) return [];

  // Track string/escape state so braces inside translated text don't count.
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastObjEndDepth2 = -1; // "}" closing an item of {"translations":[…]}
  let lastObjEndDepth1 = -1; // "}" closing an item of a bare top-level array
  let lastCommaDepth1 = -1; // "," between entries of an index-keyed map

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") depth += 1;
    else if (ch === "}" || ch === "]") {
      depth -= 1;
      if (ch === "}" && depth === 2) lastObjEndDepth2 = i;
      if (ch === "}" && depth === 1) lastObjEndDepth1 = i;
    } else if (ch === "," && depth === 1) lastCommaDepth1 = i;
  }

  const candidates = [
    text, // stream finished cleanly
    lastObjEndDepth2 >= 0 ? text.slice(0, lastObjEndDepth2 + 1) + "]}" : null,
    lastObjEndDepth1 >= 0 ? text.slice(0, lastObjEndDepth1 + 1) + "]" : null,
    lastCommaDepth1 >= 0 ? text.slice(0, lastCommaDepth1) + "}" : null,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const results = extractTranslations(JSON.parse(candidate));
      if (results.length > 0) return results;
    } catch {
      // try the next reconstruction
    }
  }
  return [];
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
