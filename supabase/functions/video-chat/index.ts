import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type VideoChatBody = {
  question?: string;
  videoId?: string | null;
};

type SegmentContext = {
  videoId: string;
  videoTitle: string;
  startMs: number;
  text: string;
  sinhala?: string;
};

type NoteContext = {
  videoId: string;
  videoTitle: string;
  timestampMs: number;
  content: string;
};

type VideoCatalogEntry = {
  id: string;
  title: string;
  channelTitle: string | null;
  durationMs: number | null;
  status: string;
  summary: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";

// Streaming answers are read token by token, so the overall deadline can be
// generous while still guaranteeing the function never hits the runtime's
// silent wall-clock kill.
const OPENROUTER_TIMEOUT_MS = 90_000;
const MAX_HISTORY_MESSAGES = 12;
const MAX_MATCHED_SEGMENTS = 60;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  const openRouterModel = Deno.env.get("OPENROUTER_CHAT_MODEL") ??
    Deno.env.get("OPENROUTER_MODEL") ?? "deepseek/deepseek-chat";

  if (
    !supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey ||
    !openRouterApiKey
  ) {
    return jsonResponse(
      { error: "Supabase or OpenRouter function environment is missing" },
      500,
    );
  }

  const authorization = request.headers.get("Authorization");

  if (!authorization) {
    return jsonResponse({ error: "Missing authorization header" }, 401);
  }

  const body = await parseBody(request);
  const question = body?.question?.trim();

  if (!question) {
    return jsonResponse({ error: "question is required" }, 400);
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  if (userError || !user) {
    return jsonResponse({ error: "Invalid user session" }, 401);
  }

  const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const videoId = body?.videoId ?? null;

  if (videoId) {
    const { data: video } = await serviceClient
      .from("videos")
      .select("id")
      .eq("id", videoId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (!video) {
      return jsonResponse({ error: "Video not found" }, 404);
    }
  }

  try {
    const threadId = await ensureThread(serviceClient, user.id, videoId);

    const history = await fetchRecentMessages(serviceClient, threadId);

    await serviceClient.from("chat_messages").insert({
      thread_id: threadId,
      owner_id: user.id,
      role: "user",
      content: question,
      metadata: { video_id: videoId },
    });

    const context = videoId
      ? await buildVideoContext(serviceClient, user.id, videoId)
      : await buildLibraryContext(serviceClient, user.id, question);

    const upstream = await fetch(openRouterUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://vidura.local",
        "X-Title": "Vidura",
      },
      body: JSON.stringify({
        model: openRouterModel,
        stream: true,
        temperature: 0.3,
        messages: [
          { role: "system", content: context.systemPrompt },
          ...history,
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
    });

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      throw new Error(
        `Chat model request failed with ${upstream.status} ${detail.slice(0, 200)}`,
      );
    }

    const encoder = new TextEncoder();
    const upstreamBody = upstream.body;
    let fullAnswer = "";

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        };

        send({ type: "meta", threadId, mode: videoId ? "video" : "library" });

        try {
          for await (const delta of readOpenRouterDeltas(upstreamBody)) {
            fullAnswer += delta;
            send({ type: "delta", text: delta });
          }

          const trimmedAnswer = fullAnswer.trim();

          if (!trimmedAnswer) {
            throw new Error("The chat model returned an empty answer");
          }

          const { data: saved } = await serviceClient
            .from("chat_messages")
            .insert({
              thread_id: threadId,
              owner_id: user.id,
              role: "assistant",
              content: trimmedAnswer,
              metadata: {
                video_id: videoId,
                mode: videoId ? "video" : "library",
                context_video_ids: context.videoIds,
              },
            })
            .select("id")
            .single();

          send({ type: "done", messageId: saved?.id ?? null });
        } catch (streamError) {
          const message = streamError instanceof Error
            ? streamError.message
            : "Chat response failed";
          send({ type: "error", message });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Chat failed";
    return jsonResponse({ error: message }, 500);
  }
});

async function* readOpenRouterDeltas(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const payload = trimmed.slice(5).trim();

        if (!payload || payload === "[DONE]") {
          continue;
        }

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;

          if (typeof delta === "string" && delta.length > 0) {
            yield delta;
          }
        } catch {
          // Ignore malformed keep-alive lines.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function ensureThread(
  serviceClient: SupabaseClient,
  ownerId: string,
  videoId: string | null,
) {
  let threadQuery = serviceClient
    .from("chat_threads")
    .select("id")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: true })
    .limit(1);

  threadQuery = videoId
    ? threadQuery.eq("video_id", videoId)
    : threadQuery.is("video_id", null);

  const { data: threads, error: selectError } = await threadQuery;

  if (selectError) {
    throw new Error("Failed to read chat threads");
  }

  const existing = (threads as Array<{ id: string }> | null)?.[0];

  if (existing) {
    return existing.id;
  }

  const { data: thread, error: insertError } = await serviceClient
    .from("chat_threads")
    .insert({
      owner_id: ownerId,
      video_id: videoId,
      title: videoId ? "Video chat" : "Library chat",
    })
    .select("id")
    .single();

  if (insertError || !thread) {
    throw new Error("Could not create chat thread");
  }

  return (thread as { id: string }).id;
}

