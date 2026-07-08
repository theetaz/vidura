import type { NormalizedTranscriptSegment } from "./youtube.ts";
import { requestOpenRouterJson } from "./openrouter.ts";

export type TranslationContext = {
  topic: string;
  summary: string;
  audience: string;
  translationGuidelines: string;
  keyTerms: Array<{ source: string; preferredSinhala: string }>;
};

export type TranslationResult = { index: number; text: string };

export const TRANSLATION_BATCH_SIZE = 12;
export const PRIOR_TRANSLATIONS_LIMIT = 250;

export function chunkSegments<T>(segments: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < segments.length; index += size) {
    batches.push(segments.slice(index, index + size));
  }
  return batches;
}

export function parseTranslationContext(value: unknown): TranslationContext | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const topic = typeof record.topic === "string" ? record.topic.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const audience = typeof record.audience === "string" ? record.audience.trim() : "";
  const translationGuidelines = typeof record.translationGuidelines === "string"
    ? record.translationGuidelines.trim()
    : "";
  const keyTerms = Array.isArray(record.keyTerms)
    ? record.keyTerms.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const term = item as Record<string, unknown>;
      const source = typeof term.source === "string" ? term.source.trim() : "";
      const preferredSinhala = typeof term.preferredSinhala === "string"
        ? term.preferredSinhala.trim()
        : "";
      if (!source || !preferredSinhala) return [];
      return [{ source, preferredSinhala }];
    })
    : [];

  if (!topic || !summary || !translationGuidelines) return null;

  return {
    topic,
    summary,
    audience: audience || "Sinhala-speaking learners",
    translationGuidelines,
    keyTerms,
  };
}

export async function buildTranslationContext(input: {
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  videoTitle: string | null;
  channelTitle: string | null;
  segments: NormalizedTranscriptSegment[];
}): Promise<TranslationContext> {
  const parsed = await requestOpenRouterJson<Record<string, unknown>>({
    model: input.model,
    system:
      "You analyze full YouTube transcripts and prepare localization guidance for natural spoken Sinhala subtitles. The goal is fluent native Sinhala that fits the video, not literal one-to-one translation. Return only valid JSON.",
    user: {
      task:
        "Read the entire transcript first, then produce translation context a Sinhala subtitle localizer will follow.",
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      videoTitle: input.videoTitle,
      channelTitle: input.channelTitle,
      transcript: input.segments.map((segment) => ({
        index: segment.index,
        text: segment.text,
      })),
      instructions:
        'Return one JSON object shaped as {"topic":"...","summary":"...","audience":"...","translationGuidelines":"...","keyTerms":[{"source":"...","preferredSinhala":"..."}]}. The summary must capture the whole video arc. translationGuidelines must explicitly instruct the translator to: (1) read the full transcript before each batch, (2) write composed native Sinhala a learner would hear in a Sri Lankan educational video, (3) avoid literal English word order and calques, (4) keep terminology consistent, and (5) keep lines concise for on-screen subtitles.',
    },
    temperature: 0.1,
  });

  const context = parseTranslationContext(parsed);
  if (!context) throw new Error("Failed to build translation context");
  return context;
}

function formatFullTranscriptForPrompt(segments: NormalizedTranscriptSegment[]) {
  return segments.map((segment) => `[${segment.index}] ${segment.text}`).join("\n");
}

// Source lines within WINDOW indices of the batch, for local flow. The
// whole-video understanding lives in the distilled context (topic/summary/
// guidelines/keyTerms), so batches don't need the full transcript — sending it
// every time made long-video batches time out.
const NEARBY_WINDOW = 15;

function nearbySegments(
  allSegments: NormalizedTranscriptSegment[],
  batch: NormalizedTranscriptSegment[],
): NormalizedTranscriptSegment[] {
  const first = batch[0]?.index ?? 0;
  const last = batch[batch.length - 1]?.index ?? first;
  return allSegments.filter(
    (s) => s.index >= first - NEARBY_WINDOW && s.index <= last + NEARBY_WINDOW,
  );
}

function buildTranslationSystemPrompt(
  context: TranslationContext,
  nearby: NormalizedTranscriptSegment[],
) {
  const keyTerms = context.keyTerms.length > 0
    ? context.keyTerms.map((term) => `${term.source} → ${term.preferredSinhala}`).join("; ")
    : "Use consistent native Sinhala terms throughout.";

  return [
    "You localize educational YouTube subtitles into natural spoken Sinhala (සිංහල).",
    "You have already read the ENTIRE transcript of this video. Never translate lines in isolation.",
    "Work passage by passage: first understand what the speaker is saying across the whole stretch of segments, compose it as natural spoken Sinhala, then distribute that Sinhala across the segment indices in speaking order.",
    "A single sentence often spans several consecutive segments. Let the Sinhala sentence flow across those indices — do NOT restart sentence grammar at every index, and do NOT force each index to be a self-contained sentence.",
    "Each subtitle must read like continuous native Sinhala narration that fits the video topic, tone, and teaching style, and must connect smoothly to the previous and next subtitle.",
    "Avoid word-for-word English calques, awkward sentence order, and unnecessary transliteration.",
    "Prefer idiomatic Sinhala phrasing that a native speaker would use while explaining the same idea on video.",
    "",
    `Topic: ${context.topic}`,
    `Summary: ${context.summary}`,
    `Audience: ${context.audience}`,
    `Style guide: ${context.translationGuidelines}`,
    `Key terms: ${keyTerms}`,
    "",
    "Nearby source lines (for local flow; translate only the requested indices):",
    formatFullTranscriptForPrompt(nearby),
    "",
    "Return only valid JSON.",
  ].join("\n");
}

