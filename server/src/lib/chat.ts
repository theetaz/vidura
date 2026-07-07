import { sql } from "../db.ts";
import { type ChatSettings, defaultChatSettings } from "./agents.ts";

export function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${
    seconds.toString().padStart(2, "0")
  }`;
}

export async function fetchChatSettings(ownerId: string): Promise<ChatSettings> {
  const [row] = await sql<Array<{
    response_language: ChatSettings["responseLanguage"];
    answer_style: ChatSettings["answerStyle"];
    custom_instructions: string | null;
    memory_depth: ChatSettings["memoryDepth"];
    retrieval_depth: ChatSettings["retrievalDepth"];
    creativity: ChatSettings["creativity"];
  }>>`
    select response_language, answer_style, custom_instructions,
      memory_depth, retrieval_depth, creativity
    from user_chat_settings where owner_id = ${ownerId}
  `;

  if (!row) return defaultChatSettings;

  return {
    responseLanguage: row.response_language,
    answerStyle: row.answer_style,
    customInstructions: row.custom_instructions ?? "",
    memoryDepth: row.memory_depth,
    retrievalDepth: row.retrieval_depth,
    creativity: row.creativity,
  };
}

export async function buildVideoContext(ownerId: string, videoId: string) {
  const [video] = await sql<
    Array<{ title: string; channel_title: string | null }>
  >`select title, channel_title from videos where id = ${videoId} and owner_id = ${ownerId}`;

  const segments = await sql<
    Array<{ id: string; start_ms: number; text: string }>
  >`
    select id, start_ms, text from transcript_segments
    where video_id = ${videoId} order by segment_index asc
  `;
  const translations = await sql<Array<{ segment_id: string; text: string }>>`
    select segment_id, text from translated_segments where video_id = ${videoId}
  `;
  const notes = await sql<Array<{ timestamp_ms: number; content: string }>>`
    select timestamp_ms, content from video_notes
    where video_id = ${videoId} and owner_id = ${ownerId}
    order by timestamp_ms asc
  `;

  const sinhalaBySegment = new Map(translations.map((r) => [r.segment_id, r.text]));

  const transcriptBlock = segments
    .map((segment) => {
      const sinhala = sinhalaBySegment.get(segment.id);
      return `[${formatTimestamp(segment.start_ms)}] ${segment.text}` +
        (sinhala ? ` | SI: ${sinhala}` : "");
    })
    .join("\n");

  const notesBlock = notes.length > 0
    ? notes.map((n) => `[${formatTimestamp(n.timestamp_ms)}] ${n.content}`).join("\n")
    : "No notes yet.";

  const contextBlock = [
    `Current video: ${video?.title ?? "Unknown"} — ${video?.channel_title ?? "YouTube"}`,
    "",
    "Full transcript with timestamps (EN, with SI subtitle where available):",
    transcriptBlock || "Transcript is not available yet.",
    "",
    "The user's own timestamped notes on this video:",
    notesBlock,
  ].join("\n");

  return { contextBlock, videoIds: [videoId] };
}

export async function buildLibraryContext(
  ownerId: string,
  question: string,
  maxMatchedSegments: number,
) {
  const videos = await sql<Array<{
    id: string;
    title: string;
    channel_title: string | null;
    duration_ms: number | null;
    status: string;
  }>>`
    select id, title, channel_title, duration_ms, status
    from videos where owner_id = ${ownerId} order by created_at desc
  `;
  const videoTitleById = new Map(videos.map((v) => [v.id, v.title]));
  const videoIds = videos.map((v) => v.id);

  // Stored per-video summaries live on the latest processing job's metadata.
  const summaries = videoIds.length > 0
    ? await sql<Array<{ video_id: string; summary: string | null }>>`
      select distinct on (video_id) video_id,
        (metadata->'translation_context'->>'summary') as summary
      from processing_jobs where video_id in ${sql(videoIds)}
      order by video_id, created_at desc
    `
    : [];
  const summaryByVideo = new Map(summaries.map((s) => [s.video_id, s.summary]));

  const catalogBlock = videos.length > 0
    ? videos.map((v) => {
      const summary = summaryByVideo.get(v.id);
      return `- "${v.title}" (${v.channel_title ?? "YouTube"}, ${
        v.duration_ms ? formatTimestamp(v.duration_ms) : "??:??"
      }, ${v.status})${summary ? ` — ${summary}` : ""}`;
    }).join("\n")
    : "The library is empty.";

  const terms = extractSearchTerms(question);
  let segmentsBlock = "No transcript lines matched the question keywords.";

  if (videoIds.length > 0 && terms.length > 0) {
    const pattern = terms.map((t) => `%${t}%`);
    const matched = await sql<
      Array<{ video_id: string; start_ms: number; text: string }>
    >`
      select video_id, start_ms, text from transcript_segments
      where video_id in ${sql(videoIds)}
        and normalized_text ilike any(${pattern})
      order by start_ms asc limit ${maxMatchedSegments}
    `;
    if (matched.length > 0) {
      segmentsBlock = matched.map((s) =>
        `- ${videoTitleById.get(s.video_id) ?? "Unknown video"} [${
          formatTimestamp(s.start_ms)
        }]: ${s.text}`
      ).join("\n");
    }
  }

  const notes = await sql<
    Array<{ video_id: string; timestamp_ms: number; content: string }>
  >`
    select video_id, timestamp_ms, content from video_notes
    where owner_id = ${ownerId} order by created_at desc limit 50
  `;
  const notesBlock = notes.length > 0
    ? notes.map((n) =>
      `- ${videoTitleById.get(n.video_id) ?? "Unknown video"} [${
        formatTimestamp(n.timestamp_ms)
      }]: ${n.content}`
    ).join("\n")
    : "No notes yet.";

  const contextBlock = [
    "The user's video library:",
    catalogBlock,
    "",
    "Transcript lines matching the question keywords:",
    segmentsBlock,
    "",
    "The user's timestamped notes:",
    notesBlock,
  ].join("\n");

  return { contextBlock, videoIds };
}

function extractSearchTerms(question: string) {
  const stopWords = new Set([
    "the", "and", "for", "with", "this", "that", "what", "when", "where",
    "who", "how", "why", "does", "did", "can", "could", "about", "video",
    "videos", "tell", "explain", "from", "have", "was", "are", "you",
  ]);

  return Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !stopWords.has(token)),
    ),
  ).slice(0, 8);
}