async function fetchRecentMessages(
  serviceClient: SupabaseClient,
  threadId: string,
) {
  const { data } = await serviceClient
    .from("chat_messages")
    .select("role, content")
    .eq("thread_id", threadId)
    .neq("role", "system")
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  return ((data ?? []) as Array<{ role: "user" | "assistant"; content: string }>)
    .reverse()
    .map((message) => ({ role: message.role, content: message.content }));
}

const sharedGuidance = [
  "You are Vidura, a friendly study assistant for a personal library of YouTube videos with Sinhala subtitles.",
  "Answer ONLY from the provided context (transcripts, notes, video catalog). If the answer is not in the context, say so honestly.",
  "Detect the user's language and reply in it: English questions get English answers; Sinhala script gets Sinhala; Singlish (Sinhala written in Latin letters) gets simple Singlish or Sinhala.",
  "Always cite where in the video your answer comes from using [mm:ss] timestamps taken from the context.",
  "Keep answers concise and conversational. Use short paragraphs or bullet lists, never headers.",
].join("\n");

async function buildVideoContext(
  serviceClient: SupabaseClient,
  ownerId: string,
  videoId: string,
) {
  const [videoResult, segmentsResult, translationsResult, notesResult] =
    await Promise.all([
      serviceClient
        .from("videos")
        .select("title, channel_title, duration_ms")
        .eq("id", videoId)
        .single(),
      serviceClient
        .from("transcript_segments")
        .select("id, start_ms, text")
        .eq("video_id", videoId)
        .order("segment_index", { ascending: true }),
      serviceClient
        .from("translated_segments")
        .select("segment_id, text")
        .eq("video_id", videoId),
      serviceClient
        .from("video_notes")
        .select("timestamp_ms, content")
        .eq("video_id", videoId)
        .eq("owner_id", ownerId)
        .order("timestamp_ms", { ascending: true }),
    ]);

  const video = videoResult.data as
    | { title: string; channel_title: string | null; duration_ms: number | null }
    | null;
  const segments = (segmentsResult.data ?? []) as Array<
    { id: string; start_ms: number; text: string }
  >;
  const sinhalaBySegment = new Map(
    ((translationsResult.data ?? []) as Array<
      { segment_id: string; text: string }
    >).map((row) => [row.segment_id, row.text]),
  );
  const notes = (notesResult.data ?? []) as Array<
    { timestamp_ms: number; content: string }
  >;

  const transcriptBlock = segments
    .map((segment) => {
      const sinhala = sinhalaBySegment.get(segment.id);
      return `[${formatTimestamp(segment.start_ms)}] ${segment.text}` +
        (sinhala ? ` | SI: ${sinhala}` : "");
    })
    .join("\n");

  const notesBlock = notes.length > 0
    ? notes
      .map((note) =>
        `[${formatTimestamp(note.timestamp_ms)}] ${note.content}`
      )
      .join("\n")
    : "No notes yet.";

  const systemPrompt = [
    sharedGuidance,
    "",
    `Current video: ${video?.title ?? "Unknown"} — ${
      video?.channel_title ?? "YouTube"
    }`,
    "",
    "Full transcript with timestamps (EN, with SI subtitle where available):",
    transcriptBlock || "Transcript is not available yet.",
    "",
    "The user's own timestamped notes on this video:",
    notesBlock,
  ].join("\n");

  return { systemPrompt, videoIds: [videoId] };
}