export function buildPriorTranslations(
  batchSegments: NormalizedTranscriptSegment[],
  existingTranslations: Map<number, string>,
  limit = PRIOR_TRANSLATIONS_LIMIT,
) {
  const firstIndex = batchSegments[0]?.index ?? 0;
  return Array.from(existingTranslations.entries())
    .filter(([index]) => index < firstIndex)
    .sort(([a], [b]) => a - b)
    .slice(-limit)
    .map(([index, text]) => ({ index, text }));
}

async function translateSegmentBatch(input: {
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: NormalizedTranscriptSegment[];
  allSegments: NormalizedTranscriptSegment[];
  translationContext: TranslationContext;
  videoTitle: string | null;
  channelTitle: string | null;
  priorTranslations: Array<{ index: number; text: string }>;
}) {
  const parsed = await requestOpenRouterJson<Record<string, unknown>>({
    model: input.model,
    system: buildTranslationSystemPrompt(
      input.translationContext,
      nearbySegments(input.allSegments, input.segments),
    ),
    user: {
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      videoTitle: input.videoTitle,
      channelTitle: input.channelTitle,
      videoContext: input.translationContext,
      priorSinhalaTranslations: input.priorTranslations,
      segmentsToTranslate: input.segments.map((segment) => ({
        index: segment.index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text,
      })),
      instructions:
        'Using the full transcript already provided in the system message, translate ONLY segmentsToTranslate, covering every requested index exactly once. First compose the passage as natural spoken Sinhala, then distribute it across the indices in speaking order — a sentence may flow across consecutive indices, so do not restart grammar at each index. The first line must continue naturally from the last entry of priorSinhalaTranslations. Do not mirror English grammar. Rephrase freely when needed so each line sounds spoken and relevant to the video. Keep each line short enough for on-screen subtitles. Return one JSON object shaped as {"translations":[{"index":0,"text":"..."}]} and no other keys.',
    },
    temperature: 0.4,
  });

  return parseTranslationContent(JSON.stringify(parsed), input.segments);
}

export async function translateCompleteBatch(input: {
  model: string;
  sourceLanguage: string;
  targetLanguage: string;
  segments: NormalizedTranscriptSegment[];
  allSegments: NormalizedTranscriptSegment[];
  translationContext: TranslationContext;
  videoTitle: string | null;
  channelTitle: string | null;
  priorTranslations: Array<{ index: number; text: string }>;
}): Promise<TranslationResult[]> {
  const translations = await translateSegmentBatch(input);
  const translationByIndex = new Map(
    translations.map((translation) => [translation.index, translation]),
  );
  let missingSegments = input.segments.filter(
    (segment) => !translationByIndex.has(segment.index),
  );

  for (const retryBatch of chunkSegments(missingSegments, 25)) {
    const retryTranslations = await translateSegmentBatch({
      ...input,
      segments: retryBatch,
    });
    for (const translation of retryTranslations) {
      translationByIndex.set(translation.index, translation);
    }
  }

  missingSegments = input.segments.filter(
    (segment) => !translationByIndex.has(segment.index),
  );
  if (missingSegments.length > 0) {
    throw new Error(
      `Translation response missed ${missingSegments.length} segment(s)`,
    );
  }

  return input.segments.map((segment) => translationByIndex.get(segment.index)!);
}

function parseTranslationContent(
  content: string,
  sourceSegments: NormalizedTranscriptSegment[],
): TranslationResult[] {
  const jsonText = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(jsonText);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.translations)
    ? parsed.translations
    : [parsed];
  const sourceIndexSet = new Set(sourceSegments.map((segment) => segment.index));
  const translations = (items as unknown[]).flatMap((item): TranslationResult[] => {
    const record = item as Record<string, unknown>;
    const index = Number.isInteger(Number(record.index)) ? Number(record.index) : null;
    const text = String(record.text ?? "").trim();
    if (index === null || !sourceIndexSet.has(index) || !text) return [];
    return [{ index, text }];
  });

  if (translations.length === 0) {
    throw new Error("Translation response did not include text");
  }

  return translations;
}