async function buildLibraryContext(
  serviceClient: SupabaseClient,
  ownerId: string,
  question: string,
) {
  const { data: videoRows } = await serviceClient
    .from("videos")
    .select("id, title, channel_title, duration_ms, status, metadata")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });

  const videos = (videoRows ?? []) as Array<{
    id: string;
    title: string;
    channel_title: string | null;
    duration_ms: number | null;
    status: string;
    metadata: Record<string, unknown> | null;
  }>;
  const videoTitleById = new Map(videos.map((video) => [video.id, video.title]));
  const videoIds = videos.map((video) => video.id);

  const catalog: VideoCatalogEntry[] = [];

  for (const video of videos) {
    const { data: job } = await serviceClient
      .from("processing_jobs")
      .select("metadata")
      .eq("video_id", video.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const jobMetadata = (job?.metadata ?? {}) as Record<string, unknown>;
    const translationContext = jobMetadata.translation_context as
      | Record<string, unknown>
      | undefined;

    catalog.push({
      id: video.id,
      title: video.title,
      channelTitle: video.channel_title,
      durationMs: video.duration_ms,
      status: video.status,
      summary: typeof translationContext?.summary === "string"
        ? translationContext.summary
        : null,
    });
  }

  const terms = extractSearchTerms(question);
  const matchedSegments: SegmentContext[] = [];
  const matchedNotes: NoteContext[] = [];

  if (videoIds.length > 0 && terms.length > 0) {
    const orFilter = terms
      .map((term) => `normalized_text.ilike.%${term}%`)
      .join(",");
    const { data: segmentRows } = await serviceClient
      .from("transcript_segments")
      .select("video_id, start_ms, text")
      .in("video_id", videoIds)
      .or(orFilter)
      .order("start_ms", { ascending: true })
      .limit(MAX_MATCHED_SEGMENTS);

    for (
      const row of (segmentRows ?? []) as Array<
        { video_id: string; start_ms: number; text: string }
      >
    ) {
      matchedSegments.push({
        videoId: row.video_id,
        videoTitle: videoTitleById.get(row.video_id) ?? "Unknown video",
        startMs: row.start_ms,
        text: row.text,
      });
    }
  }

  const { data: noteRows } = await serviceClient
    .from("video_notes")
    .select("video_id, timestamp_ms, content")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(50);

  for (
    const row of (noteRows ?? []) as Array<
      { video_id: string; timestamp_ms: number; content: string }
    >
  ) {
    matchedNotes.push({
      videoId: row.video_id,
      videoTitle: videoTitleById.get(row.video_id) ?? "Unknown video",
      timestampMs: row.timestamp_ms,
      content: row.content,
    });
  }

  const catalogBlock = catalog.length > 0
    ? catalog
      .map((entry) =>
        `- "${entry.title}" (${entry.channelTitle ?? "YouTube"}, ${
          entry.durationMs ? formatTimestamp(entry.durationMs) : "??:??"
        }, ${entry.status})${entry.summary ? ` — ${entry.summary}` : ""}`
      )
      .join("\n")
    : "The library is empty.";

  const segmentsBlock = matchedSegments.length > 0
    ? matchedSegments
      .map((segment) =>
        `- ${segment.videoTitle} [${formatTimestamp(segment.startMs)}]: ${segment.text}`
      )
      .join("\n")
    : "No transcript lines matched the question keywords.";

  const notesBlock = matchedNotes.length > 0
    ? matchedNotes
      .map((note) =>
        `- ${note.videoTitle} [${formatTimestamp(note.timestampMs)}]: ${note.content}`
      )
      .join("\n")
    : "No notes yet.";

  const systemPrompt = [
    sharedGuidance,
    "When you reference a video, name it and give the timestamp like: \"Video Title\" [mm:ss].",
    "",
    "The user's video library:",
    catalogBlock,
    "",
    "Transcript lines matching the question keywords:",
    segmentsBlock,
    "",
    "The user's timestamped notes:",
    notesBlock,
  ].join("\n");

  return { systemPrompt, videoIds };
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

function formatTimestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes.toString().padStart(2, "0")}:${
    seconds.toString().padStart(2, "0")
  }`;
}

async function parseBody(request: Request): Promise<VideoChatBody | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
